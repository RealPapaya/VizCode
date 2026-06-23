"""Tests for the four-tier edge trust labels (P3 + DERIVED provenance tier).

EXTRACTED / DERIVED / INFERRED / AMBIGUOUS mapping in analytics_helpers, the
report surfacing, parity with the stdlib-only mirror in mcp_server, and the
origin field round-trip through semantic_enricher / MCP _build_index.
"""
import sys
from pathlib import Path

import analytics_helpers as ah
import semantic_enricher as se

# mcp_server lives under src/server, which conftest does not add to the path.
_SERVER_DIR = Path(__file__).parent.parent / "src" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))
import mcp_server as mcp  # noqa: E402


# ─── confidence_label mapping ─────────────────────────────────────────────────

def test_static_import_is_extracted():
    assert ah.confidence_label("import", 1.0) == "EXTRACTED"
    assert ah.confidence_label("import", None) == "EXTRACTED"
    assert ah.confidence_label("include", None) == "EXTRACTED"


def test_derived_tier():
    # Local deterministic + model-confirmed edges sit just below EXTRACTED.
    assert ah.confidence_label("derived", 0.8) == "DERIVED"
    assert ah.confidence_label("derived", 0.5) == "DERIVED"
    assert ah.confidence_label("derived", None) == "DERIVED"
    # but a derived edge with genuinely low confidence still warns.
    assert ah.confidence_label("derived", 0.3) == "AMBIGUOUS"


def test_inferred_high_confidence():
    assert ah.confidence_label("inferred", 0.9) == "INFERRED"
    assert ah.confidence_label("inferred", 0.5) == "INFERRED"


def test_inferred_low_confidence_is_ambiguous():
    assert ah.confidence_label("inferred", 0.4) == "AMBIGUOUS"
    assert ah.confidence_label("inferred", 0.0) == "AMBIGUOUS"
    assert ah.confidence_label("inferred", None) == "AMBIGUOUS"


def test_static_hint_with_reduced_confidence_degrades():
    # A parser hint that is an import-kind edge but only 0.7 confident is
    # trust-wise inferred, and below 0.5 it is ambiguous.
    assert ah.confidence_label("import", 0.7) == "INFERRED"
    assert ah.confidence_label("import", 0.3) == "AMBIGUOUS"


def test_unknown_confidence_string_is_safe():
    assert ah.confidence_label("import", "n/a") == "EXTRACTED"
    assert ah.confidence_label("inferred", "n/a") == "AMBIGUOUS"
    assert ah.confidence_label("derived", "n/a") == "DERIVED"


def test_trust_label_order():
    # Ordered most -> least trustworthy; consumers may rely on this.
    assert ah.TRUST_LABELS == ("EXTRACTED", "DERIVED", "INFERRED", "AMBIGUOUS")


# ─── mcp_server mirror parity ─────────────────────────────────────────────────

def test_mcp_mirror_matches_canonical():
    cases = [
        ("import", 1.0), ("import", None), ("import", 0.7), ("import", 0.3),
        ("derived", 0.8), ("derived", 0.5), ("derived", 0.3), ("derived", None),
        ("inferred", 0.9), ("inferred", 0.5), ("inferred", 0.4), ("inferred", 0.0),
        ("notice", 0.0), ("semantic", 0.6), ("call", None),
    ]
    for kind, conf in cases:
        assert mcp._confidence_label(kind, conf) == ah.confidence_label(kind, conf), \
            f"mismatch for {(kind, conf)}"


# ─── edge_trust_summary ───────────────────────────────────────────────────────

def test_edge_trust_summary_counts():
    data = {
        "file_edges_by_module": {
            "mod_a": [
                {"s": 1, "t": 2, "type": "import"},            # EXTRACTED
                {"s": 1, "t": 3, "type": "include"},           # EXTRACTED
                {"s": 2, "t": 4, "type": "inferred", "confidence": 0.8},  # INFERRED
                {"s": 2, "t": 5, "type": "inferred", "confidence": 0.2},  # AMBIGUOUS
                # an edge carrying provenance overrides the type-based guess
                {"s": 2, "t": 8, "type": "inferred", "origin": "derived",
                 "confidence": 0.8},                                       # DERIVED
            ],
            "mod_b": [
                {"s": 6, "t": 7, "type": "import", "confidence": 0.7},    # INFERRED
            ],
        }
    }
    counts = ah.edge_trust_summary(data)
    assert counts == {"EXTRACTED": 2, "DERIVED": 1, "INFERRED": 2, "AMBIGUOUS": 1}


def test_edge_trust_summary_empty():
    assert ah.edge_trust_summary({}) == {
        "EXTRACTED": 0, "DERIVED": 0, "INFERRED": 0, "AMBIGUOUS": 0}


# ─── mcp _build_index attaches label ──────────────────────────────────────────

def test_build_index_labels_static_edges():
    # Entry names are used directly as module names; the import target must
    # match an entry name for the static edge to resolve.
    scan = {"entries": {
        "a": {"payload": {"imports": ["b"], "funcdefs": [], "funccalls": [],
                          "func_calls_by_func": [], "symdefs": [], "extras": {}}},
        "b": {"payload": {"imports": [], "funcdefs": [], "funccalls": [],
                          "func_calls_by_func": [], "symdefs": [], "extras": {}}},
    }}
    _modules, edges, _adj = mcp._build_index(scan, {})
    import_edges = [e for e in edges if e["kind"] == "import"]
    assert import_edges, "expected at least one static import edge"
    assert all(e["label"] == "EXTRACTED" for e in import_edges)


def test_build_index_splits_derived_from_inferred(monkeypatch):
    # Force the semantic cache to be considered current.
    monkeypatch.setattr(mcp, "_semantic_cache_is_current", lambda s, sem: True)
    scan = {"entries": {
        "a": {"payload": {"imports": [], "funcdefs": [], "funccalls": [],
                          "func_calls_by_func": [], "symdefs": [], "extras": {}}},
        "b": {"payload": {"imports": [], "funcdefs": [], "funccalls": [],
                          "func_calls_by_func": [], "symdefs": [], "extras": {}}},
    }}
    sem = {"edges": [
        {"source": "a", "target": "b", "confidence": 0.8, "origin": "derived",
         "reason": "a spawns b"},
        {"source": "a", "target": "b", "confidence": 0.8, "origin": "inferred",
         "reason": "pure guess"},
        {"source": "a", "target": "b", "confidence": 0.6, "reason": "no origin -> inferred"},
    ]}
    _modules, edges, _adj = mcp._build_index(scan, sem)
    sem_edges = [e for e in edges if e["kind"] == "inferred"]
    labels = [e["label"] for e in sem_edges]
    assert labels == ["DERIVED", "INFERRED", "INFERRED"]
    # kind stays "inferred" so existing kind-based filters keep these edges.
    assert all(e["kind"] == "inferred" for e in sem_edges)


# ─── semantic_enricher origin round-trip ──────────────────────────────────────

def test_write_cache_preserves_origin(tmp_path):
    edges = [
        {"source": "a.py", "target": "b.py", "confidence": 0.8,
         "reason": "spawn", "origin": "derived"},
        {"source": "a.py", "target": "c.py", "confidence": 0.6,
         "reason": "guess"},  # no origin -> defaults to inferred
        {"source": "a.py", "target": "d.py", "confidence": 0.7,
         "reason": "x", "origin": "DERIVED"},  # case-insensitive
    ]
    se.write_cache(tmp_path, edges)
    out = se.read_cache(tmp_path)
    by_target = {e["target"]: e for e in out}
    assert by_target["b.py"]["origin"] == "derived"
    assert by_target["c.py"]["origin"] == "inferred"
    assert by_target["d.py"]["origin"] == "derived"
