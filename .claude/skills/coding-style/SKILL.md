---
name: coding-style
description: Code style guidelines for the VizCode project. These rules must be followed whenever adding or modifying any Python or TypeScript code. Use this skill whenever writing or reviewing code in this project.
---

# VizCode Code Style Guidelines

## General Principles

- **Zero external dependencies**: Never introduce third-party packages requiring `pip install`. Only Python standard library is allowed. The same applies to the frontend — only libraries already loaded in `static/launcher.html` or `static/` may be used (currently Cytoscape + cytoscape-dagre and highlight.js for the main view; Sigma + graphology for the Galaxy view).
- **Single responsibility**: Each function does one thing only. If it exceeds 60 lines, consider splitting it.
- **Silent fail**: All I/O and regex inside parsers must be wrapped in `try/except`. On parse failure, return an empty value — never let exceptions propagate upward and abort the entire analysis.

---

## Python Guidelines

### Naming
```python
# Constants → UPPER_SNAKE_CASE
SCAN_EXT = {'.py', '.js'}
MAX_FILE_BYTES = 2 * 1024 * 1024

# Functions/methods → snake_case, private functions prefixed with underscore
def scan_file(filepath: str, root: str): ...
def _build_search_index(jid: str, root: str): ...

# Classes → PascalCase (rarely used in this project)
class Handler(BaseHTTPRequestHandler): ...
```

### Import Order
```python
# 1. Standard library
import os, re, json, sys
from pathlib import Path
from typing import Dict, Optional

# 2. Project modules (use explicit paths, no wildcard imports)
from parsers.bios_parser import scan_bios
```

### Type Annotations
- Add type annotations to parameters and return values of public functions
- Use `Dict[str, str]` or `list[dict]` for complex dict/list structures
- Don't sacrifice readability for type annotations — internal helper functions may omit them

### String Formatting
- Prefer f-strings: `f'Found {total} files'`
- Use triple quotes for multiline strings, aligned with indentation

### Error Handling
```python
# Good: explicit catch, silent fail
try:
    src = Path(filepath).read_text(encoding='utf-8', errors='replace')
except Exception:
    return [], [], [], None, []

# Bad: bare except tells you nothing about what happened
try:
    ...
except:
    pass
```

### Section Comment Style
Use `# ─── Title ───` to separate major blocks (using `─`, Unicode U+2500):
```python
# ─── Constants ───────────────────────────────────────────────────────────────
SKIP_DIRS = { ... }

# ─── HTTP Handler ─────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
```

### Dict Alignment (optional)
In constant dictionaries, aligning values improves readability:
```python
EDGE_TYPES = {
    'include':   {'label': 'Include', 'color': '#c084fc'},
    'sources':   {'label': 'Sources', 'color': '#ffd700'},
    'import':    {'label': 'Import',  'color': '#10b981'},
}
```

---

## JavaScript Guidelines (`static/viz.ts`, `static/core/i18n.ts`, all files under `static/core|ui|features|file_viewers/`)

### Naming
```javascript
// Constants → UPPER_SNAKE_CASE
const FILE_TYPE_SHAPE = { ... };
const MAX_LABEL_LEN = 24;

// Functions → camelCase
function extColor(ext) { ... }
function buildGraph(data) { ... }

// Private helpers → underscore prefix + camelCase (optional, context-dependent)
function _applyL2Snapshot(slot) { ... }
```

### DOM Manipulation
- Avoid repeated `document.getElementById` calls — declare at the top as constants or cache in an init function
- Use `addEventListener` for event listeners, never inline `onclick`

### Async
- Use `async/await` + `try/catch`, not bare `.then().catch()`
- Handle both HTTP errors and network errors in fetch calls:
```javascript
async function fetchData(url) {
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (e) {
        console.error('[fetchData]', e);
        return null;
    }
}
```

### Module Organization
- Group related constants, state, and functions together, separated by block comments:
```javascript
// ── Graph state ───────────────────────────────────────────────────────────────
let currentJobId = null;
let graphData = null;

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderGraph(data) { ... }
```

### Prohibited
- Never use `var` — use `const` or `let`
- No global pollution — do not attach extra properties to `window`
- Never use `innerHTML` to splice in user input (XSS risk) — use `textContent` or DOM APIs

---

## Parser Interface Contract (when adding or modifying `src/parsers/`)

The main function of every `src/parsers/*.py` must return this tuple format:

```python
return (
    imports_or_refs,      # list[str]
    funcdefs,             # list[dict]: [{label, is_efiapi, is_static}, ...]
    funccalls,            # list[str]
    extra_dict,           # dict | None
    func_calls_by_func,   # list[list[str]]
    symbol_defs,          # list[dict] | None  — fine-grained symbol nodes (classes/methods/etc.)
)
```

**Never** directly import or modify constants from `src/core/analyze_viz.py` inside a parser. Parsers are pure text transformers — they have no knowledge of the outside world.