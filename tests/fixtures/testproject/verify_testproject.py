import sys
import os
import json

# 加入 src 目錄（相對於本檔位置解析，搬動 repo 或改路徑都不會壞）
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.abspath(os.path.join(_HERE, '..', '..', '..'))
sys.path.append(os.path.join(_REPO, 'src'))
from core.analyze_viz import build_graph

root_dir = _HERE
res = build_graph(root_dir)

# 取得 file ID 到 file path 的對照表
id_to_path = {}
for mod_name, files in res.get("files_by_module", {}).items():
    for f in files:
        id_to_path[f.get("id")] = f.get("path")

# 取得所有的 L1 邊
l1_edges = []
for mod_name, edges in res.get("file_edges_by_module", {}).items():
    for e in edges:
        s_path = id_to_path.get(e['s'])
        t_path = id_to_path.get(e['t'])
        l1_edges.append((s_path, t_path, e.get('type')))

l1_set = set(l1_edges)

# L1 邊斷言驗證
expected_l1 = {
    ("ruby/ruby_app.rb", "ruby/ruby_lib.rb", "import"),
    ("ruby/ruby_lib.rb", "ruby/ruby_config.json", "config_ref"),
    ("crystal/crystal_app.cr", "crystal/crystal_lib.cr", "import"),
    ("crystal/crystal_lib.cr", "crystal/crystal_data.json", "config_ref"),
    ("julia/julia_app.jl", "julia/julia_lib.jl", "import"),
    ("julia/julia_lib.jl", "julia/julia_config.toml", "config_ref"),
    ("elixir/elixir_app.ex", "elixir/ElixirLib.ex", "import"),
    ("elixir/ElixirLib.ex", "elixir/elixir_config.yaml", "config_ref"),
}

print("Running L1 edge assertions for testproject/...")
for exp in expected_l1:
    assert exp in l1_set, f"Missing L1 edge: {exp[0]} -> {exp[1]} ({exp[2]})"
print("L1 Assertions: PASSED!")

# L3 邊斷言驗證
symbol_index = res.get("symbol_index", {})
symbol_edges = res.get("symbol_edges", [])

l3_edges_formatted = []
for e in symbol_edges:
    f_sym = symbol_index.get(e['from'])
    t_sym = symbol_index.get(e['to'])
    if f_sym and t_sym:
        l3_edges_formatted.append((
            f_sym['file'], f_sym['name'],
            t_sym['file'], t_sym['name'],
            e['type']
        ))

l3_set = set(l3_edges_formatted)

expected_l3 = {
    ("ruby/ruby_app.rb", "run", "ruby/ruby_lib.rb", "ruby_process", "call"),
    ("elixir/elixir_app.ex", "run", "elixir/ElixirLib.ex", "elixir_process", "call"),
    ("julia/julia_app.jl", "execute", "julia/julia_lib.jl", "helper_function", "call"),
}

print("\nRunning L3 edge assertions for testproject/...")
for exp in expected_l3:
    assert exp in l3_set, f"Missing L3 edge: {exp[0]}:{exp[1]} -> {exp[2]}:{exp[3]} ({exp[4]})"
print("L3 Assertions: PASSED!")

print("\nAll integration test assertions passed successfully inside testproject!")
