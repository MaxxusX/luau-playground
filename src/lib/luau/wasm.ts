/**
 * Luau WASM Module Loader and Runner
 *
 * Uses two Web Workers:
 * - Analysis worker (long-lived): LSP, bytecode, type checking - always responsive
 * - Execution worker (on-demand): code execution - can be terminated for infinite loops
 */

import {
	appendOutput,
	clearOutput,
	setRunning,
	setExecutionTime,
	getActiveFileContent,
	activeFile,
	getAllFiles,
} from "$lib/stores/playground";
import { settings, type LuauMode, type SolverMode } from "$lib/stores/settings";
import { get } from "svelte/store";
import type { ExecuteResult, LuauDiagnostic, LuauCompletion } from "./types";
import type { WorkerRequest, WorkerResponse } from "./luau.worker";
import LuauWorker from "./luau.worker?worker";

declare const __wasmPromises: { luau: Promise<ArrayBuffer> } | undefined;

// Error messages for termination
const STOPPED_ERROR = "Execution stopped";
const CANCELLED_ERROR = "Cancelled";
const ROBLOX_PC_STUDIO_FLAGS_URL =
	"https://clientsettingscdn.roblox.com/v1/settings/application?applicationName=PCStudioApp";

// Convert LuauMode to numeric value for WASM
const modeToNum = (mode: LuauMode): number =>
	mode === "strict" ? 1
	: mode === "nocheck" ? 2
	: 0;

let robloxStudioFlagPayloadPromise: Promise<string | null> | null = null;

async function getRobloxStudioFlagPayload(): Promise<string | null> {
	if (robloxStudioFlagPayloadPromise) return robloxStudioFlagPayloadPromise;

	robloxStudioFlagPayloadPromise = fetch(ROBLOX_PC_STUDIO_FLAGS_URL)
		.then((response) => response.json())
		.then(({ applicationSettings }: { applicationSettings?: Record<string, string> }) => {
			if (!applicationSettings) throw new Error("Roblox CDN returned invalid response");

			const lines: string[] = [];

			const isLuauFlag = /^FFlagLuau|FIntLuau|DFFlagLuau|DFIntLuau/.test;
			for (const flag of Object.entries(applicationSettings)) {
				const name = flag[0];
				if (!isLuauFlag(name)) continue;
				const value = flag[1];
				if (name[1] === "F") {
					if (name[2] !== "F") {
						/* FFlagLuau or DFIntLuau */
						lines.push(name.slice(9) + "=" + value);
					else {
						/* DFFlagLuau */
						lines.push(name.slice(10) + "=" + value);
					}
				} else if (name[1] === "I") {
					/* FIntLuau */
					lines.push(name.slice(8) + "=" + value);
				}
			}

			return lines.length > 0 ? lines.join("\n") : null;
		})
		.catch((err) => {
			console.warn("[Luau] Failed to sync Roblox Studio Luau flags:", err);
			return null;
		});

	return robloxStudioFlagPayloadPromise;
}

// Compiled WASM module - shared with workers to avoid recompilation
// WebAssembly.Module is structured-clonable, so workers get the same compiled code
let compiledWasmModule: WebAssembly.Module | null = null;
let wasmModuleLoading: Promise<WebAssembly.Module> | null = null;

/**
 * Get the compiled WASM module, using preloaded promise from index.html or fetching once.
 * WebAssembly.Module is structured-clonable and can be sent to workers without copying
 * the entire compiled code - workers can instantiate directly from the shared module.
 */
async function getCompiledWasmModule(): Promise<WebAssembly.Module> {
	if (!compiledWasmModule) {
		if (!wasmModuleLoading) {
			// Compile once - the compiled module can be shared with workers
			wasmModuleLoading = (async () => {
				if (typeof __wasmPromises !== "undefined") {
					compiledWasmModule = await WebAssembly.compile(await __wasmPromises.luau);
				} else {
					const wasmUrl = new URL("./wasm/luau.wasm", document.baseURI).href;
					compiledWasmModule = await WebAssembly.compileStreaming(await fetch(wasmUrl));
				}

				return compiledWasmModule;
			})();
		}
		await wasmModuleLoading;
	}
	return compiledWasmModule!;
}

// ============================================================================
// Worker Manager - Encapsulates worker lifecycle and request handling
// ============================================================================

interface WorkerManager {
	worker: Worker | null;
	ready: boolean;
	readyPromise: Promise<void> | null;
	pendingRequests: Map<
		string,
		{ resolve: (value: WorkerResponse) => void; reject: (error: Error) => void }
	>;
	requestIdCounter: number;
}

function createWorkerManager(): WorkerManager {
	return {
		worker: null,
		ready: false,
		readyPromise: null,
		pendingRequests: new Map(),
		requestIdCounter: 0,
	};
}

function setupWorkerHandlers(manager: WorkerManager, name: string): void {
	if (!manager.worker) return;

	manager.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
		const response = e.data;
		const requestId = response.requestId;

		const pending = manager.pendingRequests.get(requestId);
		if (pending) {
			manager.pendingRequests.delete(requestId);
			if (response.type === "error") {
				pending.reject(new Error(response.error));
			} else {
				pending.resolve(response);
			}
		}
	};

	manager.worker.onerror = function (err) {
		console.error(`[Luau ${name}] Worker error:`, err);
		// Reset state so future requests trigger a new worker
		terminateWorker(manager, "Worker error");
	};
}

function rejectAllPending(manager: WorkerManager, error: Error): void {
	for (const { reject } of manager.pendingRequests.values()) {
		reject(error);
	}
	manager.pendingRequests.clear();
}

async function initializeWorker(
	manager: WorkerManager,
	wasmModule: WebAssembly.Module
): Promise<void> {
	const requestId = "init_"+manager.requestIdCounter++;

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			manager.pendingRequests.delete(requestId);
			reject(new Error("Worker initialization timeout"));
		}, 10000);

		manager.pendingRequests.set(requestId, {
			resolve: () => {
				clearTimeout(timer);
				resolve();
			},
			reject: (err) => {
				clearTimeout(timer);
				reject(err);
			},
		});

		manager.worker!.postMessage({
			type: "init",
			wasmModule,
			requestId,
		} satisfies WorkerRequest);
	});
}

// Type mapping from request type to response type
type ResponseForRequest<T extends WorkerRequest["type"]> = Extract<WorkerResponse, { type: T }>;

async function sendToWorker<T extends WorkerRequest["type"]>(
	manager: WorkerManager,
	params: Extract<WorkerRequest, { type: T }>
): Promise<ResponseForRequest<T>> {
	if (!manager.worker || !manager.ready) throw new Error("Worker not ready");

	const requestId = "req_"+manager.requestIdCounter++;
	params.requestId = requestId;

	return new Promise((resolve, reject) => {
		manager.pendingRequests.set(requestId, {
			resolve: resolve as (value: ResponseForRequest<T>) => void,
			reject,
		});
		manager.worker!.postMessage(params);
	});
}

function terminateWorker(manager: WorkerManager, errorMessage: string = STOPPED_ERROR): void {
	manager.readyPromise = null;
	manager.ready = false;

	if (manager.worker) {
		manager.worker.terminate();
		manager.worker = null;
	}

	rejectAllPending(manager, new Error(errorMessage));
}

// ============================================================================
// Shared Worker Loading
// ============================================================================

async function loadWorker(
	manager: WorkerManager,
	name: string,
	options?: { checkTerminated?: boolean; postInit?: () => Promise<void> }
): Promise<void> {
	if (manager.ready && manager.worker) return;
	if (manager.readyPromise) return manager.readyPromise;

	const { checkTerminated = false, postInit } = options ?? {};

	manager.readyPromise = (async () => {
		try {
			const modulePromise = getCompiledWasmModule();
			manager.worker = new LuauWorker();
			setupWorkerHandlers(manager, name);

			const wasmModule = await modulePromise;

			if (checkTerminated && !manager.worker) throw new Error(STOPPED_ERROR);

			await initializeWorker(manager, wasmModule);

			if (checkTerminated && !manager.worker) throw new Error(STOPPED_ERROR);

			manager.ready = true;

			await postInit?.();
		} catch (err) {
			manager.readyPromise = null;
			manager.ready = false;

			if (err instanceof Error && err.message === STOPPED_ERROR) throw err;
			throw new Error(`Failed to load ${name.toLowerCase()} worker`, { cause: err });
		}
	})();

	return manager.readyPromise;
}

// ============================================================================
// Analysis Worker - Long-lived for LSP, bytecode, type checking
// ============================================================================

const analysis = createWorkerManager();

async function loadAnalysisWorker(): Promise<void> {
	const robloxStudioFlagsPromise = getRobloxStudioFlagPayload();

	return loadWorker(analysis, "Analysis", {
		postInit: async () => {
			const robloxStudioFlags = await robloxStudioFlagsPromise;
			if (robloxStudioFlags) {
				await sendToWorker(analysis, { type: "setFFlags", serializedFlags: robloxStudioFlags });
			}

			const currentSettings = get(settings);
			await sendToWorker(analysis, { type: "setMode", mode: modeToNum(currentSettings.mode) });
			await sendToWorker(analysis, { type: "setSolver", isNew: currentSettings.solver === "new" });
			initSettingsSync();
		},
	});
}

async function sendAnalysisRequest<T extends WorkerRequest["type"]>(
	params: Extract<WorkerRequest, { type: T }>
): Promise<ResponseForRequest<T>> {
	await loadAnalysisWorker();
	return sendToWorker(analysis, params);
}

async function syncAnalysisSources(): Promise<void> {
	const allFiles = getAllFiles();
	await sendAnalysisRequest({ type: "registerSources", sources: allFiles });
}

// ============================================================================
// Execution Worker - On-demand for code execution (can be terminated)
// ============================================================================

const execution = createWorkerManager();

async function loadExecutionWorker(): Promise<void> {
	const robloxStudioFlagsPromise = getRobloxStudioFlagPayload();

	return loadWorker(execution, "Execution", {
		checkTerminated: true,
		postInit: async () => {
			const robloxStudioFlags = await robloxStudioFlagsPromise;
			if (robloxStudioFlags) {
				await sendToWorker(execution, { type: "setFFlags", serializedFlags: robloxStudioFlags });
			}

			const currentSettings = get(settings);
			await sendToWorker(execution, { type: "setMode", mode: modeToNum(currentSettings.mode) });
		},
	});
}

async function sendExecutionRequest<T extends WorkerRequest["type"]>(
	params: Extract<WorkerRequest, { type: T }>
): Promise<ResponseForRequest<T>> {
	await loadExecutionWorker();

	if (!execution.worker) throw new Error(STOPPED_ERROR);

	return sendToWorker(execution, params);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Load/initialize the Luau WASM workers.
 * Starts the analysis worker (long-lived).
 */
export async function loadLuauWasm(): Promise<void> {
	await loadAnalysisWorker();
}

/**
 * Stop any running execution by terminating the execution worker.
 * The analysis worker stays alive for LSP/bytecode operations.
 */
export function stopExecution(): void {
	if (!execution.worker && !execution.readyPromise) return; // Nothing to stop

	terminateWorker(execution);
	setRunning(false);
	appendOutput({ type: "warn", text: STOPPED_ERROR });
}

/**
 * Execute Luau code using the execution worker.
 */
export async function executeCode(
	code: string
): Promise<{ result: ExecuteResult; elapsed: number }> {
	try {
		const response = await sendExecutionRequest({ type: "execute", code });
		return { result: response.result, elapsed: response.elapsed };
	} catch (error) {
		// Silently handle stopped/cancelled - no error to report
		if (
			error instanceof Error &&
			(error.message === STOPPED_ERROR || error.message === CANCELLED_ERROR)
		) {
			return { result: { success: false, output: "", error: undefined }, elapsed: 0 };
		}

		const errorMsg = error instanceof Error ? error.message : String(error);
		return { result: { success: false, output: "", error: errorMsg }, elapsed: 0 };
	}
}

/**
 * Get diagnostics for code using the analysis worker.
 */
export async function getDiagnostics(
	code: string
): Promise<{ diagnostics: LuauDiagnostic[]; elapsed: number }> {
	try {
		await syncAnalysisSources();

		const response = await sendAnalysisRequest({ type: "getDiagnostics", code });
		const diagnostics = response.result.diagnostics.filter(
			(diag) => !diag.moduleName || diag.moduleName === "main"
		);
		return { diagnostics, elapsed: response.elapsed };
	} catch (error) {
		console.error("[Luau] Diagnostics error:", error);
		return { diagnostics: [], elapsed: 0 };
	}
}

/**
 * Get autocomplete suggestions using the analysis worker.
 */
export async function getAutocomplete(
	code: string,
	line: number,
	col: number
): Promise<LuauCompletion[]> {
	try {
		await syncAnalysisSources();
		const response = await sendAnalysisRequest({ type: "autocomplete", code, line, col });
		return response.result.items;
	} catch (error) {
		console.error("[Luau] Autocomplete error:", error);
		return [];
	}
}

/**
 * Get hover information using the analysis worker.
 */
export async function getHover(code: string, line: number, col: number): Promise<string | null> {
	try {
		await syncAnalysisSources();
		const response = await sendAnalysisRequest({ type: "hover", code, line, col });
		return response.result.content;
	} catch (error) {
		console.error("[Luau] Hover error:", error);
		return null;
	}
}

/**
 * Get list of available modules for autocomplete.
 */
export async function getAvailableModules(): Promise<string[]> {
	try {
		await syncAnalysisSources();
		const response = await sendAnalysisRequest({ type: "getModules" });
		return response.result.modules;
	} catch (error) {
		console.error("[Luau] Failed to get modules:", error);
		return [];
	}
}

/**
 * Set the type checking mode on the analysis worker.
 */
export async function setLuauMode(mode: LuauMode): Promise<void> {
	try {
		await sendAnalysisRequest({ type: "setMode", mode: modeToNum(mode) });
		// Also update execution worker if it's running
		if (execution.ready) {
			await sendToWorker(execution, { type: "setMode", mode: modeToNum(mode) });
		}
	} catch (error) {
		console.error("[Luau] Failed to set mode:", error);
	}
}

/**
 * Set the solver mode on the analysis worker.
 */
export async function setLuauSolver(solver: SolverMode): Promise<void> {
	try {
		await sendAnalysisRequest({ type: "setSolver", isNew: solver === "new" });
		// Also update execution worker if it's running
		if (execution.ready) {
			await sendToWorker(execution, { type: "setSolver", isNew: solver === "new" });
		}
	} catch (error) {
		console.error("[Luau] Failed to set solver:", error);
	}
}

// Subscribe to settings changes and sync to WASM
let settingsUnsubscribe: (() => void) | null = null;

export function initSettingsSync(): void {
	if (settingsUnsubscribe) return;

	settingsUnsubscribe = settings.subscribe(async (newSettings) => {
		if (analysis.ready) {
			await setLuauMode(newSettings.mode);
			await setLuauSolver(newSettings.solver);
		}
	});
}

// Run ID to track and cancel specific runs
let currentRunId = 0;

/**
 * Run the active file and display output.
 */
export async function runCode(): Promise<void> {
	const myRunId = ++currentRunId;

	// Set running state before termination to avoid brief isRunning=false gap
	setRunning(true);
	clearOutput();
	setExecutionTime(null);

	// Stop any existing execution silently (not user-initiated)
	if (execution.worker) {
		terminateWorker(execution, CANCELLED_ERROR);
	}

	try {
		const code = getActiveFileContent();
		const fileName = get(activeFile);

		appendOutput({ type: "log", text: `Running ${fileName}...` });

		// Register all files as modules for require support
		const allFiles = getAllFiles();
		await sendExecutionRequest({ type: "registerModules", modules: allFiles });

		if (currentRunId !== myRunId) return;

		const { result, elapsed } = await executeCode(code);

		if (currentRunId !== myRunId) return;

		setExecutionTime(elapsed);

		if (result.prints && result.prints.length > 0) {
			for (const values of result.prints) {
				appendOutput({ type: "log", text: "", values });
			}
		} else if (result.output) {
			for (const line of result.output.split("\n")) {
				appendOutput({ type: "log", text: line });
			}
		}

		if (!result.success && result.error) {
			for (const line of result.error.split("\n")) {
				appendOutput({ type: "error", text: line });
			}
		}
	} catch (error) {
		if (
			currentRunId === myRunId &&
			error instanceof Error &&
			error.message !== STOPPED_ERROR &&
			error.message !== CANCELLED_ERROR
		) {
			appendOutput({ type: "error", text: "Error: "+error.message });
		}
	} finally {
		if (currentRunId === myRunId) {
			setRunning(false);
			// Terminate execution worker to free memory when not running
			// Worker startup is fast enough (~20-50ms) to recreate on demand
			if (execution.worker) {
				terminateWorker(execution, "Execution complete");
			}
		}
	}
}

/**
 * Run type checking on the active file and display diagnostics.
 * Uses the analysis worker so it works even during execution.
 */
export async function checkCode(): Promise<void> {
	const myRunId = ++currentRunId;

	setRunning(true);
	clearOutput();
	setExecutionTime(null);

	try {
		const code = getActiveFileContent();
		const fileName = get(activeFile);

		appendOutput({ type: "log", text: `Type checking ${fileName}...` });

		const { diagnostics, elapsed } = await getDiagnostics(code);

		if (currentRunId !== myRunId) return;

		setExecutionTime(elapsed);

		if (diagnostics.length === 0) {
			appendOutput({ type: "log", text: "✓ No type errors found" });
		} else {
			const errorCount = diagnostics.filter((d) => d.severity === "error").length;
			const warningCount = diagnostics.filter((d) => d.severity === "warning").length;

			const summary = [];
			if (errorCount > 0) summary.push(`${errorCount} error${errorCount !== 1 ? "s" : ""}`);
			if (warningCount > 0) summary.push(`${warningCount} warning${warningCount !== 1 ? "s" : ""}`);

			appendOutput({ type: "log", text: `Found ${summary.join(", ")}:` });
			appendOutput({ type: "log", text: "" });

			for (const diag of diagnostics) {
				const location = `${fileName}:${diag.startLine + 1}:${diag.startCol + 1}`;
				const type =
					diag.severity === "error" ? "error"
					: diag.severity === "warning" ? "warn"
					: "log";
				appendOutput({ type, text: `${location}: ${diag.message}` });
			}
		}
	} catch (error) {
		if (
			currentRunId === myRunId &&
			error instanceof Error &&
			error.message !== STOPPED_ERROR &&
			error.message !== CANCELLED_ERROR
		) {
			appendOutput({ type: "error", text: "Error: "+error.message });
		}
	} finally {
		if (currentRunId === myRunId) {
			setRunning(false);
		}
	}
}

/**
 * Get bytecode dump for code using the analysis worker.
 */
export async function getBytecode(
	code: string,
	optimizationLevel: number = 2,
	debugLevel: number = 2,
	outputFormat: number = 0,
	showRemarks: boolean = false
): Promise<{ success: boolean; bytecode: string; error?: string }> {
	try {
		const response = await sendAnalysisRequest({
			type: "getBytecode",
			code,
			optimizationLevel,
			debugLevel,
			outputFormat,
			showRemarks,
		});
		return response.result;
	} catch (error) {
		return {
			success: false,
			bytecode: "",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

// Export types
export type { LuauDiagnostic, LuauCompletion, ExecuteResult };
