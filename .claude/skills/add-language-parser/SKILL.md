---
name: add-language-parser
description: Add or improve language support in VIZCODE — covers import/dependency edges, function/class node detection, file type shape, and legend entries. Use this skill whenever the user wants to add a new programming language, fix incorrect parsing for an existing language, strengthen edge connections between files, or report that a language's imports/functions aren't being detected. Also triggers when the user says "add support for X", "X files aren't showing edges", or "fix X parser".
---

# SKILL: Add Language Support to VIZCODE

VIZCODE supports two tiers of language parsers:

- **Dedicated parsers** (`parsers/<lang>_parser.py`) — Python, JS/TS, Go, BIOS/C/C++. Full AST-level analysis.
- **Common parser** (`parsers/common_parser.py`) — Regex-based fallback for 52+ other languages. This is almost always the right place to add new languages.

This skill focuses on the common parser path, which handles: Rust, Java, Kotlin, Scala, C#, Ruby, Swift, Dart, Elixir, Erlang, Haskell, OCaml, F#, Lua, PHP, Perl, R, Julia, Nim, Zig, D, Clojure, SQL, GraphQL, Protobuf, Shell, and more.

---

## Step 0: Research the Language Syntax First

Before touching any code, verify the exact syntax rules. Wrong regex = silent wrong edges.

Key questions to answer:
1. **Import/dependency syntax** — How does this language declare dependencies? (e.g. `import`, `require`, `use`, `include`, `#include`)
2. **Static/re-export forms** — Are there `import static`, `pub use`, `export from` variants?
3. **Function definition keywords** — `def`, `fn`, `func`, `fun`, `sub`, `proc`, `defn`?
4. **Class/module keywords** — `class`, `module`, `struct`, `record`, `trait`, `interface`, `defmodule`?
5. **Line comment syntax** — `//`, `#`, `--`, `;`, `%`?
6. **What the import string refers to** — a namespace (take last segment), a file path (take stem), or a mix?

Use web search or context7 MCP to verify. Do not guess.

---

## Step 1: Add Import Patterns — `parsers/common_parser.py`

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

## Step 5: Update Frontend — `static/viz_constants.js`

### 5a. File extension color — `extColor()`

Find the `extColor` function. Add a `case` for the new extension returning a hex color:

```javascript
case 'nim': return '#FFE953';   // Nim yellow
case 'zig': return '#F7A41D';   // Zig orange
```

Pick a color that's visually distinct from nearby languages in the same family.

### 5b. Node shape — `FILE_TYPE_SHAPE`

Find `FILE_TYPE_SHAPE`. Map the file type key (matches `FILE_TYPE_MAP` in `analyze_viz.py`) to a Cytoscape shape:

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
# Run from project root (bash)
python - <<'EOF'
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

imports, funcdefs, funccalls, extra, calls_by_func = scan_common(sample, '.kt')
print('imports:', imports)
print('funcdefs:', [f['label'] for f in funcdefs])
print('classes:', extra.get('classdefs', []) if extra else [])
EOF
```

Expected checks:
- `imports` should contain module names, NOT full dotted paths, NOT method names from `import static`
- `funcdefs` should list function names without keywords
- `classdefs` in `extra` should have the class name with correct kind

---

## Step 7: Update memory.md

After adding a new language, run the `update-memory-md` skill if:
- A new file type key was added to `FILE_TYPE_MAP` in `analyze_viz.py`
- The parser interface tuple changed
- A new dedicated parser file was created

For common_parser additions only (no new files, no interface changes), memory.md update is optional.

---

## Rules

- **Never break existing languages.** The `_LANG_IMPORT_PATTERNS` list is ordered — inserting in the wrong place can shadow existing patterns. Add new language entries in alphabetical order within their language family section.
- **Zero external dependencies.** Only Python stdlib regex. No `pip install`.
- **Test with adversarial cases.** Verify that `import static java.util.Arrays.asList` gives `Arrays` not `asList`. Verify that Erlang `-include("records.hrl")` gives `records` not `hrl`.
- **Comment stripping must match language.** A semicolon-comment language should be in `_RE_LINE_COMMENT_LISP` branch, not stripped by `_RE_LINE_COMMENT_UNIVERSAL`.
- **Kind detection uses word boundaries.** Never use `'keyword' in text.lower()` — use `\bkeyword\b` regex to avoid `UserService` being detected as kind `service`.
