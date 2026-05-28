---
name: add-language-parser
description: Add or improve language support in VIZCODE — covers import/dependency edges, function/class node detection, file type shape, and legend entries. Use this skill whenever the user wants to add a new programming language, fix incorrect parsing for an existing language, strengthen edge connections between files, or report that a language's imports/functions aren't being detected. Also triggers when the user says "add support for X", "X files aren't showing edges", or "fix X parser".
---

# SKILL: Add Language Support to VIZCODE

VIZCODE supports two tiers of language parsers:

- **Dedicated parsers** (`src/parsers/<lang>_parser.py`) — Python, JS/TS, Go, BIOS/C/C++. Full AST-level analysis.
- **Common parser** (`src/parsers/common_parser.py`) — Regex-based fallback for 52+ other languages. This is almost always the right place to add new languages.

This skill focuses on the common parser path, which handles: Rust, Java, Kotlin, Scala, C#, Ruby, Swift, Dart, Elixir, Erlang, Haskell, OCaml, F#, Lua, PHP, Perl, R, Julia, Nim, Zig, D, Clojure, SQL, GraphQL, Protobuf, Shell, and more.

---

## Step 0: Research the Language Syntax First (research-driven, not from memory)

Before touching any code, verify the exact syntax rules against an **authoritative
reference**. Wrong regex = silent wrong edges, and edges are the product. Do not write a
single pattern from memory — fetch the grammar, then implement against it.

### 0a. Fetch authoritative grammar references

Pull the real syntax from a canonical source before writing regex:

| Family | Authoritative sources |
|--------|----------------------|
| JS / TS | ECMAScript spec (`tc39.es/ecma262`), TypeScript Handbook, MDN |
| Java / Kotlin / Scala | Java Language Specification (JLS), Kotlin/Scala language reference |
| Rust | The Rust Reference (`doc.rust-lang.org/reference`) |
| Go | Go Language Specification (`go.dev/ref/spec`) |
| Python | Python Language Reference (`docs.python.org/3/reference`) |
| C# / .NET | C# language spec / Microsoft Learn |
| Others | The language's **official reference manual / grammar (BNF/EBNF)**, then the stdlib docs |

Tooling to fetch them:
- `WebFetch` / `WebSearch` for spec pages and grammar sections.
- **context7 MCP** for library/framework syntax: `resolve-library-id` → `query-docs`.

Prefer the spec/reference over blog posts. Do not guess.

### 0b. Answer these questions from the reference (cite where each came from)
1. **Import/dependency syntax** — How does this language declare dependencies? (`import`, `require`, `use`, `include`, `#include`)
2. **Static/re-export forms** — Are there `import static`, `pub use`, `export … from` variants?
3. **Function definition keywords** — `def`, `fn`, `func`, `fun`, `sub`, `proc`, `defn`?
4. **Class/module keywords** — `class`, `module`, `struct`, `record`, `trait`, `interface`, `defmodule`?
5. **Line comment syntax** — `//`, `#`, `--`, `;`, `%`?
6. **What the import string refers to** — a namespace (take last segment), a file path (take stem), or a mix?
7. **Module system or global scope?** — Does the codebase actually *use* the import system,
   or do files share a global namespace via `<script>` tags / a global object? (See the
   "Global-script / non-ESM edge detection" chapter below — this is exactly why VIZCODE's
   own `static/*.js` showed zero edges.)

### 0c. Output of this step
A short note (in the PR/commit body) listing **which syntax forms you verified and the
source** — e.g. "ESM `import … from` and `export … from` per tc39.es/ecma262 §16.2;
confirmed against MDN". This is the audit trail that justifies every regex you add.

---

## Step 1: Add Import Patterns — `src/parsers/common_parser.py`

### 1a. Map file extension to language name

Find `_EXT_TO_LANG` dict. Add entries if missing:

```python
_EXT_TO_LANG = {
    # existing...
    '.nim': 'nim',
    '.hrl': 'erlang',   # Erlang header files
    '.cljs': 'clojure',
}
```

### 1b. Add comment-stripping awareness

Find `_strip_comments(src, lang)`. The function has three branches:

| Branch | Languages | Pattern |
|--------|-----------|---------|
| `_RE_LINE_COMMENT_UNIVERSAL` | Most languages | `//` and `#` |
| `_RE_LINE_COMMENT_SQL` | SQL, Haskell, Lua, Erlang | `--` |
| `_RE_LINE_COMMENT_LISP` | Clojure, Common Lisp | `;` |

If your language uses a different comment character (e.g. `%` for Erlang/LaTeX, `*` for COBOL), add a new regex constant and branch.

### 1c. Add to `_LANG_IMPORT_PATTERNS`

This is the most important step. The list is ordered; first match wins for each language. Each entry:

```python
(lang_set, compiled_regex)
```

Where `lang_set` is a `set` of language strings from `_EXT_TO_LANG`.

**Template for a new language:**
```python
# YourLanguage — <brief description of import syntax>
({'yourlang'}, re.compile(
    r'^[ \t]*<import_keyword>\s+(<capture_group>)',
    re.MULTILINE
)),
```

**Critical rules for capture groups:**
- Capture exactly what you need to resolve — typically the module name or file path
- For JVM/CLR languages (Java, Kotlin, C#): capture the full dotted path, then take the **last segment** (done automatically by `_extract_imports`)
- For Java `import static`: use **two capture groups** `(static\s+)?([\w.]+)` — the function detects group 1 = "static" and uses `segs[-2]` (class name, not method name)
- For file-path imports (Ruby `require_relative`, Erlang `-include`, Shell `source`): the ref contains `/` or a known extension — the function takes the **file stem** automatically via `_KNOWN_FILE_EXTS`
- For Rust `use`: colons `::` are the separator — split on `::` and take last non-`*` segment

**Examples of existing patterns to reference:**

```python
# Rust
({'rust'}, re.compile(r'^[ \t]*(?:pub\s+)?use\s+([\w:]+(?:::\w+)*)', re.MULTILINE)),
({'rust'}, re.compile(r'^[ \t]*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;', re.MULTILINE)),

# Java/Kotlin/Scala/Groovy — two-group for static import detection
({'java', 'kotlin', 'scala', 'groovy'}, re.compile(
    r'^[ \t]*import\s+(static\s+)?([\w.]+)', re.MULTILINE)),

# Erlang — file include (path-style ref)
({'erlang'}, re.compile(
    r'''^-(?:include|include_lib)\s*\(\s*"([^"]+)"\s*\)''', re.MULTILINE)),

# Shell — source and dot-include
({'shell'}, re.compile(
    r'^[ \t]*(?:source|\.)\s+["\']?([^\s"\'#]+)["\']?', re.MULTILINE)),

# Ruby — require and require_relative
({'ruby'}, re.compile(r'''^[ \t]*require(?:_relative)?\s+['"]([^'"]+)['"]''', re.MULTILINE)),
```

### 1d. Add file extensions to `_KNOWN_FILE_EXTS` if needed

`_KNOWN_FILE_EXTS` is a regex that matches file extensions in import strings. When a captured ref matches this, `_extract_imports` treats it as a file path and takes the **stem** instead of the last namespace segment.

```python
_KNOWN_FILE_EXTS = re.compile(
    r'\.(rb|py|lua|sh|bash|hrl|dart|proto|graphql|gql|nim|zig|cr|ex|exs|'
    r'erl|ml|mli|fs|fsx|r|jl|d|clj|cljs|sql|toml|yaml|yml|json)$',
    re.IGNORECASE
)
```

Add the extension here if import strings include a file extension (e.g. `#include "records.hrl"`, `require 'utils.rb'`).

---

## Step 2: Add Function Definition Patterns — `_FUNCDEF_PATTERNS`

Find the `_FUNCDEF_PATTERNS` list. Each entry is a compiled regex with at least one capture group for the function name.

**Rules:**
- Must not match class/module definitions (those go in `_CLASSDEF_PATTERNS`)
- Use `\b` word boundaries to avoid partial matches
- Account for common modifiers (access modifiers, `async`, `static`, etc.) as optional non-capturing groups

```python
# Template
re.compile(r'^\s*(?:modifier\s+)*def_keyword\s+(\w+)\s*[(<]', re.MULTILINE),
```

**What already exists (do not duplicate):**
- `def \w+` (Python-style)
- `fn \w+` (Rust/Zig-style)
- `func \w+` (Go/Swift-style)
- `function \w+` and `\w+\s*=\s*function` (JS-style)
- `defp`, `defmacro` (Elixir)
- `proc`, `method`, `template`, `iterator` (Nim)
- `CREATE FUNCTION/PROCEDURE` (SQL)
- `Function \w+` (VB.NET)

**If adding something new**, look for the comment `# ── Function definitions ──` and insert after existing entries for the same language family.

---

## Step 3: Add Class/Module Definition Patterns — `_CLASSDEF_PATTERNS`

Same structure as `_FUNCDEF_PATTERNS`. Each entry is a `(regex, kind_string)` tuple:

```python
(re.compile(r'^\s*<keyword>\s+(\w+)', re.MULTILINE), 'class'),  # or 'interface', 'struct', 'module', 'record', 'trait'
```

**Available kind strings:** `'class'`, `'interface'`, `'struct'`, `'module'`, `'record'`, `'trait'`

**What already exists:** Python `class`, Java `class/interface/enum`, C# `class/interface/struct/record`, Rust `struct/trait/impl`, Elixir `defmodule`, Erlang `-module()`, Haskell `class where`, Julia `struct/abstract type`, SQL `CREATE TABLE/VIEW`, Clojure `defrecord/defprotocol/definterface`, Nim type section.

### Kind detection via `_KIND_KEYWORD_MAP`

`_detect_kind_keyword(full_match)` scans the full matched line using word-boundary regexes to determine the kind. If you add a new keyword to `_CLASSDEF_PATTERNS`, also add it to `_KIND_KEYWORD_MAP`:

```python
_KIND_KEYWORD_MAP = [
    (re.compile(r'\byour_keyword\b', re.I), 'struct'),  # or appropriate kind
    # ...
]
```

**Gotcha:** Patterns starting with `-` (Erlang `-module`) cannot use `\b` before the hyphen. Use `re.compile(r'-module\b')` (no leading `\b`).

---

## Step 4: Add to `_SKIP_NAMES` if Needed

`_SKIP_NAMES` prevents false positives — common keywords or type names that look like class names but aren't. If your language has SQL-like type names or reserved words that appear after `class`/`struct` keywords:

```python
_SKIP_NAMES = {
    'VARCHAR', 'INT', 'BOOLEAN', 'TEXT',  # SQL types
    'your_keyword',                         # add if needed
}
```

---

## Step 5: Update Frontend — `static/core/viz_constants.js`

### 5a. File extension color — `extColor()`

Find the `extColor` function. Add a `case` for the new extension returning a hex color:

```javascript
case 'nim': return '#FFE953';   // Nim yellow
case 'zig': return '#F7A41D';   // Zig orange
```

Pick a color that's visually distinct from nearby languages in the same family.

### 5b. Node shape — `FILE_TYPE_SHAPE`

Find `FILE_TYPE_SHAPE`. Map the file type key (matches `FILE_TYPE_MAP` in `src/core/analyze_viz.py`) to a Cytoscape shape:

```javascript
const FILE_TYPE_SHAPE = {
    // existing...
    nim: 'pentagon',
    zig: 'hexagon',
};
```

**Shape guide by language family:**
| Family | Shapes to use |
|--------|--------------|
| JVM (Java/Kotlin/Scala) | `round-rectangle`, `cut-rectangle`, `rhomboid` |
| Systems (C/Rust/Zig) | `hexagon`, `diamond` |
| Scripting (Ruby/Lua) | `diamond`, `tag` |
| Functional (Haskell/OCaml/F#) | `rhomboid`, `concave-hexagon` |
| Shell | `tag` |
| Data/Schema (SQL/Proto/GraphQL) | `barrel`, `concave-hexagon`, `round-tag` |
| Other | `ellipse` (default fallback) |

### 5c. Human-readable name — `FILE_TYPE_FULL_NAME`

```javascript
const FILE_TYPE_FULL_NAME = {
    // existing...
    nim: 'Nim',
    zig: 'Zig',
};
```

### 5d. Legend entry — `LEGEND_NODES`

Find the appropriate family block in `LEGEND_NODES` and add:

```javascript
{ label: 'Nim', shape: 'pentagon', color: '#FFE953' },
```

---

## Step 6: Verify — Quick Smoke Test

```python
# Run from project root (bash). Add src/ to sys.path so the package layout resolves.
python - <<'EOF'
import sys; sys.path.insert(0, 'src')
from parsers.common_parser import scan_common

# Replace with your language's sample code
sample = """
import MyModule
import static java.util.Arrays.asList

fun myFunction(x: Int): String { return x.toString() }

class MyService : BaseService() {
    fun helper() {}
}
"""

result = scan_common(sample, '.kt')
imports, funcdefs, funccalls, extra, calls_by_func, *rest = result
print('imports:', imports)
print('funcdefs:', [f['label'] for f in funcdefs])
print('classes:', extra.get('classdefs', []) if extra else [])
# Note: dedicated parsers also return a 6th `symbol_defs`; common_parser may omit it.
EOF
```

Expected checks:
- `imports` should contain module names, NOT full dotted paths, NOT method names from `import static`
- `funcdefs` should list function names without keywords
- `classdefs` in `extra` should have the class name with correct kind

---

## Step 7: Update CLAUDE.md (only when contract changes)

After adding a new language, update [CLAUDE.md](CLAUDE.md) only if:
- A new file type key was added to `FILE_TYPE_MAP` in `src/core/analyze_viz.py`
- The parser interface tuple changed (the 6-tuple contract documented in CLAUDE.md)
- A new dedicated parser file was created under `src/parsers/`

For `common_parser.py` additions only (no new files, no interface changes), CLAUDE.md does not need to change.

---

## Chapter: Global-script / non-ESM edge detection

Some codebases have source files but **no `import` / `require` / `export from`** at all.
Files share a single **global namespace**, loaded as ordered `<script>` tags, and talk to
each other through global function names and a global object (`window.X` / `globalThis.X`).
VIZCODE's own `static/*.js` is exactly this shape — which is why scanning it produced **zero
edges**: the import-edge pass had no refs to resolve.

### How to detect it
A folder with many source files of one language but where a grep for that language's import
keyword returns **nothing**. (For JS/TS: zero `import`/`require`/`export from` across the
folder.) The regexes aren't wrong — the code uses no module system.

### Why regex alone can't fix it
File-to-file (L1) edges in `src/core/analyze_viz.py` are built **only** from the per-file
import/refs list. Cross-file *function calls* never create file edges — call-edge resolution
is per-file (`fid_map` is built from a single file's own defs). So no imports ⇒ no edges,
regardless of how good the function/class regex is.

### The fix: global-symbol cross-file resolution
Link a file that **uses** a global to the file that **defines** it:

1. **Parser** (`src/parsers/js_parser.py`): capture global-namespace assignments
   `window.X = …` / `globalThis.X = …` into `extra['global_defs']`, and member reads
   `window.X` into `extra['global_uses']`. Use a single-`=` negative lookahead `=(?!=)` so
   `===` comparisons are reads, not definitions.
2. **Analyzer** (`src/core/analyze_viz.py`): before the edge loop, build
   `global_def_index: name → {defining files}` from each JS/TS file's **top-level**
   `symbol_defs` (kind function/class/interface/enum/namespace, `parent is None`) plus its
   `global_defs`. In the JS/TS edge branch, for a file's uses (`all_calls` + `global_uses`),
   emit an `import` edge to the single definer of each used name.

### Guards (essential — copy these, they prevent edge explosion)
- **Skip keywords/builtins** (reuse the parser's `JS_KEYWORDS` set) and names `< 3` chars.
- **Unambiguous-only**: if a name is defined in more than one file, skip it. This naturally
  drops generic names like `init` / `render` / `update` that appear everywhere.
- **Per-file ESM-empty gate**: run the fallback for a file **only when it emitted zero
  import/require refs**. This targets the global-script case and keeps real ESM/npm projects
  (which have genuine imports) free of spurious global-name edges.
- Reuse the existing `'import'` edge type so L1 rendering and the legend need no changes.
- **Carry the linking symbol on the edge** as `via`. Unlike an ESM edge, a global-script
  edge has no import line to highlight when clicked, so the code panel must highlight the
  *symbol-use* line. `add_edge(..., via=name)` stores it; `graph_l1.js` copies `e.via` onto
  the cytoscape edge; `onEdgeTap` (L1) passes `d.via` to `jumpToImport`, which word-boundary
  matches the symbol in the source. Without `via`, clicking the edge highlights nothing.

### Verify
Confirm the previously-edgeless folder now yields edges, and a real ESM project still shows
only its genuine imports:
```python
import sys; sys.path.insert(0, 'src')
from core.analyze_viz import build_graph
g = build_graph('<folder>')
import itertools
print(sum(len(v) for v in g['file_edges_by_module'].values()), 'edges')
```

### Applying to other languages
The same shape appears beyond JS (e.g. Lua files loaded by a host, shell scripts sharing a
sourced environment). The technique generalises: capture global defs + global uses in the
parser, resolve unambiguous cross-file names in `analyze_viz.py`, gate to the
no-import case.

---

## Rules

- **Never break existing languages.** The `_LANG_IMPORT_PATTERNS` list is ordered — inserting in the wrong place can shadow existing patterns. Add new language entries in alphabetical order within their language family section.
- **Zero external dependencies.** Only Python stdlib regex. No `pip install`.
- **Test with adversarial cases.** Verify that `import static java.util.Arrays.asList` gives `Arrays` not `asList`. Verify that Erlang `-include("records.hrl")` gives `records` not `hrl`.
- **Comment stripping must match language.** A semicolon-comment language should be in `_RE_LINE_COMMENT_LISP` branch, not stripped by `_RE_LINE_COMMENT_UNIVERSAL`.
- **Kind detection uses word boundaries.** Never use `'keyword' in text.lower()` — use `\bkeyword\b` regex to avoid `UserService` being detected as kind `service`.
