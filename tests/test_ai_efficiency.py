import json

from ai.chat_modes import resolve, resolve_spec
from ai.vizbridge import ToolRegistry, trim_history
import qa_cache


def _write_scan(root, entries):
    viz = root / ".vizcode"
    viz.mkdir()
    (viz / "semantic_cache.json").write_text("{}", encoding="utf-8")
    (viz / "scan_cache.json").write_text(
        json.dumps({"entries": entries}),
        encoding="utf-8",
    )


def test_tool_registry_supports_l3_and_report_path(tmp_path):
    _write_scan(tmp_path, {
        "foo.py": {
            "payload": {
                "imports": [],
                "funcdefs": [{"label": "main"}],
                "func_calls_by_func": [[]],
                "symdefs": [{"kind": "function", "name": "main", "line": 1, "end_line": 2}],
                "extras": {},
            },
            "file_sha": "abc",
        },
    })
    (tmp_path / ".vizcode" / "vizcode_report.md").write_text("Project report", encoding="utf-8")

    tools = ToolRegistry(str(tmp_path))

    assert "=== foo.py (L3) ===" in tools.call("vizcode_l3", {"file": "foo.py"})
    assert tools.call("vizcode_report", {}) == "Project report"


def test_tool_registry_caps_large_tool_results(tmp_path):
    entries = {
        f"big/file_{i}.py": {
            "payload": {
                "imports": [],
                "funcdefs": [{"label": f"fn_{i}"}],
                "func_calls_by_func": [[]],
                "symdefs": [],
                "extras": {},
            },
            "file_sha": str(i),
        }
        for i in range(250)
    }
    _write_scan(tmp_path, entries)

    result = ToolRegistry(str(tmp_path)).call("vizcode_l1", {"module": "big"})

    assert len(result) < 5400
    assert "truncated vizcode_l1" in result


def test_mode_specs_keep_resolve_backward_compatible():
    whitelist, addendum = resolve("quick", None)
    spec = resolve_spec("quick", None)

    assert whitelist == spec["tool_whitelist"]
    assert addendum == spec["system_addendum"]
    assert spec["max_tokens"] == 768
    assert spec["max_tool_rounds"] == 2
    assert "vizcode_l0" not in spec["tool_whitelist"]

    remediation = resolve_spec("general", "remediation_prompt")
    assert remediation["cacheable"] is True
    assert "vizcode_ui_goto_l1" not in remediation["tool_whitelist"]
    assert "vizcode_l3" in remediation["tool_whitelist"]


def test_trim_history_preserves_latest_and_caps_size():
    messages = [{"role": "user", "content": f"turn {i} " + ("x" * 1000)} for i in range(20)]

    trimmed = trim_history(messages, max_messages=5, max_chars=3500)

    assert trimmed[-1] == messages[-1]
    assert len(trimmed) <= 5
    assert sum(len(m["content"]) for m in trimmed) <= 4000


def test_qa_cache_uses_output_and_context_hash(tmp_path):
    scan_cache = {
        "entries": {
            "foo.py": {
                "file_sha": "abc",
                "payload": {},
            },
        },
    }
    question = "Explain foo.py"

    qa_cache.save(
        question,
        "answer",
        [{"name": "vizcode_l2", "input": {"file": "foo.py"}}],
        tmp_path,
        scan_cache,
        depth="general",
        output="remediation_prompt",
        context_hash="ctx-a",
    )

    assert qa_cache.lookup(
        question, tmp_path, scan_cache,
        depth="general", output="remediation_prompt", context_hash="ctx-a",
    )
    assert qa_cache.lookup(
        question, tmp_path, scan_cache,
        depth="general", output="", context_hash="ctx-a",
    ) is None
    assert qa_cache.lookup(
        question, tmp_path, scan_cache,
        depth="general", output="remediation_prompt", context_hash="ctx-b",
    ) is None
