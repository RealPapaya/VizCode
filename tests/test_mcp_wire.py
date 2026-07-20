"""Wire-protocol tests for mcp_server.py stdio framing.

The MCP spec's stdio transport is newline-delimited JSON; older LSP-style
clients use Content-Length framing. The server must answer both, replying in
whichever framing the client used.
"""
import json
import subprocess
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent / "src" / "server" / "mcp_server.py"

INIT = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "wire-test", "version": "0"},
    },
}


def _run_server(stdin_bytes, tmp_path):
    proc = subprocess.run(
        [sys.executable, str(SERVER),
         "--scan", str(tmp_path / "missing_scan.json"),
         "--sem", str(tmp_path / "missing_sem.json")],
        input=stdin_bytes, capture_output=True, timeout=30,
    )
    return proc.stdout


def test_ndjson_framing_roundtrip(tmp_path):
    out = _run_server(json.dumps(INIT).encode() + b"\n", tmp_path)
    # Reply must be newline-delimited JSON, not Content-Length framed.
    assert not out.startswith(b"Content-Length:")
    reply = json.loads(out.splitlines()[0].decode("utf-8"))
    assert reply["id"] == 1
    assert reply["result"]["serverInfo"]["name"] == "vizcode"


def test_content_length_framing_roundtrip(tmp_path):
    body = json.dumps(INIT).encode()
    framed = b"Content-Length: %d\r\n\r\n%s" % (len(body), body)
    out = _run_server(framed, tmp_path)
    assert out.startswith(b"Content-Length:")
    reply_body = out.split(b"\r\n\r\n", 1)[1]
    reply = json.loads(reply_body.decode("utf-8"))
    assert reply["id"] == 1
    assert reply["result"]["serverInfo"]["name"] == "vizcode"
