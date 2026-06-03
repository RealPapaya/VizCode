# Parser Enrichment Roadmap (L1 edges + L3 symbols)

## Progress Checklist

- [x] Reference parsers: Python, JS/TS, Go, C/C++, C#
- [x] Batch 1: Java, Rust
- [x] Batch 2: GraphQL, Protobuf, SQL
- [x] Batch 3: Kotlin, Swift, PHP, Scala, Dart, Objective-C, VB.NET
- [x] Batch 4: Crystal, Nim, Julia, F#, Haskell, OCaml, Elm
- [x] Batch 5: Ruby, Elixir/Erlang, PowerShell, HTML/CSS/YAML/TOML/JSON
- [x] Semantic vocabulary expansion
  - [x] L1 `schema_ref` (json/yaml parsers; styled + tested in `test_batch5_data_and_markup_edge_coverage`)
  - [x] L1 `resource_hint` (html `rel=preload/modulepreload/prefetch`; same test)
  - [x] L3 `mixin_include`, `mixin_extend`, `mixin_prepend` (ruby; `test_batch5_ruby_mixins_produce_semantic_edges`)
  - [x] L3 `behaviour_impl` (elixir `@behaviour` + erlang `-behaviour`; `test_batch5_elixir/erlang_*`)
  - [x] L3 `protocol_impl` (elixir `defimpl`; `test_batch5_elixir_protocol_impl`)
- [x] Batch 6: conservative common_parser breadth uplift (generic `signature` + branch-keyword
  `complexity`; `test_batch6_common_parser_*`). Reach note: every general-purpose language in
  `SCAN_EXT` now has a dedicated parser, so `scan_common` only handles vendor firmware/make
  (`.sdl`/`.sd`/`.cif`/`.mak`) plus any future long-tail extension. `type_refs` deliberately
  left out (explosion risk).

Planning document. **No implementation** — this scopes, groups, and prioritizes the
work of bringing the remaining ~40 parsers up to the richness of the five enriched
dedicated parsers. Pair with `l1-l3-enrichment.md` (the field/vocabulary contract)
and the parent `SKILL.md` (the precision-first methodology).

---

## 1. What already shipped (the reference bar)

Across the five dedicated parsers — **Python, JS/TS, Go, C/C++, C#** — we added:

- **L1 edges:** `asset_ref` / `config_ref` via `extra['edge_hints']` (quoted-literal
  file paths with known extensions; resolved by the analyzer's file resolver).
- **L3 symbol fields:** `type_refs`, `decorators`, `signature`, `complexity`, plus
  visibility surfaced from `is_public`.
- **L3 symbol edges:** `type_usage` (from `type_refs`); `inheritance` / `implements`
  / `override` were already built from `bases` / `parent`.

The L3 card layout was **not** changed — richer content folds into the existing
signature and metrics sections only.

## 2. The key enabler: enrichment is parser-side first, not schema-frozen

`src/core/analyze_viz.py` builds **all** symbol/file edges language-agnostically by
iterating every symbol/file regardless of source language:

| Analyzer builder | Reads from | Produces |
|---|---|---|
| inheritance / implements | `symbol_defs['bases']` (+ target kind) | `inheritance` / `implements` edges |
| override | `parent` + parent's `bases` + method-name match | `override` edges |
| type_usage | `symbol_defs['type_refs']` (resolved to a type-kind symbol) | `type_usage` edges |
| call | `func_calls_by_func` | `call` edges |
| asset_ref / config_ref | `extra['edge_hints']` | L1 file edges |

The frontend already styles every edge type (`_SV_EDGE_COLOR`, `_svEdgeVerb`,
`EDGE_TYPE_STYLE`, `LEGEND_EDGES`) and renders every card field.

**Consequence:** enriching a parser means *populating fields in the 6-tuple* — no
analyzer change, no frontend change, no contract change. This makes the work highly
parallelizable (one parser at a time, isolated) and low-risk.

**But this is not a schema freeze.** If an authoritative language reference defines
a relationship that is materially different from the existing vocabulary, and the
difference changes how users should read the graph, adding a new node/edge type is
allowed. New vocabulary must be deliberate: documented, analyzer-backed,
frontend-styled, tested at graph level, and justified by language semantics rather
than by parser implementation convenience.

## 3. Current state of the remaining parsers

Measured by which enrichment fields each parser actually emits today:

- **`bases` is populated broadly.** Most OO dedicated parsers (java, kotlin, scala,
  swift, rust, dart, groovy, objc, vbnet, fsharp, ruby, php, …) and `common_parser`
  already extract base/interface lists. **So `inheritance`/`implements` edges already
  work for these languages** — the task there is *verify & strengthen*, not build.
- **`type_refs` exists only in the five enriched parsers.** Everywhere else it is
  absent → **no `type_usage` edges** for ~40 languages. This is the single biggest gap.
- **`signature` / `decorators` / real `complexity`** exist only in the five. Other
  parsers carry default `complexity: None` and no signature/decorator data.
- **`edge_hints` already exist** in the data/markup parsers (css, html, json, yaml,
  toml) and partially in rust/protobuf/graphql/powershell — because references are
  their whole purpose. Code parsers mostly lack them.

## 4. The enrichment menu (per parser, pick what the language supports)

| Dimension | Field / output | When a language qualifies |
|---|---|---|
| Type usage | `type_refs` → `type_usage` | has explicit/optional type annotations or a schema |
| Inheritance | `bases` → `inheritance` | classes/structs with a superclass |
| Interface impl | `bases` → `implements` | interfaces/protocols/traits/behaviours |
| Override | `parent` set on methods | methods that can override a parent's |
| Decorators | `decorators` | annotations/attributes/macros (`@`, `[Attr]`, `#[..]`) |
| Signature | `signature` | functions with a readable param/return clause |
| Complexity | `complexity` | function bodies (count branch keywords) |
| Visibility | `is_public` / `is_static` | access modifiers / naming conventions |
| Asset/config refs | `edge_hints` | file I/O, imports of assets, config loaders |

### 4a. When to add language-specific graph vocabulary

Default to the stable cross-language vocabulary when the relationship is genuinely
the same across languages. Add a new edge or node kind only when all of these are
true:

- **Authoritative syntax/semantics:** the construct is documented by the language
  spec or official reference, not inferred from examples or framework convention.
- **Different graph meaning:** collapsing it into an existing edge would hide a
  real semantic distinction that affects dependency, dispatch, ownership, lifecycle,
  loading order, schema validation, or runtime behavior.
- **Stable extraction:** the parser can identify it with high precision using the
  current parser strategy, including comment/string masking and adversarial tests.
- **Resolvable endpoints:** both ends can be resolved to project files or symbols
  without broad inference or ambiguous-name explosion.
- **UI readiness:** analyzer output, L1/L3 styling, labels, legends, filters, and
  card wording are updated so the new type is not a fallback color or generic label.

If any condition fails, keep the canonical edge and preserve language detail in
`subtype`, `via`, `origin`, `line`, `confidence`, or symbol metadata.

Candidate examples that may justify new vocabulary in a future batch:

- Ruby `include` vs `extend` vs `prepend`: all are mixin relationships, but they
  differ in instance/class method availability and method lookup order.
- Elixir protocol `defimpl` vs `@behaviour`: both are implementation-like, but
  protocols and behaviours have different dispatch/contract semantics.
- Erlang `-behaviour(...)`: a callback contract relationship distinct from OO
  interface inheritance.
- JSON Schema / OpenAPI `$ref`: a schema reference may deserve `schema_ref` if
  config-vs-schema distinction matters in L1/L3 navigation.
- HTML resource hints (`preload`, `modulepreload`, `prefetch`) may deserve a
  loading/lifecycle edge if the UI distinguishes runtime loading order from static
  asset ownership.

---

## 5. Tiers — grouped by feasibility, ordered by value

Value = real-world scan frequency × graph-richness gain × achievable precision.
Feasibility = how cleanly the language's constructs can be extracted with the current
(regex-dominant, stdlib-only) parser strategy.

### Tier 1 — High value, high feasibility (do first)

Statically-typed OO languages and explicit schemas. Types are written down, so
`type_usage` is both high-value and high-precision, and `bases` already gives
inheritance for free.

| Parser | Realistic contribution | Notes |
|---|---|---|
| **java** | `type_refs` (field/param/return + generics inner types), `decorators` (`@Annotation`), signature, complexity; override via `@Override`/parent | Flagship — largest ecosystem; annotations are first-class |
| **rust** | `type_refs` (fn sigs, struct fields, generics), `implements` (trait `impl X for Y`), `decorators` (`#[derive(..)]`/attrs), signature, complexity | `impl ... for` → `implements`; already has use/mod `edge_hints` |
| **kotlin** | `type_refs`, annotations, signature, complexity; data/sealed classes | Null-safety types are clean to parse |
| **swift** | `type_refs`, protocol conformance → `implements`, attributes, signature | Protocols map directly to `implements` |
| **scala** | `type_refs`, traits → `implements`, signature, complexity | Trait/`with` lists feed `bases` |
| **dart** | `type_refs`, `implements`/`with` (mixins), annotations, signature | Mixins → `implements`-style edges |
| **groovy** | `type_refs` (optional types), annotations, signature | Dynamic fallback when untyped |
| **objc** | `type_refs`, protocol conformance → `implements`, signature | `@interface`/`@protocol` already parsed |
| **vbnet** | `type_refs`, `Implements`/`Inherits`, attributes, signature | .NET parity with C# |
| **graphql** | `type_usage` between object/input/interface types via field types; `implements` (`type X implements Y`) | Schema *is* a type graph — very high precision, low effort |
| **protobuf** | `type_usage` between messages via field message-types; nested types | Schema-defined; near-zero false positives |
| **sql** | table→table references (FK / `REFERENCES` / JOINs) as `type_usage` or `config_ref`; procedures as `call` | Resolve only to project-defined tables |
| **php** | `type_refs` (PHP 7+/8 type hints, return types), `#[Attributes]`, `implements`, signature | Modern PHP is well-typed; older code degrades gracefully |

### Tier 2 — Moderate value/feasibility

Optionally-typed, typed-functional, and reference-oriented data formats. Type signal
exists but is weaker, idiomatic, or partial.

| Parser | Realistic contribution | Notes |
|---|---|---|
| **crystal** | `type_refs` (optional type annotations), `implements` (modules), signature | Ruby-like but statically typed |
| **nim** | `type_refs` (proc params/return, object fields), signature | Statically typed |
| **julia** | `type_refs` (`::Type` annotations, struct fields), signature | Multiple dispatch; type annotations are explicit where present |
| **fsharp** | `type_refs` from type annotations; interfaces → `implements` | Type inference limits coverage to annotated sites |
| **ocaml** | `type_refs` from module/type signatures (`.mli`) | Strongest signal in interface files |
| **haskell** | `type_refs` from top-level type signatures; typeclass `instance` → `implements` | Signatures are explicit and parseable |
| **elm** | `type_refs` from type annotations | Simple, explicit annotation syntax |
| **ruby** | `implements` from `include`/`extend` mixins; signature; complexity | No static types → skip `type_usage` |
| **elixir** / **erlang** | `@behaviour` → `implements`; signature; `@callback` | Functional; behaviours are the inheritance analogue |
| **html** / **css** | broaden `edge_hints` coverage (more tags/`url()`/`@import`/srcset) | Already emit some; raise recall safely |
| **yaml** / **toml** / **json** | broaden `config_ref` to more local-file reference keys | Already emit some; conservative key whitelist |
| **powershell** | signature, complexity; broaden `edge_hints` (dot-source, `Import-Module` paths) | Already has some hints |

### Tier 3 — Low value / low feasibility / already saturated

| Parser | Realistic contribution | Why low |
|---|---|---|
| **perl, lua, r, shell** | signature, complexity, `edge_hints` (`require`/`source`/`dofile`/file reads) | Dynamic, weak type signal — no `type_usage` |
| **clojure** | signature/arity; `edge_hints` (`:require`) | Lisp/dynamic; no class/type model |
| **common_parser** | conservative generic signature + complexity (brace/keyword counting) for the 52+ regex-fallback languages | Broad reach but **precision risk** — avoid generic `type_refs` |
| **uefi, acpi, asm** | leave as-is (already rich domain-specific L1: GUIDs, depex, includes) | Not OO; minimal L3 type model to gain |

---

## 6. Suggested sequencing

1. **Batch 1 — flagships:** Java, Rust. (Highest usage; exercise annotations + traits;
   become the long-tail reference the way Python was for the first five.)
2. **Batch 2 — schema quick wins:** GraphQL, Protobuf, SQL. (Small, high-precision,
   high-clarity `type_usage`; great demos.)
3. **Batch 3 — OO mainstream:** Kotlin, Swift, PHP, Scala, Dart, Objective-C, VB.NET.
4. **Batch 4 — optionally/functionally typed:** Crystal, Nim, Julia, F#, Haskell, OCaml, Elm.
5. **Batch 5 — dynamic + behaviours + data coverage:** Ruby, Elixir/Erlang, PowerShell;
   broaden HTML/CSS/YAML/TOML/JSON `edge_hints`.
6. **Batch 6 — breadth uplift:** conservative `common_parser` signature/complexity for
   everything else; leave firmware parsers as-is.

Each batch is independent (parser-side only), so batches can run in parallel once the
field contract is internalized.

## 7. Precision guardrails (carry forward from the skill)

Section 4a controls vocabulary expansion. The stable vocabulary is the default,
not a ban: add new vocabulary when the criteria are met and the new type carries
real language semantics that the canonical edge would hide.

- Keep the **stable cross-language vocabulary**; push language detail into
  `subtype`/`via`/`line`/`origin`/`confidence` — never invent `java_generic` etc.
- `type_refs`: emit only Capitalized/PascalCase names ≥3 chars after a per-language
  `*_TYPE_BUILTINS` filter; the analyzer resolves to a single known type-kind symbol
  and drops ambiguous/unknown names. **Do not infer structural conformance** (e.g.
  implicit interface satisfaction) — explosion risk; Go already excludes it.
- `edge_hints`: quoted string literal + known extension only; comment-strip but
  **preserve string content** (see C# `mask_strings=False` precedent), and reject call
  tokens that lie inside a string.
- `member` edges remain **deferred** project-wide (no `member_refs`) — highest
  false-positive surface; keep the slot reserved.

## 8. Explosion / risk watch-list

- **Generics-heavy languages** (Java, Scala, Rust): a single annotation can name many
  inner types. Dedupe `(from,to)`; cap per-symbol `type_refs`; assert an edge-count
  delta in tests.
- **common_parser generic type_refs:** explicitly out of scope — regex over arbitrary
  languages cannot distinguish a type from a value safely.
- **SQL / schema langs:** resolve references only to project-defined tables/types to
  avoid linking to stdlib/builtin names.

## 9. Testing requirements (per parser, per the skill)

Reuse the pattern in `tests/test_parser_enrichment.py`:

- **Positive:** each new field/edge type produced from a minimal real sample.
- **Adversarial:** builtins, comments, string-literal look-alikes, ambiguous targets,
  structural-conformance non-edges → produce nothing.
- **Regression:** 6-tuple arity unchanged; existing import/inheritance/call counts
  stable; `extra` without hints still parses.
- **Edge-count delta:** an exact/bounded `type_usage` count on a controlled fixture as
  the explosion guard.

## 10. Out of scope (this roadmap)

- `member` symbol edges and `member_refs`.
- Cross-language symbol resolution (a Python caller → a Go callee).
- Any L3 layout/card-design change (content-only enrichment, as established).
- Firmware parsers' L3 type modeling (their value is domain-specific L1).

## 11. Vocabulary expansion backlog

This roadmap originally prioritized quick parser-side enrichment. The next pass
should review language-specific constructs that were intentionally collapsed into
canonical edges and decide whether product value justifies first-class graph
vocabulary.

Suggested review order:

1. **Schema references:** split generic `config_ref` into `schema_ref` where JSON
   Schema, OpenAPI, GraphQL, Protobuf, or YAML manifests point to schemas rather
   than ordinary config files.
2. **Behaviour/protocol/mixin semantics:** evaluate separate L3 edge types for
   Ruby mixin forms, Elixir protocols/behaviours, and Erlang behaviours if the UI
   should teach those differences instead of presenting them all as `implements`.
3. **Runtime loading and resource hints:** evaluate HTML/CSS/PowerShell/Ruby cases
   where load order or runtime module loading is meaningfully different from a
   static import or asset reference.
4. **Framework-owned config graphs:** only after parser-level language syntax is
   stable, consider official framework schemas where the framework defines the
   reference semantics, for example OpenAPI or Kubernetes manifests. Treat these
   as separate, documented parser enrichments, not generic YAML/JSON guessing.

Every accepted vocabulary expansion must update analyzer builders, frontend styles,
legends/filters, parser docs, and graph-level tests in the same change.
