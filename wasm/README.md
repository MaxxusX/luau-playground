# Luau Playground WASM Module

This directory contains the WebAssembly build of Luau for the playground. It includes both **code
execution** (VM) and **analysis** (type checking, autocomplete, hover) capabilities.

## Prerequisites

1. **Emscripten SDK**: Install from https://emscripten.org/docs/getting_started/downloads.html
2. **CMake 3.16+**

## Building

```bash
# Activate Emscripten (adjust path as needed)
source ~/emsdk/emsdk_env.sh

# Build release version
./build.sh release

# Or debug version
./build.sh debug
```

The build script will:

1. Clone the Luau source if not present
2. Configure with CMake using Emscripten
3. Build the WASM module
4. Copy output to `../static/wasm/`

## Exported Functions

### Execution

- `luau_execute(code: string)` - Execute Luau code, returns JSON with output and any errors
- `luau_compile(code: string)` - Compile code to bytecode (for validation)
- `luau_reset()` - Reset the execution state

### Analysis

- `luau_get_diagnostics(code: string)` - Get type errors and lint warnings
- `luau_autocomplete(code: string, line: number, col: number)` - Get completion suggestions
- `luau_hover(code: string, line: number, col: number)` - Get type info for hover
- `luau_signature_help(code: string, line: number, col: number)` - Get function signatures

### Utility

- `luau_version()` - Get the Luau version string

## Output Format

All functions return JSON strings. Example responses:

````json
// luau_execute
{ "success": true, "output": "Hello, World!" }
{ "success": false, "output": "", "error": "attempt to call nil" }

// luau_get_diagnostics
{ "diagnostics": [
  { "severity": "error", "message": "...", "startLine": 0, "startCol": 0, "endLine": 0, "endCol": 5 }
]}

// luau_autocomplete
{ "items": [
  { "label": "print", "kind": "function", "detail": "(string) -> ()", "deprecated": false }
]}

// luau_hover
{ "content": "```luau\nprint: (string) -> ()\n```" }
````
