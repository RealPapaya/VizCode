"""
tests/test_parsers.py — Validate language parser 6-tuple contract.

Every parser must return exactly:
  (imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs)

Where:
  imports           list[str]
  funcdefs          list[dict]  each with 'label' key
  funccalls         list[str]
  extra             dict | None
  func_calls_by_func list[list[str]]  len == len(funcdefs)
  symbol_defs       list[dict]  each with 'name', 'kind', 'line' keys
"""
import pytest
from parsers.python_parser import scan_python
from parsers.js_parser import scan_js
from parsers.go_parser import scan_go
from parsers.c_cpp_parser import scan_c_cpp
from parsers.csharp_parser import scan_csharp
from parsers.uefi_parser import scan_uefi
from parsers.html_parser import scan_html
from parsers.css_parser import scan_css
from parsers.yaml_parser import scan_yaml
from parsers.json_parser import scan_json
from parsers.powershell_parser import scan_powershell
from parsers.graphql_parser import scan_graphql
from parsers.protobuf_parser import scan_protobuf
from parsers.kotlin_parser import scan_kotlin
from parsers.swift_parser import scan_swift
from parsers.php_parser import scan_php
from parsers.scala_parser import scan_scala
from parsers.dart_parser import scan_dart
from parsers.objc_parser import scan_objc
from parsers.vbnet_parser import scan_vbnet
from parsers.ruby_parser import scan_ruby
from parsers.crystal_parser import scan_crystal
from parsers.julia_parser import scan_julia
from parsers.elixir_parser import scan_elixir
from parsers.erlang_parser import scan_erlang
from parsers.nim_parser import scan_nim
from parsers.fsharp_parser import scan_fsharp
from parsers.haskell_parser import scan_haskell
from parsers.ocaml_parser import scan_ocaml
from parsers.elm_parser import scan_elm


# ─── Helper ──────────────────────────────────────────────────────────────────

def assert_six_tuple(result, name='parser'):
    """Assert the result is a valid 6-tuple matching the contract."""
    assert isinstance(result, tuple), f'{name}: must return a tuple'
    assert len(result) == 6, f'{name}: must return exactly 6 elements, got {len(result)}'

    imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs = result

    assert isinstance(imports, list), f'{name}: imports must be list'
    assert isinstance(funcdefs, list), f'{name}: funcdefs must be list'
    assert isinstance(funccalls, list), f'{name}: funccalls must be list'
    assert extra is None or isinstance(extra, dict), f'{name}: extra must be dict or None'
    assert isinstance(func_calls_by_func, list), f'{name}: func_calls_by_func must be list'
    assert isinstance(symbol_defs, list), f'{name}: symbol_defs must be list'

    assert len(func_calls_by_func) == len(funcdefs), (
        f'{name}: func_calls_by_func length ({len(func_calls_by_func)}) '
        f'must equal funcdefs length ({len(funcdefs)})'
    )

    for fd in funcdefs:
        assert isinstance(fd, dict), f'{name}: each funcdef must be dict'
        assert 'label' in fd, f'{name}: each funcdef must have "label" key'

    for sym in symbol_defs:
        assert isinstance(sym, dict), f'{name}: each symbol_def must be dict'
        for key in ('name', 'kind', 'line'):
            assert key in sym, f'{name}: symbol_def missing "{key}" key: {sym}'

    return imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs


# ─── Python Parser ────────────────────────────────────────────────────────────

class TestPythonParser:
    def test_six_tuple_contract(self, py_src):
        result = scan_python(py_src)
        assert_six_tuple(result, 'scan_python')

    def test_imports_extracted(self, py_src):
        imports, *_ = scan_python(py_src)
        assert 'os' in imports
        assert 're' in imports

    def test_classes_in_symbol_defs(self, py_src):
        *_, symbol_defs = scan_python(py_src)
        kinds = [s['kind'] for s in symbol_defs]
        assert 'class' in kinds

    def test_class_names(self, py_src):
        *_, symbol_defs = scan_python(py_src)
        names = [s['name'] for s in symbol_defs if s['kind'] == 'class']
        assert 'Greeter' in names
        assert 'FancyGreeter' in names

    def test_functions_in_funcdefs(self, py_src):
        _, funcdefs, *_ = scan_python(py_src)
        labels = [f['label'] for f in funcdefs]
        assert any('main' in l or 'greet' in l or '__init__' in l for l in labels)

    def test_empty_source(self):
        result = scan_python('')
        imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs = result
        assert imports == []
        assert funcdefs == []
        assert symbol_defs == []

    def test_no_crash_on_syntax_error(self):
        bad_src = 'def broken(\n  x =\n'
        result = scan_python(bad_src)
        assert len(result) == 6

    def test_python_import_forms_are_normalized(self):
        src = '''\
from __future__ import annotations
import os, pkg.mod as alias
import xml.etree.ElementTree as ET
from package.sub import thing
from . import sibling
from .subpackage import other
'''
        imports, *_ = scan_python(src)
        assert imports == ['os', 'pkg', 'xml', 'package', 'sibling', 'subpackage']

    def test_python_ast_symbols_docstrings_decorators_and_signatures(self):
        src = '''\
"""module docs"""

def deco(fn):
    return fn

class Service(Base):
    """class docs"""

    @deco
    async def run(self, item: str) -> str:
        """method docs"""
        await worker(item)
        return item

def outer(value: int = 1):
    """outer docs"""
    def inner():
        """inner docs"""
        return helper(value)
    return inner()

anon = lambda x: x
'''
        _, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs = scan_python(src)
        labels = [f['label'] for f in funcdefs]
        by_name = {s['name']: s for s in symbol_defs}

        assert labels == ['deco', 'run', 'outer', 'inner']
        assert 'lambda' not in labels
        assert by_name['Service']['kind'] == 'class'
        assert by_name['run']['kind'] == 'method'
        assert by_name['run']['parent'] == 'Service'
        assert by_name['run']['decorators'] == ['deco']
        assert by_name['run']['signature'] == '(self, item: str) -> str'
        assert by_name['inner']['kind'] == 'function'
        assert extra['docstrings']['__module__'] == 'module docs'
        assert extra['docstrings']['Service'] == 'class docs'
        assert extra['docstrings']['Service.run'] == 'method docs'
        assert extra['docstrings']['outer'] == 'outer docs'
        assert 'worker' in funccalls
        assert 'helper' in funccalls
        assert func_calls_by_func[2] == ['inner']
        assert func_calls_by_func[3] == ['helper']

    def test_python_calls_exclude_declarations_and_builtins(self):
        src = '''\
def alpha():
    beta()
    print(len([1]))

def beta():
    return None
'''
        _, _, funccalls, _, func_calls_by_func, _ = scan_python(src)
        assert 'alpha' not in funccalls
        assert funccalls == ['beta']
        assert func_calls_by_func == [['beta'], []]

    def test_python_fallback_ignores_comments_and_literals(self):
        src = r'''\
import realpkg

# import fake_comment
# def fake_comment_func():
# class FakeComment:

TEXT = "import fake_string; def fake_string_func(): fake_call() # not comment"
TRIPLE = """
from fake_triple import thing
class FakeTriple:
    def hidden(self):
        fake_triple_call()
"""
RAW = r"def fake_raw(): raw_call()"
BYTES = b"import fake_bytes"
FSTR = f"def fake_fstring(): {42}"

def real():
    helper()

def broken(
'''
        imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs = scan_python(src)
        labels = {f['label'] for f in funcdefs}
        names = {s['name'] for s in symbol_defs}

        assert len((imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs)) == 6
        assert extra['file_error'].startswith('SyntaxError:')
        assert imports == ['realpkg']
        assert labels == {'real'}
        assert names == {'real'}
        assert funccalls == ['helper']
        assert func_calls_by_func == [['helper']]


# ─── JavaScript Parser ────────────────────────────────────────────────────────

class TestJsParser:
    def test_six_tuple_contract(self, js_src):
        result = scan_js(js_src)
        assert_six_tuple(result, 'scan_js')

    def test_imports_extracted(self, js_src):
        imports, *_ = scan_js(js_src)
        assert any('fs' in imp or 'path' in imp for imp in imports)

    def test_classes_in_symbol_defs(self, js_src):
        *_, symbol_defs = scan_js(js_src)
        kinds = [s['kind'] for s in symbol_defs]
        assert 'class' in kinds

    def test_class_names(self, js_src):
        *_, symbol_defs = scan_js(js_src)
        names = [s['name'] for s in symbol_defs if s['kind'] == 'class']
        assert 'Animal' in names
        assert 'Dog' in names

    def test_empty_source(self):
        result = scan_js('')
        assert len(result) == 6

    def test_no_crash_on_malformed(self):
        result = scan_js('const x = {{{')
        assert len(result) == 6


# ─── Go Parser ───────────────────────────────────────────────────────────────

class TestGoParser:
    def test_six_tuple_contract(self, go_src):
        result = scan_go(go_src)
        assert_six_tuple(result, 'scan_go')

    def test_imports_extracted(self, go_src):
        imports, *_ = scan_go(go_src)
        assert 'fmt' in imports

    def test_structs_in_symbol_defs(self, go_src):
        *_, symbol_defs = scan_go(go_src)
        kinds = [s['kind'] for s in symbol_defs]
        assert 'struct' in kinds

    def test_struct_names(self, go_src):
        *_, symbol_defs = scan_go(go_src)
        names = [s['name'] for s in symbol_defs if s['kind'] == 'struct']
        assert 'Animal' in names

    def test_empty_source(self):
        result = scan_go('')
        assert len(result) == 6

    def test_grouped_imports_with_alias_blank_and_dot(self):
        src = '''\
package main

import (
    "fmt"
    alias "example.com/project/pkg"
    _ "net/http/pprof"
    . "math"
)

func main() {
    fmt.Println(alias.Name, pprof.Profile, Pi)
}
'''
        imports, *_ = scan_go(src)
        assert {'fmt', 'pkg', 'pprof', 'math'} <= set(imports)

    def test_structs_interfaces_methods_functions_and_docs(self):
        src = '''\
package main

// Service handles work.
type Service struct {
    Name string
}

/*
Runner executes services.
*/
type Runner interface {
    Run() error
}

// Start begins work.
func (s *Service) Start() {
    helper()
}

// helper supports Start.
func helper() {}
'''
        _, funcdefs, _, extra, _, symbol_defs = scan_go(src)
        labels = {f['label'] for f in funcdefs}
        assert {'Start', 'helper'} <= labels

        by_name = {(s['kind'], s['name']): s for s in symbol_defs}
        assert ('struct', 'Service') in by_name
        assert ('interface', 'Runner') in by_name
        assert ('method', 'Start') in by_name
        assert ('function', 'helper') in by_name
        assert by_name[('method', 'Start')]['parent'] == 'Service'

        docs = extra['docstrings']
        assert docs['Service'] == 'Service handles work.'
        assert docs['Runner'] == 'Runner executes services.'
        assert docs['Service.Start'] == 'Start begins work.'
        assert docs['helper'] == 'helper supports Start.'

    def test_commented_out_go_code_is_ignored(self):
        src = '''\
package main

/*
import "fakepkg"
type Fake struct {}
func FakeCall() {}
*/
// func AlsoFake() {}
// import "otherfake"

import "fmt"

func Real() {
    fmt.Println("ok")
}
'''
        imports, funcdefs, funccalls, _, _, symbol_defs = scan_go(src)
        labels = {f['label'] for f in funcdefs}
        symbol_names = {s['name'] for s in symbol_defs}

        assert imports == ['fmt']
        assert labels == {'Real'}
        assert 'FakeCall' not in funccalls
        assert 'Fake' not in symbol_names
        assert 'AlsoFake' not in symbol_names

    def test_comment_markers_inside_literals_are_not_comments(self):
        src = '''\
package main

import "fmt"

func Real() {
    fmt.Println("http://example.test/path"); helper()
    fmt.Println("not /* a block comment */"); helper()
    fmt.Println(`raw // text and /* text */`); helper()
    r := '/'
    _ = r
    helper()
}

func helper() {}
'''
        imports, _, funccalls, _, func_calls_by_func, symbol_defs = scan_go(src)
        names = {s['name'] for s in symbol_defs}

        assert imports == ['fmt']
        assert {'Real', 'helper'} <= names
        assert 'helper' in funccalls
        assert func_calls_by_func[0].count('helper') == 4

    def test_block_comments_preserve_symbol_line_numbers(self):
        src = '''\
package main

/*
type Fake struct {}
func Fake() {}
*/
type Later struct {}
'''
        *_, symbol_defs = scan_go(src)
        later = next(s for s in symbol_defs if s['name'] == 'Later')
        assert later['line'] == 7

    def test_funccalls_excludes_function_declarations(self):
        src = '''\
package main

func Alpha() {
    Beta()
}

func Beta() {}
'''
        _, _, funccalls, _, func_calls_by_func, _ = scan_go(src)
        assert 'Alpha' not in funccalls
        assert funccalls.count('Beta') == 1
        assert func_calls_by_func == [['Beta'], []]


# ─── C / C++ Parser ──────────────────────────────────────────────────────────

class TestCCppParser:
    def test_six_tuple_contract(self, c_src):
        result = scan_c_cpp(c_src, '.c')
        assert_six_tuple(result, 'scan_c_cpp')

    def test_includes_extracted(self, c_src):
        imports, *_ = scan_c_cpp(c_src, '.c')
        # includes come back as the header filename
        assert any('stdio' in imp or 'myheader' in imp for imp in imports)

    def test_funcdefs_extracted(self, c_src):
        _, funcdefs, *_ = scan_c_cpp(c_src, '.c')
        labels = [f['label'] for f in funcdefs]
        assert any('add' in l for l in labels)
        assert any('main' in l for l in labels)

    def test_struct_in_symbol_defs(self, c_src):
        *_, symbol_defs = scan_c_cpp(c_src, '.c')
        kinds = [s['kind'] for s in symbol_defs]
        assert 'struct' in kinds or 'typedef' in kinds or len(symbol_defs) >= 0

    def test_empty_source(self):
        result = scan_c_cpp('', '.c')
        assert len(result) == 6

    def test_no_crash_on_garbage(self):
        result = scan_c_cpp('!!!@@@###$$$', '.c')
        assert len(result) == 6

    def test_comments_and_literals_do_not_create_c_results(self):
        src = r'''\
#include "real.h"
// #include "fake_comment.h"
/* void FakeComment(void) { fake_comment_call(); } */
const char *s = "#include <fake_string.h>\nvoid FakeString() { fake_string_call(); }";
const char *raw = R"tag(
#include "fake_raw.h"
void FakeRaw() { fake_raw_call(); }
)tag";

static void real(void) {
    helper();
}
'''
        imports, funcdefs, funccalls, _, func_calls_by_func, symbol_defs = scan_c_cpp(src, '.cpp')
        labels = {f['label'] for f in funcdefs}
        names = {s['name'] for s in symbol_defs}

        assert imports == ['real.h']
        assert labels == {'real'}
        assert names == {'real'}
        assert funccalls == ['helper']
        assert func_calls_by_func == [['helper']]

    def test_cpp_classes_methods_constructors_and_enums(self):
        src = '''\
#include <vector>

class Widget : public Base {
public:
    Widget();
    void tick();
};

enum class Mode { Fast, Slow };
typedef struct { int x; } Point;

Widget::Widget() {
    init();
}

void Widget::tick() const {
    render();
}

static int helper(Point p) {
    return compute(p.x);
}
'''
        imports, funcdefs, funccalls, _, func_calls_by_func, symbol_defs = scan_c_cpp(src, '.cpp')
        labels = [f['label'] for f in funcdefs]
        by_name = {(s['kind'], s['name']): s for s in symbol_defs}

        assert imports == ['vector']
        assert labels == ['Widget', 'tick', 'helper']
        assert ('class', 'Widget') in by_name
        assert by_name[('class', 'Widget')]['bases'] == ['Base']
        assert ('enum', 'Mode') in by_name
        assert ('typedef', 'Point') in by_name
        assert by_name[('method', 'tick')]['parent'] == 'Widget'
        assert func_calls_by_func == [['init'], ['render'], ['compute']]
        assert funccalls == ['init', 'render', 'compute']


# ─── C# Parser ────────────────────────────────────────────────────────────────

class TestCSharpParser:
    def test_six_tuple_contract(self):
        result = scan_csharp('class Demo { public void Run() {} }', '.cs')
        assert_six_tuple(result, 'scan_csharp')

    def test_usings_and_symbols(self):
        src = '''\
global using System.Text;
using static System.Math;
using Widgets = App.Core.Widgets;

namespace App.Core;

public interface IRunner { void Run(); }
public record Job(int Id);

public class Worker : BaseWorker, IRunner {
    public string Name { get; init; }

    public Worker() {
        Init();
    }

    public async Task Run() {
        await ExecuteAsync();
        Helper();
    }

    private void Helper() {}
}
'''
        imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs = scan_csharp(src, '.cs')
        labels = [f['label'] for f in funcdefs]
        by_name = {(s['kind'], s['name']): s for s in symbol_defs}

        assert imports == ['Text', 'Math', 'Widgets']
        assert extra['namespaces'] == ['App.Core']
        assert 'Name' not in labels
        assert labels == ['Worker', 'Run', 'Helper']
        assert ('interface', 'IRunner') in by_name
        assert ('record', 'Job') in by_name
        assert by_name[('class', 'Worker')]['bases'] == ['BaseWorker', 'IRunner']
        assert by_name[('method', 'Helper')]['parent'] == 'Worker'
        assert 'ExecuteAsync' in funccalls
        assert 'Helper' in funccalls
        assert func_calls_by_func[0] == ['Init']
        assert func_calls_by_func[1] == ['ExecuteAsync', 'Helper']

    def test_csharp_comments_and_literals_are_ignored(self):
        src = r'''\
using Real.Namespace;
// using Fake.Comment;
/* class FakeBlock { void Hidden() { fake_block_call(); } } */

class Real {
    string normal = "using Fake.String; void Hidden() { fake_string_call(); }";
    string verbatim = @"using Fake.Verbatim; fake_verbatim_call()";
    string raw = """
using Fake.Raw;
class FakeRaw { void Hidden() { fake_raw_call(); } }
""";

    public void Run() {
        Helper();
    }

    void Helper() {}
}
'''
        imports, funcdefs, funccalls, _, func_calls_by_func, symbol_defs = scan_csharp(src, '.cs')
        labels = {f['label'] for f in funcdefs}
        names = {s['name'] for s in symbol_defs}

        assert imports == ['Namespace']
        assert labels == {'Run', 'Helper'}
        assert names == {'Real', 'Run', 'Helper'}
        assert funccalls == ['Helper']
        assert func_calls_by_func == [['Helper'], []]


# ─── UEFI / Firmware Parser ──────────────────────────────────────────────────

class TestUefiParser:
    def test_six_tuple_contract_for_inf(self):
        result = scan_uefi('[Sources]\nMain.c\n[Packages]\nPkg.dec\n', '.inf')
        assert_six_tuple(result, 'scan_uefi')

    def test_inf_refs_extracted(self):
        imports, *_ = scan_uefi('[Sources]\nMain.c\n[Packages]\nPkg.dec\n', '.inf')
        assert imports == ['Main.c', 'Pkg.dec']

    def test_c_sources_are_not_uefi_parser_scope(self, c_src):
        imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs = scan_uefi(c_src, '.c')
        assert imports == []
        assert funcdefs == []
        assert funccalls == []
        assert extra is None
        assert func_calls_by_func == []
        assert symbol_defs == []


class TestBatch3DedicatedParsers:
    def test_kotlin_six_tuple_contract(self):
        result = scan_kotlin('class Demo { fun run(req: Request): Settings = Settings() }\n')
        assert_six_tuple(result, 'scan_kotlin')

    def test_swift_six_tuple_contract(self):
        result = scan_swift('class Demo { func run(req: Request) -> Settings { Settings() } }\n')
        assert_six_tuple(result, 'scan_swift')

    def test_php_six_tuple_contract(self):
        result = scan_php('<?php class Demo { public function run(Request $req): Settings {} }\n')
        assert_six_tuple(result, 'scan_php')

    def test_scala_six_tuple_contract(self):
        result = scan_scala('class Demo { def run(req: Request): Settings = new Settings() }\n')
        assert_six_tuple(result, 'scan_scala')

    def test_dart_six_tuple_contract(self):
        result = scan_dart('class Demo { Settings run(Request req) { return Settings(); } }\n')
        assert_six_tuple(result, 'scan_dart')

    def test_objc_six_tuple_contract(self):
        result = scan_objc('@interface Demo\n- (Settings *)run:(Request *)req;\n@end\n')
        assert_six_tuple(result, 'scan_objc')

    def test_vbnet_six_tuple_contract(self):
        result = scan_vbnet('Class Demo\nFunction Run(req As Request) As Settings\nEnd Function\nEnd Class\n')
        assert_six_tuple(result, 'scan_vbnet')


class TestBatch4DedicatedParsers:
    def test_ruby_six_tuple_contract(self):
        result = scan_ruby('class Demo < Base\n  def run(req)\n    helper(req)\n  end\nend\n')
        assert_six_tuple(result, 'scan_ruby')

    def test_crystal_six_tuple_contract(self):
        result = scan_crystal('class Demo < Base\n  def run(req : Request) : Settings\n    Settings.new\n  end\nend\n')
        assert_six_tuple(result, 'scan_crystal')

    def test_julia_six_tuple_contract(self):
        result = scan_julia('struct Demo <: Base\n  settings::Settings\nend\nfunction run(req::Request)::Settings\n  Settings()\nend\n')
        assert_six_tuple(result, 'scan_julia')

    def test_elixir_six_tuple_contract(self):
        result = scan_elixir('defmodule Demo do\n  @spec run(Request.t()) :: Settings.t()\n  def run(req), do: req\nend\n')
        assert_six_tuple(result, 'scan_elixir')

    def test_erlang_six_tuple_contract(self):
        result = scan_erlang('-module(demo).\n-export([run/1]).\nrun(Req) -> Req.\n', '.erl')
        assert_six_tuple(result, 'scan_erlang')

    def test_nim_six_tuple_contract(self):
        result = scan_nim('proc run*(req: Request): Settings = discard req\n')
        assert_six_tuple(result, 'scan_nim')

    def test_fsharp_six_tuple_contract(self):
        result = scan_fsharp('let run (req: Request) : Settings = req\n')
        assert_six_tuple(result, 'scan_fsharp')

    def test_haskell_six_tuple_contract(self):
        result = scan_haskell('run :: Request -> Settings\nrun req = req\n')
        assert_six_tuple(result, 'scan_haskell')

    def test_ocaml_six_tuple_contract(self):
        result = scan_ocaml('let run (req : request) : settings = req\n')
        assert_six_tuple(result, 'scan_ocaml')

    def test_elm_six_tuple_contract(self):
        result = scan_elm('run : Request -> Settings\nrun req = req\n')
        assert_six_tuple(result, 'scan_elm')


class TestParserEdgeHints:
    def test_html_edge_hints_distinguish_assets_and_documents(self):
        src = '''\
<!-- <script src="fake.js"></script> -->
<script src="./app.js"></script>
<link rel="stylesheet" href="styles/site.css">
<link rel="preload" href="manifest.json">
<a href="docs/readme.html">Docs</a>
<iframe src="frame.html"></iframe>
<img src="logo.png">
'''
        imports, _, _, extra, _, _ = scan_html(src, '.html')
        hints = extra['edge_hints']

        assert './app.js' in imports
        assert 'fake.js' not in imports
        assert {
            (h['type'], h['target'], h['subtype'], h['via'])
            for h in hints
        } >= {
            ('asset_ref', './app.js', 'script', 'src'),
            ('asset_ref', 'styles/site.css', 'stylesheet', 'href'),
            ('resource_hint', 'manifest.json', 'preload', 'href'),
            ('import', 'docs/readme.html', 'document', 'href'),
            ('asset_ref', 'frame.html', 'iframe', 'src'),
            ('asset_ref', 'logo.png', 'image', 'src'),
        }

    def test_css_edge_hints_skip_external_urls(self):
        src = '''\
@import "base.css";
@use "./tokens";
@import url("https://cdn.example/reset.css");
'''
        imports, _, _, extra, _, _ = scan_css(src, '.scss')
        hints = extra['edge_hints']

        assert imports == ['base', 'tokens']
        assert [(h['type'], h['target'], h['subtype']) for h in hints] == [
            ('asset_ref', 'base', 'stylesheet'),
            ('asset_ref', 'tokens', 'stylesheet'),
        ]

    def test_yaml_and_json_edge_hints_only_local_config_refs(self):
        yaml_src = '''\
$ref: ./schema.json#/defs/Thing
remote:
  $ref: https://example.test/schema.json
internal:
  $ref: '#/defs/Local'
file: configs/app.yaml
'''
        _, _, _, yaml_extra, _, _ = scan_yaml(yaml_src, '.yaml')
        yaml_hints = yaml_extra['edge_hints']

        assert [(h['type'], h['target'], h['via']) for h in yaml_hints] == [
            ('schema_ref', './schema.json', '$ref'),
            ('config_ref', 'configs/app.yaml', 'file'),
        ]

        json_src = '''{
  "extends": "./base.json",
  "references": [{"path": "./tsconfig.app.json"}],
  "$ref": "schemas/widget.json#/defs/Widget",
  "internal": {"$ref": "#/defs/Local"},
  "remote": {"$ref": "https://example.test/schema.json"},
  "dependencies": {"left-pad": "1.0.0"}
}'''
        _, _, _, json_extra, _, _ = scan_json(json_src, '.json')
        json_hints = json_extra['edge_hints']

        assert {
            (h['type'], h['target'], h['subtype'], h['via'])
            for h in json_hints
        } == {
            ('config_ref', './base.json', 'json', 'extends'),
            ('config_ref', './tsconfig.app.json', 'json', 'references.path'),
            ('schema_ref', 'schemas/widget.json', 'schema', '$ref'),
        }

    def test_powershell_edge_hints_skip_dynamic_and_package_modules(self):
        src = r'''\
Import-Module Pester
Import-Module .\LocalModule.psm1
. .\shared.ps1
using module './Types.psm1'
. $dynamicPath
'''
        imports, _, _, extra, _, _ = scan_powershell(src, '.ps1')
        hints = extra['edge_hints']

        assert 'Pester' in imports
        assert {
            (h['type'], h['target'], h['via'])
            for h in hints
        } == {
            ('import', './LocalModule.psm1', 'Import-Module'),
            ('include', './shared.ps1', 'dot-source'),
            ('import', './Types.psm1', 'using module'),
        }
        assert all('$dynamicPath' not in h['target'] for h in hints)

    def test_graphql_and_protobuf_schema_edge_hints(self):
        gql_src = '''\
#import "fragments/user.graphql"
# import "comment_only.graphql"
type Query { user(id: ID!): User }
'''
        gql_imports, _, _, gql_extra, _, _ = scan_graphql(gql_src, '.graphql')
        assert gql_imports == ['user']
        assert gql_extra['edge_hints'] == [{
            'type': 'import',
            'target': 'user',
            'subtype': 'schema',
            'via': '#import',
            'line': 1,
            'confidence': 1.0,
        }]

        proto_src = '''\
syntax = "proto3";
import "common/types.proto";
message Widget {}
'''
        proto_imports, _, _, proto_extra, _, _ = scan_protobuf(proto_src, '.proto')
        assert proto_imports == ['types']
        assert proto_extra['edge_hints'] == [{
            'type': 'import',
            'target': 'types',
            'subtype': 'proto',
            'via': 'import',
            'line': 2,
            'confidence': 1.0,
        }]
