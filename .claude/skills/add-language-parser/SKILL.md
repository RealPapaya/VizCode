---
name: add-language-parser
purpose: Production-grade parser engineering methodology for VIZCODE
description: Add or improve language support in VIZCODE - covers import/dependency edges, function/class node detection, file type shape, and legend entries. Use when adding a language, fixing parsing, strengthening cross-file edges, or diagnosing missing dependencies.
---

# SKILL: Add Language Support to VIZCODE

VIZCODE supports two tiers of language parsers:

- **Dedicated parsers** (`src/parsers/<lang>_parser.py`) - Python, JS/TS, Go, BIOS/C/C++. Full AST-level analysis where implemented.
- **Common parser** (`src/parsers/common_parser.py`) - Regex-based fallback for 52+ other languages.

This skill applies to both, but the implementation path differs.

## Mission

Add or improve language support in a way that is:

- Correct enough to trust
- Stable under adversarial code
- Conservative when ambiguous
- Reusable for future languages
- Grounded in authoritative syntax references

This is not a "write regex from memory" workflow. It is a parser engineering workflow.

---

## Step -1: Classify the Codebase Architecture First

Before writing any code, classify how the target codebase expresses dependencies and symbol visibility.

Choose the dominant architecture:

| Architecture | Description | Examples |
|---|---|---|
| ESM / module-based | Explicit import/export graph | modern JS/TS, Python packages |
| Global-script | Shared global namespace, runtime load order, global object | legacy JS `<script>` apps |
| Include-based | File inclusion creates visibility | PHP `include`, C `#include` |
| Linker-based | Symbols resolved at compile/link time | C/C++, Rust crates |
| Reflection-heavy | Runtime registration / reflection | Unity, Unreal |
| Plugin/runtime-discovery | Runtime-loaded extensions | VSCode extensions, plugin systems |

Required output before implementation:

- Selected architecture
- How cross-file visibility works
- Whether dependency edges are explicit or inferred
- What constitutes a definition
- What constitutes a use/reference

Do not assume every language uses import/export semantics.

---

## Step 0: Research the Language Syntax First

Before touching code, verify the exact syntax rules against an authoritative reference.

Wrong regex = silent wrong edges, and edges are the product. Do not write a pattern from memory.

### 0a. Fetch authoritative grammar references

Use canonical sources first:

| Family | Authoritative sources |
|---|---|
| JS / TS | ECMAScript spec (`tc39.es/ecma262`), TypeScript Handbook, MDN |
| Java / Kotlin / Scala | Java Language Specification (JLS), Kotlin/Scala language reference |
| Rust | The Rust Reference (`doc.rust-lang.org/reference`) |
| Go | Go Language Specification (`go.dev/ref/spec`) |
| Python | Python Language Reference (`docs.python.org/3/reference`) |
| C# / .NET | C# language spec / Microsoft Learn |
| Others | Official reference manual / grammar (BNF/EBNF), then stdlib docs |

Tooling:

- Web search / web fetch for spec pages and grammar sections
- context7 MCP for library/framework syntax when relevant

Prefer specs over blogs. Do not guess.

### 0b. Optional subagent research

When subagent tooling is available, delegate bounded syntax research to a cheaper or faster research agent only when it will save time.

Rules for delegated research:

- Give the subagent a narrow syntax question and require official sources first.
- Require source links for every claim.
- Require notes on ambiguity, unsupported syntax, and syntax forms that are intentionally out of scope.
- Treat the result as input, not authority. The main implementer remains responsible for validation, tests, and final parser behavior.

Do not delegate implementation ownership. Parser changes still need local reasoning, adversarial tests, and regression checks.

### 0c. Answer these questions from the reference

1. How does the language declare dependencies?
2. Are there static/re-export forms?
3. What keywords define functions?
4. What keywords define classes/modules/types?
5. What is the comment syntax?
6. What string, raw-string, rune, char, template, heredoc, or multiline literal forms can contain comment-looking text?
7. What does an import string refer to?
8. Does the codebase actually use a module system, or does it use globals / includes / runtime registration?

### 0d. Output of this step

Record a short note in the PR/commit body listing:

- Which syntax forms were verified
- Which source documented them
- Which syntax forms are intentionally unsupported

This is the audit trail for every parser rule.

---

## Precision-first policy

VIZCODE is a graph-analysis system.

False-positive edges are more damaging than missing edges because they visually corrupt the graph and create edge explosion.

When uncertain:

- Prefer skipping an edge over inventing one
- Prefer unambiguous resolution only
- Prefer explicit imports over inferred references
- Prefer stable precision over aggressive recall

Every inference feature must define:

- Precision risks
- Ambiguity policy
- False-positive suppression rules
- Fallback behavior

Examples of safe suppression:

- Skip names defined in multiple files
- Skip keywords and builtins
- Skip names shorter than 3 characters
- Gate inferred linkage behind "no explicit imports detected"

---

## Parser escalation strategy

Not every syntax feature should be solved with regex.

Choose the lightest parser strategy that safely handles the syntax complexity.

| Complexity | Recommended strategy |
|---|---|
| Simple import syntax | Regex |
| Nested expressions | Token-aware scanning |
| JSX / decorators / advanced TS | AST parser |
| Macro-heavy syntax | Specialized parser |
| Runtime-generated symbols | Heuristic inference |

Escalation rules:

- Do not force regex into syntax it cannot safely parse
- If regex becomes brittle, escalate the parser level
- Prefer stable partial extraction over fragile full extraction

---

## Comment Masking Policy

Comment stripping must be language-specific. There is no universal safe set of comment markers.

Before adding or changing comment handling:

- Verify the language's line and block comment syntax from an official reference.
- Check every literal form that can contain comment-looking text, including strings, raw strings, rune/char literals, template literals, heredocs, regex literals, and multiline strings.
- Do not remove or mask comment markers inside those literal forms.
- Preserve line positions when parser results expose line numbers. For multiline comments, keep newline characters in the masked source.
- Prefer token-aware masking over regex stripping when comments and literals can overlap.

---

## Validation matrix (required)

Every parser or edge-resolution change must be validated against both positive and adversarial cases.

Required validation categories:

| Category | Purpose |
|---|---|
| Happy-path | Expected syntax works |
| Ambiguous symbols | Duplicate names do not create false edges |
| Builtin/runtime names | Globals like `console`, `document`, `window` do not create edges |
| Existing module systems | Real imports remain authoritative |
| Comment stripping | Commented code produces no defs/imports |
| Literal/comment overlap | Comment markers inside strings/raw strings/runes/templates are not treated as comments |
| Line preservation | Multiline comments do not shift reported symbol line numbers |
| False-positive suppression | Generic names do not explode the graph |
| Regression | Existing language support still works |

Minimum requirement:

- At least 1 positive case
- At least 1 adversarial case
- At least 1 regression case

A parser change is incomplete without adversarial validation.

---

## Required enrichment pass: L1 edge types and L3 symbols

After any parser precision improvement, run the L1/L3 enrichment pass before shipping.

Read `references/l1-l3-enrichment.md` when the change affects any of:

- import/include/dependency extraction
- symbol definitions, parents, bases, signatures, decorators, docs, or complexity
- call extraction or per-function call lists
- file-level references that are not ordinary imports
- language-specific constructs that should appear in L3 Symbol View

The parser 6-tuple contract remains stable. Put optional enrichment in `extra`
and `symbol_defs`; do not add tuple slots unless the architecture is explicitly
changed.

Required output before implementation:

- Whether L1 edge output changes
- Whether L3 symbol output changes
- Which canonical edge/symbol fields are used
- Which language-specific details are stored as metadata instead of new primary types

Required verification before shipping:

- Run a graph-level test through `build_graph(...)`; parser-only tests are not enough.
- Confirm L1 edge types actually appear in `file_edges_by_module` with a count delta, not only in parser `extra['edge_hints']`.
- Confirm L3 edge types actually appear in `symbol_edges` with a count delta, not only in raw `symbol_defs`.
- Confirm enriched L3 fields are visible in `symbol_index` (`signature`, `decorators`, `complexity`, `type_refs`, `bases`, `parent`) when the change claims to populate them.
- When edge hints target files, create real target files in the fixture. The analyzer intentionally drops unresolved or ambiguous targets.
- For path-like references, include at least one source-relative path case and one ambiguous-name suppression case if duplicate basenames/stems are possible.

Example graph-level assertion shape:

```python
res = build_graph(str(tmp_path))
l1_types = {e.get('type') for edges in res['file_edges_by_module'].values() for e in edges}
l3_types = {e.get('type') for e in res.get('symbol_edges', [])}
assert {'asset_ref', 'config_ref'} <= l1_types
assert {'type_usage', 'implements'} <= l3_types
```

---

## Step 1: Add Import Patterns - `src/parsers/common_parser.py`

Use this section for languages handled by the common regex parser.

### 1a. Map file extension to language name

Find `_EXT_TO_LANG`. Add entries if missing:

```python
_EXT_TO_LANG = {
    # existing...
    '.nim': 'nim',
    '.hrl': 'erlang',
    '.cljs': 'clojure',
}
```

### 1b. Add comment-stripping awareness

Find `_strip_comments(src, lang)`.

Make sure the language's comments are stripped or masked correctly before regex parsing. Follow the Comment Masking Policy above; do not add marker-based stripping until literal exceptions and line preservation are understood.

### 1c. Add to `_LANG_IMPORT_PATTERNS`

Add a language-specific import regex only after verifying the actual syntax.

Rules:

- Capture the reference that identifies the dependency
- Be careful with static import forms
- For file-path imports, ensure file stem extraction works
- Keep patterns ordered so you do not shadow existing languages

### 1d. Add file extensions to `_KNOWN_FILE_EXTS` if needed

Add extensions when import strings include a file extension and should be treated as file paths.

---

## Step 2: Add Function Definition Patterns - `_FUNCDEF_PATTERNS`

Each entry should capture the function name without matching class/module definitions.

Rules:

- Use word boundaries
- Account for common modifiers
- Do not match class/module declarations
- Prefer conservative patterns over broad ones

---

## Step 3: Add Class/Module Definition Patterns - `_CLASSDEF_PATTERNS`

Each entry should capture the type/module name and map it to the correct kind.

Kinds include:

- `class`
- `interface`
- `struct`
- `module`
- `record`
- `trait`

If you add a new keyword, also add it to `_KIND_KEYWORD_MAP`.

---

## Step 4: Add to `_SKIP_NAMES` if Needed

Use `_SKIP_NAMES` to suppress false positives from keywords or type-like tokens that are not real symbols.

Examples:

- SQL types
- Reserved keywords
- Language-specific builtins that appear in declaration-like contexts

---

## Step 5: Update Frontend Visuals

Do this whenever a parser or analyzer change introduces a new visible node type,
file type key, edge type, symbol kind, or edge vocabulary that can reach the UI.

Do not let new nodes render as the generic white/fallback style. VIZCODE graphs
must remain visually scannable: distinct languages, schemas, configs, assets,
and semantic edge types need distinct colors and shapes where practical.

Primary L1/L2 file graph file:

- `static/core/viz_constants.js`

### 5a. File extension color - `extColor()`

Add a case for the new extension.

### 5b. Node shape - `FILE_TYPE_SHAPE`

Map the file type key to a Cytoscape shape.

### 5c. Human-readable name - `FILE_TYPE_FULL_NAME`

Add the display name.

### 5d. Legend entry - `LEGEND_NODES`

Add the label/shape/color entry if the UI needs to show it.

### 5e. Edge style - `EDGE_TYPE_STYLE` and `LEGEND_EDGES`

If a new L1 edge type is introduced, add:

- a non-fallback color
- a line style (`solid`, `dashed`, or `dotted`)
- a short label
- a legend entry

Existing canonical L1 enrichment edge types already have styles:

- `asset_ref` - cyan dashed
- `config_ref` - amber dashed

If these appear white, gray, unlabeled, or indistinguishable from `import`, fix
the frontend mapping before shipping.

### 5f. L3 Symbol View style

If a new L3 symbol edge type or symbol kind is introduced, update the Symbol View
styling instead of relying on fallback colors:

- `static/features/symbol_view/sv_core.js` for `_SV_EDGE_COLOR`
- `static/features/symbol_view/sv_graph.js` for edge verbs / card metadata when needed
- `static/features/symbol_view/symbol_view.css` if a new class needs distinct rendering

Existing canonical L3 edge types should remain visually distinct:

- `call`
- `inheritance`
- `implements`
- `override`
- `type_usage`
- `member`

When adding a symbol kind (for example `trait`, `record`, `module`, `typedef`),
verify the card/header/badge does not render as a generic white fallback.

### 5g. Visual verification

Before shipping a visual change:

- Run a sample project that actually emits the new node/edge types.
- Inspect the graph data and the rendered UI.
- Verify new L1 node borders/backgrounds use meaningful colors from `extColor()`.
- Verify L1 and L3 edges use distinct colors/styles and appear in legends/filters.
- Do not accept "all new nodes have white border" as a pass.

---

## Chapter: Global-script / non-ESM edge detection

Some codebases have source files but **no `import` / `require` / `export from`** at all.

Files share a single global namespace, are loaded as ordered `<script>` tags, and communicate through global function names and a global object (`window.X` / `globalThis.X`).

VIZCODE's own `static/*.js` is exactly this shape, which is why scanning it can produce zero edges if the analyzer only relies on imports.

### How to detect it

A folder with many source files of one language, but a grep for that language's import keyword returns nothing.

For JS/TS, zero `import` / `require` / `export from` across the folder is a strong signal.

### Why regex alone cannot fix it

File-to-file edges are built only from the per-file import/reference list.

Cross-file function calls do not automatically become file edges because call resolution is usually local to a file's own symbol table.

### The fix: global-symbol cross-file resolution

1. **Parser** (`src/parsers/js_parser.py`): capture global-namespace assignments like `window.X = ...` and `globalThis.X = ...` into `extra['global_defs']`, and member reads like `window.X` into `extra['global_uses']`. Use a single-`=` negative lookahead so `===` comparisons are not mistaken for definitions.
2. **Analyzer** (`src/core/analyze_viz.py`): build a project-wide `global_def_index` from top-level symbol definitions plus `global_defs`, then link each JS/TS file that uses a global name to the single unambiguous definer of that name.

### Guards

- Skip keywords and builtins
- Skip names shorter than 3 characters
- Only resolve names with exactly one defining file
- Only run fallback resolution when the file has zero explicit ESM imports/requires
- Reuse the existing `import` edge type so the UI does not need a new legend entry

### Verify

Confirm the previously-edgeless folder now yields edges, and a real ESM project still shows only its genuine imports.

---

## Step 6: Verification checklist

Before shipping a parser change, verify all of the following:

1. **Smoke test** - sample input parses with expected imports/defs/calls
2. **Adversarial test** - ambiguous or builtin names do not create false edges
3. **Regression test** - existing supported languages still work
4. **UI sanity** - file type and legend remain correct if a frontend change was made
5. **Graph sanity** - edge count changes match expectation and do not explode unexpectedly
6. **L1 type assertion** - `file_edges_by_module` contains the expected new edge type(s)
7. **L3 type assertion** - `symbol_edges` contains the expected new edge type(s)
8. **Visual assertion** - new node/edge types are not using generic fallback colors or white-only borders

If a change increases edges dramatically, inspect for false positives before merging.

Do not claim enrichment succeeded based only on comments in a fixture, parser
metadata, or expected labels in source code. The final check is the actual graph
output.

For demo fixtures, make references real:

- If a Java/Rust file references `config.json`, `app.yaml`, or `index.html`, add that target file.
- Avoid fixture paths that are ignored by project rules.
- Avoid duplicate basenames unless the test is explicitly checking ambiguity suppression.
- Prefer trusted file APIs (`new File("...")`, `Files.readString(Path.of("..."))`, `include_str!("...")`, `std::fs::read_to_string("...")`) over arbitrary string assignments. Plain strings should not create L1 edges.

---

## Step 7: Update CLAUDE.md only when contract changes

Update CLAUDE.md only if:

- A new file type key was added to `FILE_TYPE_MAP`
- The parser interface tuple changed
- A new dedicated parser file was created

For common_parser-only additions with no interface changes, CLAUDE.md usually does not need modification.

---

## Rules

- Never break existing languages
- Zero external dependencies
- Use authoritative references before syntax guesses
- Add new patterns conservatively
- Test with adversarial cases
- Prefer precision over recall
- Keep the parser contract stable unless the architecture explicitly changes

---

## Recommended deliverables for a language change

When you finish, include:

- What syntax was verified
- Which source documented it
- Which parser files changed
- What adversarial cases were tested
- Which L1 edge types increased, with counts or an exact fixture assertion
- Which L3 edge types increased, with counts or an exact fixture assertion
- Which frontend color/shape/legend mappings were checked or updated
- Whether any edge resolution was intentionally skipped
- Whether the change affects the frontend
