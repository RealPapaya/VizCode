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

TYPE_KINDS = {
    'class', 'struct', 'interface', 'enum', 'record', 'trait', 'typedef',
    'type', 'input', 'union', 'scalar', 'message', 'table', 'view',
}


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


def _symbol_edge_name_pairs(res, edge_type):
    sym_idx = res.get('symbol_index') or {}
    pairs = set()
    for edge in (res.get('symbol_edges') or []):
        if edge.get('type') != edge_type:
            continue
        src = sym_idx.get(edge.get('from'), {})
        tgt = sym_idx.get(edge.get('to'), {})
        pairs.add((src.get('name'), tgt.get('name')))
    return pairs


def _symbol_edges(res, edge_type):
    return [e for e in (res.get('symbol_edges') or []) if e.get('type') == edge_type]


def _file_edges(res, edge_type=None):
    out = []
    for edges in (res.get('file_edges_by_module') or {}).values():
        for edge in edges:
            if edge_type is None or edge.get('type') == edge_type:
                out.append(edge)
    return out


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


# ?? Batch 2 positive: GraphQL / Protobuf / SQL ????????????????????

def test_graphql_enrichment(tmp_path):
    res = _build(tmp_path, {
        'schema.graphql': (
            'interface Node { owner: User }\n'
            'input ProfileInput { owner: User }\n'
            'type Profile { owner: User }\n'
            'type User implements Node {\n'
            '  id: ID!\n'
            '  profile(input: ProfileInput): Profile\n'
            '}\n'
        ),
    })
    assert {'implements', 'type_usage'} <= _sym_edge_types(res)
    pairs = _symbol_edge_name_pairs(res, 'type_usage')
    assert ('Node', 'User') in pairs
    assert ('ProfileInput', 'User') in pairs
    assert ('User', 'Profile') in pairs
    assert ('profile', 'ProfileInput') in pairs
    assert ('profile', 'Profile') in pairs
    assert _field_present(res, 'signature')


def test_protobuf_enrichment(tmp_path):
    res = _build(tmp_path, {
        'service.proto': (
            'syntax = "proto3";\n'
            'message User {}\n'
            'message Profile { User owner = 1; }\n'
            'message Request {\n'
            '  Profile profile = 1;\n'
            '  map<string, User> users = 2;\n'
            '  oneof target { Profile selected_profile = 3; }\n'
            '}\n'
            'service ProfileService {\n'
            '  rpc GetProfile (Request) returns (Profile);\n'
            '}\n'
        ),
    })
    assert 'type_usage' in _sym_edge_types(res)
    pairs = _symbol_edge_name_pairs(res, 'type_usage')
    assert ('Profile', 'User') in pairs
    assert ('Request', 'Profile') in pairs
    assert ('Request', 'User') in pairs
    assert ('GetProfile', 'Request') in pairs
    assert ('GetProfile', 'Profile') in pairs
    assert _field_present(res, 'signature')


def test_sql_enrichment(tmp_path):
    res = _build(tmp_path, {
        'schema.sql': (
            'CREATE TABLE customers (id integer primary key);\n'
            'CREATE TABLE orders (\n'
            '  id integer primary key,\n'
            '  customer_id integer REFERENCES customers(id)\n'
            ');\n'
            'CREATE TABLE audit_log (id integer);\n'
            'CREATE TABLE stale_orders (id integer);\n'
            'CREATE VIEW customer_orders AS\n'
            '  SELECT orders.id FROM orders JOIN customers ON customers.id = orders.customer_id;\n'
            'CREATE FUNCTION refresh_orders() RETURNS void AS $$\n'
            'BEGIN\n'
            '  UPDATE orders SET id = id;\n'
            '  INSERT INTO audit_log(id) VALUES (1);\n'
            '  DELETE FROM stale_orders WHERE id IN (SELECT id FROM customers);\n'
            'END;\n'
            '$$ LANGUAGE plpgsql;\n'
        ),
    })
    assert 'type_usage' in _sym_edge_types(res)
    pairs = _symbol_edge_name_pairs(res, 'type_usage')
    assert ('orders', 'customers') in pairs
    assert ('customer_orders', 'orders') in pairs
    assert ('customer_orders', 'customers') in pairs
    assert ('refresh_orders', 'orders') in pairs
    assert ('refresh_orders', 'audit_log') in pairs
    assert ('refresh_orders', 'stale_orders') in pairs


def test_schema_adversarial_comments_strings_builtins(tmp_path):
    res = _build(tmp_path, {
        'schema.graphql': (
            'type Hidden {}\n'
            '# type Query { hidden: Hidden }\n'
            '""" input: Hidden """\n'
            'type Query { id: ID! name: String active: Boolean }\n'
        ),
        'schema.proto': (
            'syntax = "proto3";\n'
            'message HiddenProto {}\n'
            'message Holder {\n'
            '  string name = 1;\n'
            '  int32 count = 2;\n'
            '  // HiddenProto hidden = 3;\n'
            '}\n'
        ),
        'schema.sql': (
            'CREATE TABLE hidden_table (id integer);\n'
            '-- SELECT * FROM hidden_table;\n'
            "CREATE TABLE active_table (id integer, label varchar default 'FROM hidden_table');\n"
        ),
    })
    assert [e for e in (res.get('symbol_edges') or []) if e['type'] == 'type_usage'] == []


def test_schema_adversarial_ambiguous_target_no_type_usage(tmp_path):
    res = _build(tmp_path, {
        'a.sql': 'CREATE TABLE dup_table (id integer);\n',
        'b.sql': 'CREATE TABLE dup_table (id integer);\n',
        'use.sql': 'CREATE VIEW use_dup AS SELECT * FROM dup_table;\n',
    })
    pairs = _symbol_edge_name_pairs(res, 'type_usage')
    assert ('use_dup', 'dup_table') not in pairs


def test_sql_adversarial_ctes_aliases_subqueries_bounded(tmp_path):
    res = _build(tmp_path, {
        'schema.sql': (
            'CREATE TABLE users (id integer);\n'
            'CREATE TABLE orders (id integer, user_id integer);\n'
            'CREATE TABLE recent (id integer);\n'
            'CREATE VIEW active_users AS\n'
            'WITH recent AS (SELECT * FROM orders o)\n'
            'SELECT u.id FROM recent r JOIN users u ON u.id = r.user_id\n'
            'WHERE EXISTS (SELECT 1 FROM orders o2 WHERE o2.user_id = u.id);\n'
        ),
    })
    pairs = _symbol_edge_name_pairs(res, 'type_usage')
    assert ('active_users', 'users') in pairs
    assert ('active_users', 'orders') in pairs
    assert ('active_users', 'recent') not in pairs
    active_edges = [pair for pair in pairs if pair[0] == 'active_users']
    assert len(active_edges) <= 2


# ---- Batch 3 positive: Kotlin / Swift / PHP / Scala / Dart / ObjC / VB.NET ----

def test_kotlin_enrichment(tmp_path):
    res = _build(tmp_path, {
        'Engine.kt': (
            'import java.io.File\n'
            'annotation class Route\n'
            'open class Base {}\n'
            'interface Store {}\n'
            'class Settings {}\n'
            'class Request {}\n'
            '@Route\n'
            'class Engine : Base(), Store {\n'
            '  val settings: Settings = Settings()\n'
            '  @Route\n'
            '  fun run(req: Request): Settings {\n'
            '    val cfg = File("config/app.json").readText()\n'
            '    return Settings()\n'
            '  }\n'
            '}\n'
        ),
        'config/app.json': '{}\n',
    })
    assert {'inheritance', 'implements', 'type_usage'} <= _sym_edge_types(res)
    assert 'config_ref' in _file_edge_types(res)
    assert _field_present(res, 'signature')
    assert _field_present(res, 'decorators')
    assert len(_symbol_edges(res, 'type_usage')) <= 8
    assert any(e.get('line') == 12 for e in _file_edges(res, 'config_ref'))


def test_swift_enrichment(tmp_path):
    res = _build(tmp_path, {
        'Engine.swift': (
            'class Base {}\n'
            'protocol Store {}\n'
            'class Settings {}\n'
            'class Request {}\n'
            '@available(*, deprecated)\n'
            'class Engine: Base, Store {\n'
            '  var settings: Settings\n'
            '  init(settings: Settings) { self.settings = settings }\n'
            '  @available(*, deprecated)\n'
            '  func run(req: Request) -> Settings {\n'
            '    let _ = try? String(contentsOfFile: "config/app.json")\n'
            '    return Settings()\n'
            '  }\n'
            '}\n'
        ),
        'config/app.json': '{}\n',
    })
    assert {'inheritance', 'implements', 'type_usage'} <= _sym_edge_types(res)
    assert 'config_ref' in _file_edge_types(res)
    assert _field_present(res, 'signature')
    assert _field_present(res, 'decorators')
    assert len(_symbol_edges(res, 'type_usage')) <= 8


def test_php_enrichment(tmp_path):
    res = _build(tmp_path, {
        'Engine.php': (
            '<?php\n'
            'interface Store {}\n'
            'class Base {}\n'
            'class Settings {}\n'
            'class Request {}\n'
            '#[Route]\n'
            'class Engine extends Base implements Store {\n'
            '  public Settings $settings;\n'
            '  #[Route]\n'
            '  public function run(Request $req): Settings {\n'
            '    require "config/bootstrap.php";\n'
            '    return new Settings();\n'
            '  }\n'
            '}\n'
        ),
        'config/bootstrap.php': '<?php\n',
    })
    assert {'inheritance', 'implements', 'type_usage'} <= _sym_edge_types(res)
    assert 'import' in _file_edge_types(res)
    assert _field_present(res, 'signature')
    assert _field_present(res, 'decorators')
    assert len(_symbol_edges(res, 'type_usage')) <= 8
    assert any(e.get('line') == 11 for e in _file_edges(res, 'import'))


def test_scala_enrichment(tmp_path):
    res = _build(tmp_path, {
        'Engine.scala': (
            'import scala.io.Source\n'
            'trait Store {}\n'
            'class Base {}\n'
            'class Settings {}\n'
            'class Request {}\n'
            '@deprecated\n'
            'class Engine extends Base with Store {\n'
            '  val settings: Settings = new Settings()\n'
            '  @deprecated\n'
            '  def run(req: Request): Settings = {\n'
            '    val cfg = Source.fromFile("config/app.json")\n'
            '    new Settings()\n'
            '  }\n'
            '}\n'
        ),
        'config/app.json': '{}\n',
    })
    assert {'inheritance', 'implements', 'type_usage'} <= _sym_edge_types(res)
    assert 'config_ref' in _file_edge_types(res)
    assert _field_present(res, 'signature')
    assert _field_present(res, 'decorators')
    assert len(_symbol_edges(res, 'type_usage')) <= 8


def test_dart_enrichment(tmp_path):
    res = _build(tmp_path, {
        'engine.dart': (
            "import 'dart:io';\n"
            'class Base {}\n'
            'mixin Store {}\n'
            'class Settings {}\n'
            'class Request {}\n'
            "@Deprecated('demo')\n"
            'class Engine extends Base with Store {\n'
            '  Settings settings = Settings();\n'
            '  @override\n'
            '  Settings run(Request req) {\n'
            "    final cfg = File('config/app.json');\n"
            '    return Settings();\n'
            '  }\n'
            '}\n'
        ),
        'config/app.json': '{}\n',
    })
    assert {'inheritance', 'implements', 'type_usage'} <= _sym_edge_types(res)
    assert 'config_ref' in _file_edge_types(res)
    assert _field_present(res, 'signature')
    assert _field_present(res, 'decorators')
    assert len(_symbol_edges(res, 'type_usage')) <= 8


def test_objc_enrichment(tmp_path):
    res = _build(tmp_path, {
        'Engine.m': (
            '@protocol Store @end\n'
            '@interface Base @end\n'
            '@interface Settings @end\n'
            '@interface Request @end\n'
            '@interface Engine : Base <Store>\n'
            '@property Settings *settings;\n'
            '- (Settings *)run:(Request *)req;\n'
            '@end\n'
            '@implementation Engine\n'
            '- (Settings *)run:(Request *)req {\n'
            '  NSString *s = [NSString stringWithContentsOfFile:@"config/app.json" encoding:0 error:nil];\n'
            '  return nil;\n'
            '}\n'
            '@end\n'
        ),
        'config/app.json': '{}\n',
    })
    assert {'inheritance', 'implements', 'type_usage'} <= _sym_edge_types(res)
    assert 'config_ref' in _file_edge_types(res)
    assert _field_present(res, 'signature')
    assert len(_symbol_edges(res, 'type_usage')) <= 8


def test_vbnet_enrichment(tmp_path):
    res = _build(tmp_path, {
        'Engine.vb': (
            'Imports System.IO\n'
            'Interface Store\nEnd Interface\n'
            'Class Base\nEnd Class\n'
            'Class Settings\nEnd Class\n'
            'Class Request\nEnd Class\n'
            '<Serializable>\n'
            'Public Class Engine\n'
            '  Inherits Base\n'
            '  Implements Store\n'
            '  Private settings As Settings\n'
            '  <Obsolete>\n'
            '  Public Function Run(req As Request) As Settings\n'
            '    Dim cfg = File.ReadAllText("config/app.json")\n'
            '    Return New Settings()\n'
            '  End Function\n'
            'End Class\n'
        ),
        'config/app.json': '{}\n',
    })
    assert {'inheritance', 'implements', 'type_usage'} <= _sym_edge_types(res)
    assert 'config_ref' in _file_edge_types(res)
    assert _field_present(res, 'signature')
    assert _field_present(res, 'decorators')
    assert len(_symbol_edges(res, 'type_usage')) <= 8


def test_batch3_adversarial_builtins_strings_comments_and_ambiguity(tmp_path):
    res = _build(tmp_path, {
        'a.kt': 'class Dup {}\n',
        'b.kt': 'class Dup {}\n',
        'use.kt': (
            'fun useDup(x: Dup): Dup = x\n'
            'fun builtin(s: String): Int = 1\n'
            '// val hidden = File("hidden.json")\n'
            'val text = "File(\\"secret.json\\")"\n'
        ),
        'hidden.json': '{}\n',
        'secret.json': '{}\n',
        'noise.swift': (
            'func builtin(s: String) -> Int { return 1 }\n'
            '// let hidden = try? String(contentsOfFile: "hidden.json")\n'
            'let text = "String(contentsOfFile: \\"secret.json\\")"\n'
        ),
        'noise.php': (
            '<?php\n'
            'function builtin(string $s): int { return 1; }\n'
            '// require "hidden.json";\n'
            '$text = "require \\"secret.json\\"";\n'
        ),
        'noise.scala': (
            'def builtin(s: String): Int = 1\n'
            '// val hidden = Source.fromFile("hidden.json")\n'
            'val text = "Source.fromFile(\\"secret.json\\")"\n'
        ),
        'noise.dart': (
            'int builtin(String s) { return 1; }\n'
            '// final hidden = File("hidden.json");\n'
            'final text = "File(\\"secret.json\\")";\n'
        ),
        'noise.m': (
            'int builtin(NSString *s) { return 1; }\n'
            '// NSString *h = [NSString stringWithContentsOfFile:@"hidden.json" encoding:0 error:nil];\n'
            'NSString *t = @"stringWithContentsOfFile:@\\"secret.json\\"";\n'
        ),
        'noise.vb': (
            'Function Builtin(s As String) As Integer\n'
            '  Return 1\n'
            'End Function\n'
            "' Dim hidden = File.ReadAllText(\"hidden.json\")\n"
            'Dim text = "File.ReadAllText(""secret.json"")"\n'
        ),
    })
    assert ('useDup', 'Dup') not in _symbol_edge_name_pairs(res, 'type_usage')
    assert 'config_ref' not in _file_edge_types(res)
    assert 'asset_ref' not in _file_edge_types(res)


# ── Adversarial: must produce NO bogus edges ──────────────────────────────────

def test_ruby_family_ruby_enrichment(tmp_path):
    res = _build(tmp_path, {
        'base.rb': 'class Base\nend\n',
        'engine.rb': (
            'require_relative "base.rb"\n'
            'class Engine < Base\n'
            '  def run(req)\n'
            '    cfg = File.read("config/app.json")\n'
            '    helper(req)\n'
            '  end\n'
            'end\n'
        ),
        'config/app.json': '{}\n',
    })
    assert 'inheritance' in _sym_edge_types(res)
    assert {'import', 'config_ref'} <= _file_edge_types(res)
    assert _field_present(res, 'signature')
    assert not _symbol_edges(res, 'type_usage')
    assert any(e.get('line') == 4 for e in _file_edges(res, 'config_ref'))


def test_batch5_ruby_mixins_produce_semantic_edges(tmp_path):
    res = _build(tmp_path, {
        'types.rb': (
            'module Runnable\nend\n'
            'module ClassMethods\nend\n'
            'module FirstInLookup\nend\n'
            'class Base\nend\n'
        ),
        'engine.rb': (
            'require_relative "types.rb"\n'
            'class Engine < Base\n'
            '  include Runnable\n'
            '  extend ClassMethods\n'
            '  prepend FirstInLookup\n'
            '  def run(req)\n'
            '    req\n'
            '  end\n'
            'end\n'
        ),
    })
    assert {'inheritance', 'mixin_include', 'mixin_extend', 'mixin_prepend'} <= _sym_edge_types(res)
    assert ('Engine', 'Runnable') in _symbol_edge_name_pairs(res, 'mixin_include')
    assert ('Engine', 'ClassMethods') in _symbol_edge_name_pairs(res, 'mixin_extend')
    assert ('Engine', 'FirstInLookup') in _symbol_edge_name_pairs(res, 'mixin_prepend')
    assert ('Engine', 'Runnable') not in _symbol_edge_name_pairs(res, 'implements')
    assert not _symbol_edges(res, 'type_usage')


def test_ruby_family_crystal_enrichment(tmp_path):
    res = _build(tmp_path, {
        'engine.cr': (
            'class Base\nend\n'
            'class Settings\nend\n'
            'class Request\nend\n'
            'class Engine < Base\n'
            '  @settings : Settings\n'
            '  def run(req : Request) : Settings\n'
            '    cfg = File.read("config/app.json")\n'
            '    Settings.new\n'
            '  end\n'
            'end\n'
        ),
        'config/app.json': '{}\n',
    })
    assert {'inheritance', 'type_usage'} <= _sym_edge_types(res)
    assert 'config_ref' in _file_edge_types(res)
    assert _field_present(res, 'signature')
    assert len(_symbol_edges(res, 'type_usage')) <= 8


def test_ruby_family_julia_enrichment(tmp_path):
    res = _build(tmp_path, {
        'engine.jl': (
            'abstract type Base end\n'
            'struct Settings end\n'
            'struct Request end\n'
            'struct Engine <: Base\n'
            '  settings::Settings\n'
            'end\n'
            'function run(req::Request)::Settings\n'
            '  cfg = read("config/app.json", String)\n'
            '  Settings()\n'
            'end\n'
        ),
        'config/app.json': '{}\n',
    })
    assert {'inheritance', 'type_usage'} <= _sym_edge_types(res)
    assert 'config_ref' in _file_edge_types(res)
    assert _field_present(res, 'signature')
    assert len(_symbol_edges(res, 'type_usage')) <= 8


def test_ruby_family_elixir_enrichment(tmp_path):
    res = _build(tmp_path, {
        'engine.ex': (
            'defmodule Request do\nend\n'
            'defmodule Settings do\nend\n'
            'defmodule Engine do\n'
            '  @spec run(Request.t()) :: Settings.t()\n'
            '  def run(req) do\n'
            '    {:ok, cfg} = File.read("config/app.json")\n'
            '    req\n'
            '  end\n'
            'end\n'
        ),
        'config/app.json': '{}\n',
    })
    assert 'type_usage' in _sym_edge_types(res)
    assert 'config_ref' in _file_edge_types(res)
    assert _field_present(res, 'signature')
    pairs = _symbol_edge_name_pairs(res, 'type_usage')
    assert ('run', 'Request') in pairs
    assert ('run', 'Settings') in pairs


def test_batch5_elixir_behaviour_impl(tmp_path):
    res = _build(tmp_path, {
        'engine.ex': (
            'defmodule Request do\nend\n'
            'defmodule Settings do\nend\n'
            'defmodule RunnerBehaviour do\n'
            '  @callback run(Request.t()) :: Settings.t()\n'
            'end\n'
            'defmodule Engine do\n'
            '  @behaviour RunnerBehaviour\n'
            '  @spec run(Request.t()) :: Settings.t()\n'
            '  def run(req) do\n'
            '    req\n'
            '  end\n'
            'end\n'
        ),
    })
    assert {'behaviour_impl', 'type_usage'} <= _sym_edge_types(res)
    assert ('Engine', 'RunnerBehaviour') in _symbol_edge_name_pairs(res, 'behaviour_impl')
    assert ('Engine', 'RunnerBehaviour') not in _symbol_edge_name_pairs(res, 'implements')


def test_batch5_elixir_protocol_impl(tmp_path):
    res = _build(tmp_path, {
        'engine.ex': (
            'defmodule Engine do\nend\n'
            'defprotocol RunnerProtocol do\n'
            '  def run(value)\n'
            'end\n'
            'defimpl RunnerProtocol, for: Engine do\n'
            '  def run(value), do: value\n'
            'end\n'
        ),
    })
    assert 'protocol_impl' in _sym_edge_types(res)
    assert ('RunnerProtocol for Engine', 'RunnerProtocol') in _symbol_edge_name_pairs(res, 'protocol_impl')
    assert ('RunnerProtocol for Engine', 'RunnerProtocol') not in _symbol_edge_name_pairs(res, 'implements')


def test_batch5_erlang_behaviour_impl_and_signature(tmp_path):
    res = _build(tmp_path, {
        'worker_behaviour.erl': (
            '-module(worker_behaviour).\n'
            '-callback run(term()) -> term().\n'
        ),
        'engine.erl': (
            '-module(engine).\n'
            '-behaviour(worker_behaviour).\n'
            '-export([run/1]).\n'
            'run(Req) -> Req.\n'
        ),
    })
    assert 'behaviour_impl' in _sym_edge_types(res)
    assert ('engine', 'worker_behaviour') in _symbol_edge_name_pairs(res, 'behaviour_impl')
    assert ('engine', 'worker_behaviour') not in _symbol_edge_name_pairs(res, 'implements')
    assert _field_present(res, 'signature')


def test_batch5_powershell_signature_and_file_refs(tmp_path):
    res = _build(tmp_path, {
        'Engine.ps1': (
            'function Invoke-Engine {\n'
            '  param([string]$Name)\n'
            '  $cfg = Get-Content "config/app.json"\n'
            '  $page = [IO.File]::ReadAllText("templates/page.html")\n'
            '  $rows = Import-Csv "data/report.csv"\n'
            '  return $Name\n'
            '}\n'
        ),
        'config/app.json': '{}\n',
        'templates/page.html': '<html></html>\n',
        'data/report.csv': 'id\n1\n',
    })
    assert {'config_ref', 'asset_ref'} <= _file_edge_types(res)
    assert _field_present(res, 'signature')


def test_batch4_nim_enrichment(tmp_path):
    res = _build(tmp_path, {
        'engine.nim': (
            'type\n'
            '  Base* = object\n'
            '  Request* = object\n'
            '  Settings* = object\n'
            '  Engine* = object of Base\n'
            '    settings*: Settings\n'
            '\n'
            'proc run*(req: Request): Settings =\n'
            '  discard req\n'
        ),
    })
    assert {'inheritance', 'type_usage'} <= _sym_edge_types(res)
    assert _field_present(res, 'signature')
    pairs = _symbol_edge_name_pairs(res, 'type_usage')
    assert ('run', 'Request') in pairs
    assert ('run', 'Settings') in pairs
    assert len(_symbol_edges(res, 'type_usage')) <= 8


def test_batch4_fsharp_enrichment(tmp_path):
    res = _build(tmp_path, {
        'engine.fs': (
            'type Base = class end\n'
            'type Store = interface end\n'
            'type Request = class end\n'
            'type Settings = class end\n'
            'type Engine =\n'
            '    inherit Base()\n'
            '    interface Store\n'
            '    member this.Run(req: Request) : Settings =\n'
            '        Settings()\n'
        ),
    })
    assert {'inheritance', 'implements', 'type_usage'} <= _sym_edge_types(res)
    assert _field_present(res, 'signature')
    pairs = _symbol_edge_name_pairs(res, 'type_usage')
    assert ('Run', 'Request') in pairs
    assert ('Run', 'Settings') in pairs
    assert len(_symbol_edges(res, 'type_usage')) <= 8


def test_batch4_haskell_enrichment(tmp_path):
    res = _build(tmp_path, {
        'Engine.hs': (
            'data Request = Request\n'
            'data Settings = Settings\n'
            'data Engine = Engine Settings\n'
            'run :: Request -> Settings\n'
            'run req = Settings\n'
        ),
    })
    assert 'type_usage' in _sym_edge_types(res)
    assert _field_present(res, 'signature')
    pairs = _symbol_edge_name_pairs(res, 'type_usage')
    assert ('run', 'Request') in pairs
    assert ('run', 'Settings') in pairs
    assert len(_symbol_edges(res, 'type_usage')) <= 8


def test_batch4_ocaml_enrichment(tmp_path):
    res = _build(tmp_path, {
        'engine.ml': (
            'type request = Request\n'
            'type settings = Settings\n'
            'let run (req : request) : settings =\n'
            '  req\n'
        ),
    })
    assert 'type_usage' in _sym_edge_types(res)
    assert _field_present(res, 'signature')
    pairs = _symbol_edge_name_pairs(res, 'type_usage')
    assert ('run', 'request') in pairs
    assert ('run', 'settings') in pairs
    assert len(_symbol_edges(res, 'type_usage')) <= 8


def test_batch4_elm_enrichment(tmp_path):
    res = _build(tmp_path, {
        'Engine.elm': (
            'module Engine exposing (..)\n'
            '\n'
            'type Request = Request\n'
            'type Settings = Settings\n'
            '\n'
            'run : Request -> Settings\n'
            'run req =\n'
            '    Settings\n'
        ),
    })
    assert 'type_usage' in _sym_edge_types(res)
    assert _field_present(res, 'signature')
    pairs = _symbol_edge_name_pairs(res, 'type_usage')
    assert ('run', 'Request') in pairs
    assert ('run', 'Settings') in pairs
    assert len(_symbol_edges(res, 'type_usage')) <= 8


def test_batch4_adversarial_comments_strings_dynamic_paths_and_ambiguity(tmp_path):
    res = _build(tmp_path, {
        'a.jl': 'struct Dup end\n',
        'b.jl': 'struct Dup end\n',
        'use.jl': (
            'function use_dup(x::Dup)::Dup\n'
            '  x\n'
            'end\n'
            '# read("hidden.json", String)\n'
            'txt = "read(\\"secret.json\\", String)"\n'
        ),
        'noise.rb': (
            '# File.read("hidden.json")\n'
            'text = "File.read(\\"secret.json\\")"\n'
            'path = "config/app.json"\n'
            'File.read(path)\n'
        ),
        'noise.cr': (
            '# File.read("hidden.json")\n'
            'text = "File.read(\\"secret.json\\")"\n'
            'path = "config/app.json"\n'
            'File.read(path)\n'
        ),
        'noise.ex': (
            '# File.read("hidden.json")\n'
            'text = "File.read(\\"secret.json\\")"\n'
            'path = "config/app.json"\n'
            'File.read(path)\n'
        ),
        'hidden.json': '{}\n',
        'secret.json': '{}\n',
        'config/app.json': '{}\n',
    })
    assert ('use_dup', 'Dup') not in _symbol_edge_name_pairs(res, 'type_usage')
    assert 'config_ref' not in _file_edge_types(res)
    assert 'asset_ref' not in _file_edge_types(res)


def test_batch4_remaining_adversarial_builtins_comments_strings_ambiguity(tmp_path):
    res = _build(tmp_path, {
        'a.nim': 'type\n  Dup* = object\n',
        'b.nim': 'type\n  Dup* = object\n',
        'use.nim': 'proc useDup*(x: Dup): Dup =\n  discard x\n',
        'noise.hs': (
            'data Hidden = Hidden\n'
            'data Secret = Secret\n'
            '-- fake :: Hidden -> Secret\n'
            'txt = "fake :: Hidden -> Secret"\n'
            'builtinOnly :: String -> Int\n'
            'builtinOnly x = 1\n'
        ),
        'noise.fs': (
            'type HiddenFs = class end\n'
            '// let fake (x: HiddenFs) : HiddenFs = x\n'
            'let text = "let fake (x: HiddenFs) : HiddenFs = x"\n'
            'let builtinOnly (x: string) : int = 1\n'
        ),
        'noise.ml': (
            'type hidden = Hidden\n'
            '(* let fake (x : hidden) : hidden = x *)\n'
            'let text = "let fake (x : hidden) : hidden = x"\n'
            'let builtin_only (x : string) : int = 1\n'
        ),
        'Noise.elm': (
            'module Noise exposing (..)\n'
            'type HiddenElm = HiddenElm\n'
            '-- fake : HiddenElm -> HiddenElm\n'
            'text = "fake : HiddenElm -> HiddenElm"\n'
            'builtinOnly : String -> Int\n'
            'builtinOnly x = 1\n'
        ),
    })
    pairs = _symbol_edge_name_pairs(res, 'type_usage')
    assert ('useDup', 'Dup') not in pairs
    assert ('fake', 'Hidden') not in pairs
    assert ('fake', 'Secret') not in pairs
    assert ('fake', 'HiddenFs') not in pairs
    assert ('fake', 'hidden') not in pairs
    assert ('fake', 'HiddenElm') not in pairs
    assert not any(src == 'builtinOnly' for src, _target in pairs)
    assert len(_symbol_edges(res, 'type_usage')) <= 4


def test_batch5_data_and_markup_edge_coverage(tmp_path):
    res = _build(tmp_path, {
        'index.html': (
            '<link rel="modulepreload" href="scripts/chunk.js">\n'
            '<link rel="manifest" href="config/manifest.json">\n'
            '<img srcset="templates/hero.html 1x, templates/hero2.html 2x">\n'
            '<video poster="templates/poster.html"></video>\n'
        ),
        'styles/site.css': (
            '.hero { background-image: url("../templates/bg.html"); }\n'
            '@font-face { src: url("../styles/icon.css"); }\n'
        ),
        'schema.yaml': (
            'configFile: config/app.json\n'
            'template: templates/page.html\n'
        ),
        'settings.toml': (
            'schemaFile = "config/schema.json"\n'
            'template = "templates/email.html"\n'
        ),
        'app.json': (
            '{\n'
            '  "configFile": "config/app.yaml",\n'
            '  "templateFile": "templates/card.html"\n'
            '}\n'
        ),
        'scripts/chunk.js': 'export const x = 1;\n',
        'styles/icon.css': 'body {}\n',
        'templates/hero.html': '<html></html>\n',
        'templates/hero2.html': '<html></html>\n',
        'templates/poster.html': '<html></html>\n',
        'templates/bg.html': '<html></html>\n',
        'config/manifest.json': '{}\n',
        'config/app.json': '{}\n',
        'templates/page.html': '<html></html>\n',
        'config/schema.json': '{}\n',
        'templates/email.html': '<html></html>\n',
        'config/app.yaml': 'ok: true\n',
        'templates/card.html': '<html></html>\n',
    })
    assert {'asset_ref', 'config_ref', 'resource_hint', 'schema_ref'} <= _file_edge_types(res)
    assert len(_file_edges(res, 'asset_ref')) >= 5
    assert len(_file_edges(res, 'config_ref')) >= 5
    assert any(e.get('subtype') == 'modulepreload' for e in _file_edges(res, 'resource_hint'))
    assert any(e.get('via') == 'schemaFile' for e in _file_edges(res, 'schema_ref'))


def test_batch5_adversarial_comments_strings_dynamic_and_urls(tmp_path):
    res = _build(tmp_path, {
        'noise.ps1': (
            '# Get-Content "hidden.json"\n'
            '$text = "Get-Content \\"secret.json\\""\n'
            '$path = "config/app.json"\n'
            'Get-Content $path\n'
        ),
        'noise.html': '<!-- <img src="hidden.png"> -->\n<img src="https://example.test/remote.png">\n',
        'noise.css': (
            '/* background: url("hidden.png"); */\n'
            '.x { content: "url(secret.png)"; background: url("data:image/png;base64,abc"); }\n'
        ),
        'noise.yaml': (
            '# configFile: hidden.json\n'
            'text: "templateFile: secret.html"\n'
        ),
        'noise.json': (
            '{\n'
            '  "text": "config/app.json",\n'
            '  "configFile": "https://example.test/app.json",\n'
            '  "$ref": "#/defs/Local"\n'
            '}\n'
        ),
        'hidden.json': '{}\n',
        'secret.json': '{}\n',
        'hidden.png': '',
        'secret.png': '',
        'config/app.json': '{}\n',
    })
    assert 'config_ref' not in _file_edge_types(res)
    assert 'asset_ref' not in _file_edge_types(res)


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


# ── Batch 6: common_parser generic signature + complexity ─────────────────────
# scan_common is the regex fallback for SCAN_EXT extensions without a dedicated
# parser (today: vendor firmware / make, plus any future long-tail language).
# These tests exercise the parser unit directly, mirroring the scan_java /
# scan_csharp direct-import tests above.

def test_batch6_common_parser_signature_and_complexity():
    """Fallback symbols carry a one-line signature + branch-keyword complexity."""
    from parsers.common_parser import scan_common
    src = (
        'class Engine {\n'
        '  int run(int n) {\n'
        '    if (n > 0 && n < 10) { return 1; }\n'
        '    return 0;\n'
        '  }\n'
        '}\n'
    )
    symbols = scan_common(src, '.sdl')[5]
    by_name = {s['name']: s for s in symbols}
    assert 'Engine' in by_name and 'run' in by_name
    # signature present on both the type decl and the function
    assert by_name['Engine'].get('signature')
    assert 'run' in (by_name['run'].get('signature') or '')
    # complexity = 1 (base) + if + && = 3
    assert by_name['run'].get('complexity') == 3
    # type_refs intentionally NOT emitted by the generic fallback (explosion risk)
    assert not by_name['run'].get('type_refs')


def test_batch6_common_parser_complexity_ignores_comments_and_strings():
    """Branch tokens inside comments / string literals must not inflate complexity."""
    from parsers.common_parser import scan_common
    src = (
        'int run(int n) {\n'
        '  // if (n > 99 && n < 0) { bad(); }\n'
        '  char* s = "if (x) && (y) || z";\n'
        '  return n;\n'
        '}\n'
    )
    symbols = scan_common(src, '.sdl')[5]
    by_name = {s['name']: s for s in symbols}
    assert 'run' in by_name
    assert by_name['run'].get('complexity') == 1
    assert by_name['run'].get('signature') == 'int run(int n)'


def test_batch6_common_parser_braceless_def_has_no_complexity():
    """Non-brace fallback defs degrade gracefully: signature yes, complexity None."""
    from parsers.common_parser import scan_common
    # Erlang-style clause has no brace body; complexity stays None, signature set.
    src = 'do_work(Arg) -> Arg.\n'
    symbols = scan_common(src, '.sdl')[5]
    by_name = {s['name']: s for s in symbols}
    assert 'do_work' in by_name
    assert by_name['do_work'].get('signature')
    assert by_name['do_work'].get('complexity') is None


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
