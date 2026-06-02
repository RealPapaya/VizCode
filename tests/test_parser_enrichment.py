"""
tests/test_parser_enrichment.py — L1/L3 enrichment pass (dedicated parsers).

Covers the enrichment of dedicated parsers (Python, JS/TS, Go, C/C++, C#):
  * L3 symbol edges: inheritance / implements / type_usage from bases + type_refs
  * L3 symbol fields: signature / complexity / decorators
  * L1 file edges: asset_ref / config_ref from parser `edge_hints`

Each test builds a tiny real project and runs the full analyze_viz pipeline, so it
exercises parser -> analyzer -> edge resolution end to end. Adversarial tests assert
that comments, string literals, builtins, ambiguous targets, and Go structural
interface satisfaction never create bogus edges.
"""
import io
import contextlib

import pytest

from core.analyze_viz import build_graph

TYPE_KINDS = {'class', 'struct', 'interface', 'enum', 'record', 'trait', 'typedef'}


def _build(tmp_path, files):
    """Materialize {rel: body} under tmp_path, run build_graph, return the result."""
    for rel, body in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding='utf-8')
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        return build_graph(str(tmp_path))


def _sym_edge_types(res):
    return {e['type'] for e in (res.get('symbol_edges') or [])}


def _file_edge_types(res):
    out = set()
    for edges in (res.get('file_edges_by_module') or {}).values():
        out.update(e.get('type') for e in edges)
    return out


def _field_present(res, field):
    return any(s.get(field) for s in (res.get('symbol_index') or {}).values())


# ── Positive: multi-language end-to-end ──────────────────────────────────────

def test_python_enrichment(tmp_path):
    res = _build(tmp_path, {
        'models.py': 'class Base:\n    pass\n\nclass Settings:\n    pass\n\nclass Request:\n    pass\n',
        'engine.py': (
            'from models import Base, Settings, Request\n\n'
            'class Engine(Base):\n'
            '    config: Settings\n'
            '    def run(self, req: Request, n: int) -> Settings:\n'
            '        f = open("conf/app.json")\n'
            '        t = render_template("page.html")\n'
            '        return Settings()\n'
        ),
        'conf/app.json': '{}\n',
        'page.html': '<html></html>\n',
    })
    assert {'type_usage', 'inheritance'} <= _sym_edge_types(res)
    assert {'config_ref', 'asset_ref'} <= _file_edge_types(res)
    assert _field_present(res, 'complexity')
    assert _field_present(res, 'signature')


def test_typescript_enrichment(tmp_path):
    res = _build(tmp_path, {
        'types.ts': 'export class Base {}\nexport interface IRepo {}\nexport class Settings {}\nexport class Request {}\n',
        'engine.ts': (
            "import './style.css';\n"
            "import cfg from './data.json';\n"
            'export class Engine extends Base implements IRepo {\n'
            '    cfg: Settings;\n'
            '    run(req: Request, n: number): Settings { return new Settings(); }\n'
            '}\n'
        ),
        'style.css': 'a{}\n',
        'data.json': '{}\n',
    })
    assert {'inheritance', 'implements', 'type_usage'} <= _sym_edge_types(res)
    assert {'asset_ref', 'config_ref'} <= _file_edge_types(res)


def test_go_enrichment(tmp_path):
    res = _build(tmp_path, {
        'go.mod': 'module example.com/m\n\ngo 1.21\n',
        'types.go': 'package m\n\ntype Base struct{}\n\ntype Settings struct{}\n\ntype Request struct{}\n',
        'engine.go': (
            'package m\n\n'
            'import _ "embed"\n\n'
            '//go:embed page.html\n'
            'var page string\n\n'
            'type Engine struct {\n\tBase\n\tcfg Settings\n}\n\n'
            'func (e *Engine) Run(req Request) Settings { return Settings{} }\n'
        ),
        'page.html': '<html></html>\n',
    })
    # Embedded struct -> inheritance; exported field/param/return types -> type_usage.
    assert {'inheritance', 'type_usage'} <= _sym_edge_types(res)
    assert 'asset_ref' in _file_edge_types(res)


def test_cpp_enrichment(tmp_path):
    res = _build(tmp_path, {
        'types.hpp': 'class Base {};\nclass Settings {};\nclass Request {};\n',
        'engine.cpp': (
            '#include "types.hpp"\n#include <cstdio>\n'
            'class Engine : public Base {\n'
            '    Settings cfg;\n'
            'public:\n'
            '    Settings run(Request req, int n) {\n'
            '        FILE* f = fopen("report.html", "r");\n'
            '        if (n > 0 && n < 10) { return Settings(); }\n'
            '        return Settings();\n'
            '    }\n'
            '};\n'
        ),
        'report.html': '<html></html>\n',
    })
    assert {'inheritance', 'type_usage'} <= _sym_edge_types(res)
    assert _field_present(res, 'complexity')
    assert 'asset_ref' in _file_edge_types(res)


def test_csharp_enrichment(tmp_path):
    res = _build(tmp_path, {
        'Types.cs': 'class Base {}\ninterface IRepo {}\nclass Settings {}\nclass Request {}\n',
        'Engine.cs': (
            'class Engine : Base, IRepo {\n'
            '    public Settings Cfg { get; set; }\n'
            '    [Route("/run")]\n'
            '    public Settings Run(Request req, int n) {\n'
            '        var c = builder.AddJsonFile("appsettings.json");\n'
            '        if (n > 0) { return new Settings(); }\n'
            '        return new Settings();\n'
            '    }\n'
            '}\n'
        ),
        'appsettings.json': '{}\n',
    })
    assert {'inheritance', 'implements', 'type_usage'} <= _sym_edge_types(res)
    assert 'config_ref' in _file_edge_types(res)
    assert _field_present(res, 'decorators')


# ── Batch 1 positive: Java / Rust ─────────────────────────────────────────────

def test_java_enrichment(tmp_path):
    res = _build(tmp_path, {
        'Types.java': (
            'public class Base {\n'
            '    public Settings run(Request req) { return new Settings(); }\n'
            '}\n'
            'interface Store {}\n'
            'class Settings {}\n'
            'class Request {}\n'
        ),
        'Engine.java': (
            'import java.nio.file.Files;\n'
            'import java.nio.file.Path;\n'
            '@Deprecated\n'
            'public class Engine extends Base implements Store {\n'
            '    private Settings settings;\n'
            '    public Engine(Request req) {}\n'
            '    @Override\n'
            '    public Settings run(Request req) throws ServiceException {\n'
            '        var local = new File("conf/local.json");\n'
            '        var cfg = Files.readString(Path.of("conf/app.json"));\n'
            '        var page = getClass().getResourceAsStream("template.html");\n'
            '        return new Settings();\n'
            '    }\n'
            '}\n'
            'class ServiceException extends Exception {}\n'
        ),
        'conf/local.json': '{}\n',
        'conf/app.json': '{}\n',
        'template.html': '<html></html>\n',
    })
    assert {'inheritance', 'implements', 'override', 'type_usage'} <= _sym_edge_types(res)
    assert {'config_ref', 'asset_ref'} <= _file_edge_types(res)
    assert _field_present(res, 'decorators')
    assert _field_present(res, 'signature')


def test_rust_enrichment(tmp_path):
    res = _build(tmp_path, {
        'lib.rs': (
            'pub trait Store {\n'
            '    fn save(&self, req: Request) -> Settings;\n'
            '}\n'
            'pub struct Request {}\n'
            'pub struct Settings {}\n'
            '#[derive(Debug)]\n'
            'pub struct Engine {\n'
            '    req: Request,\n'
            '    settings: Settings,\n'
            '}\n'
            'impl Store for Engine {\n'
            '    #[inline]\n'
            '    pub fn save(&self, req: Request) -> Settings {\n'
            '        let _cfg = std::fs::read_to_string("config/app.yaml").unwrap();\n'
            '        let _template = include_str!("template.html");\n'
            '        Settings {}\n'
            '    }\n'
            '}\n'
        ),
        'config/app.yaml': 'name: demo\n',
        'template.html': '<html></html>\n',
    })
    assert {'implements', 'type_usage'} <= _sym_edge_types(res)
    assert {'asset_ref', 'config_ref'} <= _file_edge_types(res)
    assert _field_present(res, 'decorators')
    assert _field_present(res, 'signature')


# ── Adversarial: must produce NO bogus edges ──────────────────────────────────

def test_adversarial_ambiguous_type_no_type_usage(tmp_path):
    res = _build(tmp_path, {
        'a.py': 'class Dup:\n    pass\n',
        'b.py': 'class Dup:\n    pass\n',
        'use.py': 'def f(x: Dup) -> Dup:\n    return x\n',
    })
    tu = [e for e in (res.get('symbol_edges') or []) if e['type'] == 'type_usage']
    assert tu == [], 'ambiguous type (defined in two files) must not resolve'


def test_adversarial_comments_strings_builtins(tmp_path):
    res = _build(tmp_path, {
        'real.py': 'class Widget:\n    pass\n',
        'noise.py': (
            '# class Widget:\n'
            '#     pass\n'
            'TEMPLATE = "class Widget: pass"\n'
            'PATH_STR = "open(\\"secret.json\\")"\n'
            'def g(a: int, b: str, c: float) -> bool:\n'
            '    # f = open("hidden.json")\n'
            '    return True\n'
        ),
        'hidden.json': '{}\n',
        'secret.json': '{}\n',
    })
    sym_idx = res.get('symbol_index') or {}
    widgets = [s for s in sym_idx.values() if s.get('name') == 'Widget']
    assert len(widgets) == 1, 'commented / string "class Widget" must not be parsed as a def'
    tu = [e for e in (res.get('symbol_edges') or []) if e['type'] == 'type_usage']
    assert tu == [], 'builtin-only params must not create type_usage'
    ft = _file_edge_types(res)
    assert 'config_ref' not in ft and 'asset_ref' not in ft, \
        'commented / string-literal open() must not create asset/config edges'


def test_adversarial_csharp_edge_hint_masking():
    """C# edge hints: real calls detected; commented + in-string calls ignored."""
    from parsers.csharp_parser import scan_csharp
    src = (
        'class E {\n'
        '  void Run() {\n'
        '    var c = builder.AddJsonFile("appsettings.json");\n'
        '    var t = File.ReadAllText("data.json");\n'
        '    // var x = File.ReadAllText("commented.json");\n'
        '    var s = "AddJsonFile(\\"inside-string.json\\")";\n'
        '  }\n'
        '}\n'
    )
    extra = scan_csharp(src)[3] or {}
    targets = {h['target'] for h in (extra.get('edge_hints') or [])}
    assert {'appsettings.json', 'data.json'} <= targets
    assert 'commented.json' not in targets
    assert 'inside-string.json' not in targets


def test_adversarial_go_structural_interface_no_implements(tmp_path):
    res = _build(tmp_path, {
        'go.mod': 'module example.com/s\n\ngo 1.21\n',
        'iface.go': 'package s\n\ntype Reader interface {\n\tRead() string\n}\n',
        'impl.go': 'package s\n\ntype MyType struct{}\n\nfunc (m MyType) Read() string { return "" }\n',
    })
    imp = [e for e in (res.get('symbol_edges') or []) if e['type'] == 'implements']
    assert imp == [], 'Go structural interface satisfaction must not create implements edges'


# ── Batch 1 adversarial: Java / Rust ──────────────────────────────────────────

def test_adversarial_java_comments_strings_builtins():
    """Java edge/type hints: real calls detected; comments + in-string calls ignored."""
    from parsers.java_parser import scan_java
    src = (
        'class Engine {\n'
        '  String name;\n'
        '  void run(int n, String s) throws Exception {\n'
        '    var cfg = java.nio.file.Path.of("app.json");\n'
        '    // var hidden = Path.of("hidden.json");\n'
        '    var fake = "Path.of(\\"inside.json\\")";\n'
        '  }\n'
        '}\n'
    )
    _imports, _funcdefs, _calls, extra, _by_func, symbols = scan_java(src)
    targets = {h['target'] for h in (extra.get('edge_hints') or [])}
    assert 'app.json' in targets
    assert 'hidden.json' not in targets
    assert 'inside.json' not in targets
    refs = {r for s in symbols for r in (s.get('type_refs') or [])}
    assert 'String' not in refs and 'Exception' not in refs


def test_adversarial_rust_cross_file_impl_no_synthetic_type(tmp_path):
    res = _build(tmp_path, {
        'traits.rs': 'pub trait Store {}\n',
        'impls.rs': 'use crate::traits::Store;\nimpl Store for Engine {}\n',
    })
    names = [s.get('name') for s in (res.get('symbol_index') or {}).values()]
    assert 'Engine' not in names, 'cross-file impl must not synthesize a type symbol'
    imp = [e for e in (res.get('symbol_edges') or []) if e['type'] == 'implements']
    assert imp == []


# ── Edge-count delta / explosion guard ────────────────────────────────────────

def test_type_usage_exact_count_and_bound(tmp_path):
    # Engine.config: Settings (1) + run(req: Request)->Settings (2) + helper(s: Settings) (1) = 4
    res = _build(tmp_path, {
        'm.py': 'class Settings:\n    pass\n\nclass Request:\n    pass\n',
        'e.py': (
            'from m import Settings, Request\n\n'
            'class Engine:\n'
            '    config: Settings\n'
            '    def run(self, req: Request) -> Settings:\n'
            '        return Settings()\n\n'
            'def helper(s: Settings):\n'
            '    return s\n'
        ),
    })
    tu = [e for e in (res.get('symbol_edges') or []) if e['type'] == 'type_usage']
    assert len(tu) == 4, f'expected exactly 4 type_usage edges, got {len(tu)}'
    sym_idx = res.get('symbol_index') or {}
    n_syms = len(sym_idx)
    n_types = sum(1 for s in sym_idx.values() if s.get('kind') in TYPE_KINDS)
    assert len(tu) <= n_syms * n_types  # explosion guard
    assert 'call' in _sym_edge_types(res)  # existing edge kinds intact
