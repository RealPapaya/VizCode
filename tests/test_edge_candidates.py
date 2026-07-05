"""Tests for edge_candidates — the local, zero-token cross-file edge detector (P1)."""
import json

import edge_candidates as ec


def _write_project(root, files, entries):
    """Write source files under root and a matching .vizcode/scan_cache.json."""
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    viz = root / ".vizcode"
    viz.mkdir(exist_ok=True)
    (viz / "scan_cache.json").write_text(
        json.dumps({"entries": entries}), encoding="utf-8"
    )


def _entry(imports=None, symdefs=None):
    return {"payload": {"imports": imports or [], "symdefs": symdefs or [],
                        "funcdefs": [], "funccalls": [], "extras": {}},
            "file_sha": "x", "parser_sha": "y"}


def test_no_scan_cache_returns_empty(tmp_path):
    assert ec.find_candidates(tmp_path) == []


def test_subprocess_edge(tmp_path):
    _write_project(
        tmp_path,
        {
            "launcher.py": "import subprocess\nsubprocess.run(['python', 'worker.py'])\n",
            "worker.py": "def go():\n    return 1\n",
        },
        {
            "launcher.py": _entry(imports=["subprocess"]),
            "worker.py": _entry(),
        },
    )
    cands = ec.find_candidates(tmp_path)
    sub = [c for c in cands if c["signal"] == "subprocess"]
    assert any(c["source"] == "launcher.py" and c["target"] == "worker.py" for c in sub)


def test_interface_edge_when_base_in_other_file(tmp_path):
    _write_project(
        tmp_path,
        {
            "base.py": "class Provider:\n    pass\n",
            "impl.py": "class MyProvider(Provider):\n    pass\n",
        },
        {
            "base.py": _entry(symdefs=[{"kind": "class", "name": "Provider", "bases": []}]),
            # impl does NOT import base -> AST-invisible relationship
            "impl.py": _entry(symdefs=[{"kind": "class", "name": "MyProvider",
                                        "bases": ["Provider"]}]),
        },
    )
    cands = ec.find_candidates(tmp_path)
    iface = [c for c in cands if c["signal"] == "interface"]
    assert any(c["source"] == "impl.py" and c["target"] == "base.py" for c in iface)


def test_interface_edge_suppressed_when_already_imported(tmp_path):
    """If impl statically imports base, AST already has the edge — no candidate."""
    _write_project(
        tmp_path,
        {
            "base.py": "class Provider:\n    pass\n",
            "impl.py": "import base\nclass MyProvider(Provider):\n    pass\n",
        },
        {
            "base.py": _entry(symdefs=[{"kind": "class", "name": "Provider", "bases": []}]),
            "impl.py": _entry(imports=["base"],
                              symdefs=[{"kind": "class", "name": "MyProvider",
                                        "bases": ["Provider"]}]),
        },
    )
    cands = ec.find_candidates(tmp_path)
    assert not any(c["source"] == "impl.py" and c["target"] == "base.py"
                   for c in cands if c["signal"] == "interface")


def test_shared_file_coupling(tmp_path):
    _write_project(
        tmp_path,
        {
            "producer.py": "open('state_blob.json', 'w').write('{}')\n",
            "consumer.py": "data = json.load(open('state_blob.json'))\n",
        },
        {"producer.py": _entry(), "consumer.py": _entry()},
    )
    cands = ec.find_candidates(tmp_path)
    shared = [c for c in cands if c["signal"] == "shared_file"]
    assert any(c["source"] == "producer.py" and c["target"] == "consumer.py"
               for c in shared)


def test_output_schema_and_determinism(tmp_path):
    _write_project(
        tmp_path,
        {
            "base.py": "class P:\n    pass\n",
            "impl.py": "class C(P):\n    pass\n",
        },
        {
            "base.py": _entry(symdefs=[{"kind": "class", "name": "P", "bases": []}]),
            "impl.py": _entry(symdefs=[{"kind": "class", "name": "C", "bases": ["P"]}]),
        },
    )
    a = ec.find_candidates(tmp_path)
    b = ec.find_candidates(tmp_path)
    assert a == b  # deterministic
    for c in a:
        assert set(c) == {"source", "target", "signal", "evidence",
                          "suggested_confidence"}
        assert 0.0 <= c["suggested_confidence"] <= 1.0
