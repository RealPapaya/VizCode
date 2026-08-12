"""The MCP server must serve the current scan, not the one it booted with.

_serve() used to read scan_cache.json once and hold the derived indexes for the
process lifetime. Since the MCP client (an editor, Claude Code) keeps the server
alive across many scans, every rescan left the tools answering from stale data —
including files that had since been deleted — until the client was restarted.
"""
import json
import subprocess
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent / "src" / "server" / "mcp_server.py"

INIT = {
    "jsonrpc": "2.0", "id": 1, "method": "initialize",
    "params": {"protocolVersion": "2024-11-05", "capabilities": {},
               "clientInfo": {"name": "reload-test", "version": "0"}},
}


def _scan_with(*file_names) -> dict:
    return {
        "schema_rev": 1,
        "built_at": "",
        "entries": {
            name: {"file_sha": "s", "parser_sha": "p", "payload": {
                "imports": [], "funcdefs": [], "funccalls": [],
                "func_calls_by_func": [], "symdefs": [], "extras": {},
            }}
            for name in file_names
        },
    }


def _call(proc, req_id, tool):
    msg = {"jsonrpc": "2.0", "id": req_id, "method": "tools/call",
           "params": {"name": tool, "arguments": {}}}
    proc.stdin.write((json.dumps(msg) + "\n").encode())
    proc.stdin.flush()
    return json.loads(proc.stdout.readline().decode("utf-8"))


def _text(reply) -> str:
    return "".join(c.get("text", "") for c in reply["result"]["content"])


def test_tool_calls_pick_up_a_rescan(tmp_path):
    scan_path = tmp_path / "scan_cache.json"
    sem_path = tmp_path / "semantic_cache.json"
    scan_path.write_text(json.dumps(_scan_with("alpha/old_file.py")), encoding="utf-8")

    proc = subprocess.Popen(
        [sys.executable, str(SERVER), "--scan", str(scan_path), "--sem", str(sem_path)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        proc.stdin.write((json.dumps(INIT) + "\n").encode())
        proc.stdin.flush()
        proc.stdout.readline()  # initialize reply

        before = _text(_call(proc, 2, "vizcode_l0"))
        assert "old_file.py" in before

        # A rescan rewrites the cache: one file gone, one added.
        scan_path.write_text(json.dumps(_scan_with("alpha/new_file.py")), encoding="utf-8")

        after = _text(_call(proc, 3, "vizcode_l0"))
        assert "new_file.py" in after
        assert "old_file.py" not in after
    finally:
        proc.stdin.close()
        proc.wait(timeout=30)
