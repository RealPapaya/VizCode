"""Tests for the smart-context retrieval layer: symbol index + centrality,
the one-shot vizcode_context tool, inline-code vizcode_trace, and adaptive budgets.

These build entirely on data already present in scan_cache.json — no parser or
analyze_viz changes — so the fixtures are hand-written per-file payloads.
"""

import json

from server.mcp_server import (
    _build_index,
    _build_stem_index,
    _build_symbol_index,
    _budget_for_filecount,
    _scan_cache_hash,
    _tool_affected,
    _tool_context,
    _tool_query,
    _tool_trace,
)
from ai.vizbridge import ToolRegistry


# ─── Fixtures ─────────────────────────────────────────────────────────────────
# app.py and svc.py both import util.py and call its shared_helper() -> util.py is
# a hub file and shared_helper is a hub symbol (in-degree 2).
ENTRIES = {
    "app.py": {
        "file_sha": "a",
        "payload": {
            "imports": ["util"],
            "funcdefs": [{"label": "main"}],
            "funccalls": ["shared_helper"],
            "func_calls_by_func": [["shared_helper"]],
            "symdefs": [{
                "kind": "function", "name": "main", "line": 3, "end_line": 5,
                "signature": "main()", "doc": "App entry point.", "is_public": True,
            }],
            "extras": {"docstrings": {"main": "App entry point."}},
        },
    },
    "svc.py": {
        "file_sha": "b",
        "payload": {
            "imports": ["util"],
            "funcdefs": [{"label": "serve"}],
            "funccalls": ["shared_helper"],
            "func_calls_by_func": [["shared_helper"]],
            "symdefs": [{
                "kind": "function", "name": "serve", "line": 2, "end_line": 4,
                "signature": "serve(req)", "doc": "Serve a request.", "is_public": True,
            }],
            "extras": {"docstrings": {"serve": "Serve a request."}},
        },
    },
    "util.py": {
        "file_sha": "c",
        "payload": {
            "imports": [],
            "funcdefs": [{"label": "shared_helper"}],
            "funccalls": [],
            "func_calls_by_func": [[]],
            "symdefs": [
                {"kind": "function", "name": "shared_helper", "line": 1, "end_line": 2,
                 "signature": "shared_helper(x)", "doc": "Shared helper used everywhere.",
                 "is_public": True},
                {"kind": "class", "name": "Tool", "line": 4, "end_line": 8,
                 "signature": "", "doc": "A tool.", "is_public": True},
            ],
            "extras": {"docstrings": {"shared_helper": "Shared helper used everywhere.",
                                      "Tool": "A tool."}},
        },
    },
}


def _index(entries):
    """Build (modules, edges, adj, mod_to_files, stem_to_key, symidx) from entries."""
    modules, edges, adj = _build_index({"entries": entries}, {})
    mf, sk = _build_stem_index(modules)
    sx = _build_symbol_index(modules, sk)
    return modules, edges, adj, mf, sk, sx


def _write_scan(root, entries):
    viz = root / ".vizcode"
    viz.mkdir()
    (viz / "semantic_cache.json").write_text("{}", encoding="utf-8")
    (viz / "scan_cache.json").write_text(json.dumps({"entries": entries}), encoding="utf-8")


def _big_entries():
    """A hub function called by 12 files — enough output to exercise budget clamps."""
    entries = {
        "hub.py": {
            "file_sha": "h",
            "payload": {
                "imports": [], "funcdefs": [{"label": "hub_fn"}], "funccalls": [],
                "func_calls_by_func": [[]],
                "symdefs": [{"kind": "function", "name": "hub_fn", "line": 1, "end_line": 2,
                             "signature": "hub_fn(a, b, c)",
                             "doc": "Central hub function with a longish docstring to add bytes.",
                             "is_public": True}],
                "extras": {"docstrings": {"hub_fn": "Central hub function."}},
            },
        },
    }
    for i in range(12):
        entries[f"caller_{i}.py"] = {
            "file_sha": str(i),
            "payload": {
                "imports": ["hub"], "funcdefs": [{"label": f"call_{i}"}],
                "funccalls": ["hub_fn"], "func_calls_by_func": [["hub_fn"]],
                "symdefs": [{"kind": "function", "name": f"call_{i}", "line": 1, "end_line": 3,
                             "signature": f"call_{i}(x)", "doc": f"Caller number {i}.",
                             "is_public": True}],
                "extras": {"docstrings": {f"call_{i}": f"Caller number {i}."}},
            },
        }
    return entries


# ─── Phase A: symbol index + centrality ───────────────────────────────────────

def test_build_symbol_index_resolves_cross_file_calls():
    _m, _e, _a, _mf, _sk, sx = _index(ENTRIES)

    # shared_helper is called from both app.main and svc.serve.
    assert sx["sym_indeg"][("util.py", "shared_helper")] == 2
    callers = {n for n in sx["callers"][("util.py", "shared_helper")]}
    assert ("app.py", "main") in callers
    assert ("svc.py", "serve") in callers
    assert sx["callees"][("app.py", "main")] == {("util.py", "shared_helper")}


def test_symbol_centrality_ranks_hub_highest():
    _m, _e, _a, _mf, _sk, sx = _index(ENTRIES)

    # util.py is imported twice -> top file; shared_helper is the top symbol.
    assert sx["file_score"]["util.py"] == 1.0
    assert sx["file_score"]["app.py"] == 0.0
    assert sx["sym_score"][("util.py", "shared_helper")] == 1.0


def test_symbol_index_adds_stable_aliases():
    _m, _e, _a, _mf, _sk, sx = _index(ENTRIES)

    site = next(s for s in sx["defs"]["shared_helper"] if s["file"] == "util.py")

    assert site["qualified_name"] == "shared_helper"
    assert site["stable_id"] == "util.py::shared_helper"


def test_resolved_file_adjacency_is_usable():
    _m, _e, _a, _mf, _sk, sx = _index(ENTRIES)
    # Resolved via stem_to_key, unlike _build_index's sparse raw adj.
    assert "util.py" in sx["file_adj"]["app.py"]
    assert "app.py" in sx["file_adj"]["util.py"]


def test_query_orders_by_centrality():
    modules, edges, _a, _mf, _sk, sx = _index(ENTRIES)
    out = _tool_query("util app", modules, edges, sx)
    # util.py (hub, file_score 1.0) should rank before app.py on a keyword-score tie.
    assert "util.py" in out and "app.py" in out
    assert out.index("util.py") < out.index("app.py")


# ─── Phase B: one-shot vizcode_context ────────────────────────────────────────

def test_context_resolves_seed_and_renders_compactly():
    modules, edges, adj, mf, sk, sx = _index(ENTRIES)
    out = _tool_context("explain the shared_helper function", modules, mf, sk, sx, edges, adj,
                        char_budget=4000)
    assert "util.py:1" in out                       # file:line
    assert "shared_helper(x)" in out                # signature
    assert "callers" in out                         # an edge line
    assert "def shared_helper" not in out           # never a raw body
    assert len(out) <= 4000                          # bounded


def test_context_falls_back_to_keywords_when_unresolved():
    modules, edges, adj, mf, sk, sx = _index(ENTRIES)
    out = _tool_context("zzz qqq nothing", modules, mf, sk, sx, edges, adj, char_budget=4000)
    assert "keyword fallback" in out.lower()


def test_context_inlines_trace_for_flow_question():
    modules, edges, adj, mf, sk, sx = _index(ENTRIES)
    out = _tool_context("how does app reach util", modules, mf, sk, sx, edges, adj,
                        char_budget=6000)
    assert "=== Trace:" in out
    assert "app.py" in out and "util.py" in out
    assert "linked via:" in out


def test_context_relation_filter_can_suppress_call_edges():
    modules, edges, adj, mf, sk, sx = _index(ENTRIES)
    out = _tool_context("explain shared_helper", modules, mf, sk, sx, edges, adj,
                        relation_filter=["import"], char_budget=4000)

    assert "Relation filter:" in out
    assert "callers" not in out


def test_context_reports_stale_semantic_cache_notice():
    scan = {"entries": ENTRIES}
    sem = {
        "scan_hash": "stale",
        "edges": [{"source": "app.py", "target": "util.py", "confidence": 0.9, "reason": "old"}],
    }
    modules, edges, adj = _build_index(scan, sem)
    mf, sk = _build_stem_index(modules)
    sx = _build_symbol_index(modules, sk)

    out = _tool_context("explain shared_helper", modules, mf, sk, sx, edges, adj,
                        char_budget=4000)

    assert "Semantic cache ignored" in out
    assert not [e for e in edges if e.get("kind") == "inferred"]


def test_current_semantic_cache_edges_are_loaded():
    scan = {"entries": ENTRIES}
    sem = {
        "scan_hash": _scan_cache_hash(scan),
        "edges": [{"source": "app.py", "target": "util.py", "confidence": 0.9, "reason": "current"}],
    }
    _modules, edges, _adj = _build_index(scan, sem)

    assert [e for e in edges if e.get("kind") == "inferred"]


# ─── Phase C: inline-code trace ───────────────────────────────────────────────

def test_trace_inlines_signatures_and_link_symbol():
    modules, _e, adj, _mf, sk, sx = _index(ENTRIES)
    out = _tool_trace("app.py", "util.py", modules, adj, sk, sx)
    assert "Trace: app.py -> util.py" in out
    assert "shared_helper(x)" in out                          # destination signature inlined
    assert "linked via: main() -> shared_helper()" in out     # the connecting call


def test_trace_reports_missing_path_honestly():
    # svc.py and app.py both import util but do not import each other -> no direct path,
    # but util bridges them, so app<->util<->svc IS connected. Use an isolated file instead.
    entries = dict(ENTRIES)
    entries["lonely.py"] = {"file_sha": "z", "payload": {
        "imports": [], "funcdefs": [], "funccalls": [], "func_calls_by_func": [],
        "symdefs": [{"kind": "function", "name": "lonely_fn", "line": 1, "end_line": 1}],
        "extras": {}}}
    modules, _e, adj, _mf, sk, sx = _index(entries)
    out = _tool_trace("lonely.py", "util.py", modules, adj, sk, sx)
    assert "No dependency path" in out


def test_affected_reports_reverse_callers_and_importers():
    modules, _e, _a, _mf, sk, sx = _index(ENTRIES)

    out_sym = _tool_affected("shared_helper", modules, sk, sx, depth=1)
    out_file = _tool_affected("util.py", modules, sk, sx, depth=1, relation_filter=["import"])

    assert "app.py::main" in out_sym
    assert "svc.py::serve" in out_sym
    assert "app.py" in out_file
    assert "svc.py" in out_file


# ─── Phase D: adaptive budgets + token ceiling ────────────────────────────────

def test_budget_scales_with_filecount():
    base = _budget_for_filecount(100)
    assert base["vizcode_l1"] == 5000            # small/medium repos: baseline unchanged
    assert base["vizcode_context"] == 6000
    assert _budget_for_filecount(2000)["vizcode_l1"] == int(5000 * 1.5)
    assert _budget_for_filecount(7000)["vizcode_l1"] == 5000 * 2


def test_token_ceiling_caps_context(tmp_path):
    _write_scan(tmp_path, _big_entries())

    full = ToolRegistry(str(tmp_path)).call("vizcode_context", {"question": "explain hub_fn"})

    tr = ToolRegistry(str(tmp_path))
    tr.set_token_ceiling(40)                      # 40 tokens * 3 chars = 120-char ceiling
    capped = tr.call("vizcode_context", {"question": "explain hub_fn"})

    assert len(capped) < len(full)
    assert "truncat" in capped.lower()


def test_context_tool_registered_and_dispatches(tmp_path):
    _write_scan(tmp_path, ENTRIES)
    tr = ToolRegistry(str(tmp_path))
    # New tools must be reachable through the in-process registry used by vizbridge.
    names = {d["name"] for d in tr.definitions()}
    assert "vizcode_context" in names
    assert "vizcode_trace" in names
    assert "shared_helper" in tr.call("vizcode_context", {"question": "explain shared_helper"})
