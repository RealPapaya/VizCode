# L1/L3 Enrichment Reference

Use this reference after improving a parser. The goal is to turn more precise
parser output into better L1 file edges and L3 symbol browsing without creating
false-positive graph noise.

## Stable Vocabulary

Keep primary edge types small and cross-language.

L1 file edge types:

- `import` - module/package/schema import
- `include` - textual include
- `asset_ref` - HTML/CSS/static asset reference
- `config_ref` - config points at another file/module/service
- `sources`, `package`, `library`, `component`, `guid_ref`, `str_ref`, `depex` - UEFI/domain edges
- `inferred` - AI or heuristic edge

L3 symbol edge types:

- `call`
- `inheritance`
- `implements`
- `override`
- `type_usage`
- `member`
- `import`
- `include`

Do not create primary types like `js_dynamic_import` or `python_importlib`.
Use `subtype`, `via`, `line`, `origin`, and `confidence` metadata instead.

## Parser Output Contract

Do not change the parser 6-tuple:

```python
return imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs
```

For L1 enrichment, add optional parser hints:

```python
extra = {
    "edge_hints": [
        {
            "type": "asset_ref",
            "target": "styles/site.css",
            "subtype": "stylesheet",
            "via": "href",
            "line": 12,
            "confidence": 1.0,
        }
    ]
}
```

The analyzer resolves `target` with the same file resolver as imports. If a
target cannot be resolved unambiguously, it must not become an edge.

For L3 enrichment, prefer existing symbol fields:

- `kind`, `name`, `line`, `end_line`
- `parent`, `bases`
- `signature`, `doc`, `decorators`
- `is_public`, `is_static`
- `complexity`

Only add extra symbol keys when they are stable, language-neutral enough to be
useful, and harmless to ignore.

## Language-Specific Mapping

Map language constructs to stable vocabulary:

- JS/TS dynamic import: `type="import"`, `subtype="dynamic"`
- JS/TS re-export: `type="import"`, `subtype="reexport"`
- HTML script/style/image/link: `asset_ref` with `subtype`
- YAML/TOML/JSON references to local files: `config_ref`
- SQL view/table/procedure references: prefer L3 `type_usage` or `call`; use L1
  `config_ref` only when the reference resolves to a known project file
- Rust trait impl / Java implements / Swift protocol conformance: L3 `implements`
- Class/trait/protocol inheritance: L3 `inheritance`
- Field/property/type annotations: L3 `type_usage` when the target symbol is known
- Method override: L3 `override` only when the parent method target is known

## Precision Rules

- Prefer missing an edge over adding a wrong edge.
- Resolve only known project files or known symbols.
- Skip ambiguous names with multiple candidate targets.
- Skip builtins, keywords, framework globals, and short generic names.
- Do not turn comments or string literals into edges.
- Keep fallback inference gated and explain the guard in tests.

## Required Tests

For every parser enrichment, add or update tests that cover:

- positive extraction of the new metadata
- adversarial comments/literals that must not produce metadata
- ambiguous target suppression
- unchanged existing parser contract
- graph-level conversion when `edge_hints` should become L1 edges
- L3 visibility of enriched symbols when symbol fields change
