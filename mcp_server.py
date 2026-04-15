#!/usr/bin/env python3
"""
mcp_server.py — VizCode MCP stdio server

Implements the Model Context Protocol (MCP) over stdio (JSON-RPC 2.0,
Content-Length framing, same as LSP).

Usage:
    python mcp_server.py --scan .local/scan_cache.json \
                         --sem  .local/semantic_cache.json

Tools exposed:
    vizcode_query(question)       — keyword-match modules + semantic edges
    vizcode_path(source, target)  — shortest dependency path (BFS)
    vizcode_explain(symbol)       — module role + direct connections
    vizcode_report()              — full Markdown codebase report (token-saving overview)
"""

import argparse
import json
import sys
from collections import deque
from pathlib import Path

# ─── Wire protocol ───────────────────────────────────────────────────────────

def _read_message(stream) -> dict | None:
    """Read one Content-Length-framed JSON-RPC message from stream."""
    headers = {}
    while True:
        line = stream.readline()
        if not line:
            return None
        line = line.rstrip(b"\r\n")
        if not line:
            break
        if b":" in line:
            k, _, v = line.partition(b":")
            headers[k.strip().lower().decode()] = v.strip().decode()

    length = int(headers.get("content-length", 0))
    if length == 0:
        return None
    body = stream.read(length)
    return json.loads(body.decode("utf-8"))


def _send_message(stream, obj: dict) -> None:
    """Write one Content-Length-framed JSON-RPC message to stream."""
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    header = f"Content-Length: {len(body)}\r\n\r\n".encode()
    stream.write(header + body)
    stream.flush()


def _ok(req_id, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _err(req_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


# ─── Data loading ─────────────────────────────────────────────────────────────

def _load_json(path: str) -> dict:
    p = Path(path)
    if p.is_file():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


# ─── Index building ───────────────────────────────────────────────────────────

def _build_index(scan: dict, sem: dict):
    """
    Returns:
        modules  — dict[name -> payload dict]  (from scan_cache entries)
        edges    — list[{source, target, kind, confidence, reason}]
        adj      — dict[name -> list[name]]  (adjacency for BFS, both directions)
    """
    modules = {}
    entries = scan.get("entries", {})
    for name, entry in entries.items():
        payload = entry.get("payload", {})
        modules[name] = {
            "imports":  payload.get("imports", []),
            "funcdefs": payload.get("funcdefs", []),
            "funccalls": payload.get("funccalls", []),
            "extras":   entry.get("extras", {}),
        }

    edges = []
    # Static import edges from scan_cache
    for src_name, m in modules.items():
        for imp in m["imports"]:
            tgt = imp if isinstance(imp, str) else imp.get("target", "")
            if tgt and tgt in modules:
                edges.append({"source": src_name, "target": tgt,
                               "kind": "import", "confidence": 1.0, "reason": ""})

    # Inferred edges from semantic_cache
    for e in sem.get("edges", []):
        edges.append({
            "source":     e.get("source", ""),
            "target":     e.get("target", ""),
            "kind":       "inferred",
            "confidence": e.get("confidence", 0.0),
            "reason":     e.get("reason", ""),
        })

    # Adjacency list (undirected for BFS path finding)
    adj: dict[str, list[str]] = {n: [] for n in modules}
    for e in edges:
        s, t = e["source"], e["target"]
        if s in adj and t in modules:
            if t not in adj[s]:
                adj[s].append(t)
        if t in adj and s in modules:
            if s not in adj.get(t, []):
                adj.setdefault(t, []).append(s)

    return modules, edges, adj


# ─── Tool implementations ─────────────────────────────────────────────────────

def _tool_query(question: str, modules: dict, edges: list) -> str:
    """Return modules and semantic edges matching keywords in the question."""
    keywords = [w.lower() for w in question.split() if len(w) > 2]
    if not keywords:
        return "Please provide a question with at least one keyword."

    def _score(text: str) -> int:
        t = text.lower()
        return sum(1 for k in keywords if k in t)

    # Score each module name
    hits: list[tuple[int, str]] = []
    for name in modules:
        s = _score(name)
        if s:
            hits.append((s, name))
    hits.sort(reverse=True)
    top_modules = {name for _, name in hits[:8]}

    # Score semantic edges by reason + module names
    sem_hits = []
    for e in edges:
        if e["kind"] != "inferred":
            continue
        s = _score(e["source"]) + _score(e["target"]) + _score(e["reason"])
        if s:
            sem_hits.append((s, e))
    sem_hits.sort(reverse=True, key=lambda x: x[0])

    lines = []
    if top_modules:
        lines.append("Matching modules:")
        for _, name in hits[:8]:
            lines.append(f"  {name}")

    if sem_hits:
        lines.append("\nSemantic relationships:")
        for _, e in sem_hits[:10]:
            conf = f"({e['confidence']:.2f})" if e["confidence"] else ""
            lines.append(f"  {e['source']} → {e['target']} {conf}")
            if e["reason"]:
                lines.append(f"    reason: {e['reason']}")

    if not lines:
        return f"No modules or relationships found matching: {question}"
    return "\n".join(lines)


def _tool_path(source: str, target: str, modules: dict, adj: dict) -> str:
    """BFS shortest path from source to target module."""
    if source not in modules:
        return f"Module not found: {source}"
    if target not in modules:
        return f"Module not found: {target}"
    if source == target:
        return json.dumps([source])

    visited = {source}
    queue: deque[list[str]] = deque([[source]])
    while queue:
        path = queue.popleft()
        node = path[-1]
        for nb in adj.get(node, []):
            if nb == target:
                result = path + [nb]
                return json.dumps(result)
            if nb not in visited:
                visited.add(nb)
                queue.append(path + [nb])

    return f"No dependency path found between {source} and {target}"


def _tool_explain(symbol: str, modules: dict, edges: list) -> str:
    """Explain a module: role summary + direct connections."""
    if symbol not in modules:
        # fuzzy match
        candidates = [n for n in modules if symbol.lower() in n.lower()]
        if not candidates:
            return f"Module not found: {symbol}"
        symbol = candidates[0]

    m = modules[symbol]
    funcdefs = m.get("funcdefs", [])
    imports = m.get("imports", [])

    # Collect semantic reason for this module (as source or target)
    sem_roles = []
    for e in edges:
        if e["kind"] != "inferred":
            continue
        if e["source"] == symbol or e["target"] == symbol:
            sem_roles.append(e)

    # Direct static neighbours
    direct_out = [e["target"] for e in edges if e["source"] == symbol and e["target"] in modules]
    direct_in  = [e["source"] for e in edges if e["target"] == symbol and e["source"] in modules]

    lines = [f"=== {symbol} ==="]

    # Semantic role from inferred edges
    if sem_roles:
        lines.append("\nSemantic role:")
        shown = set()
        for e in sem_roles[:4]:
            key = (e["source"], e["target"])
            if key not in shown and e["reason"]:
                lines.append(f"  {e['reason']}")
                shown.add(key)

    # Function definitions (up to 10)
    if funcdefs:
        func_names = []
        for f in funcdefs[:10]:
            if isinstance(f, dict):
                func_names.append(f.get("label", str(f)))
            else:
                func_names.append(str(f))
        lines.append(f"\nFunctions ({len(funcdefs)} total): {', '.join(func_names)}")

    # Direct connections
    if direct_out:
        lines.append(f"\nImports/calls: {', '.join(direct_out[:10])}")
    if direct_in:
        lines.append(f"Used by: {', '.join(direct_in[:10])}")

    return "\n".join(lines)


# ─── Tool registry ────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "vizcode_query",
        "description": (
            "Search for modules and semantic relationships matching a question. "
            "Returns a summary of relevant modules and inferred edges with reasons."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "Natural-language question about the codebase"}
            },
            "required": ["question"],
        },
    },
    {
        "name": "vizcode_path",
        "description": (
            "Find the shortest dependency path between two modules. "
            "Returns a JSON array of module names, e.g. [\"server.py\", \"analyze_viz.py\", \"python_parser.py\"]."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "Starting module filename"},
                "target": {"type": "string", "description": "Target module filename"},
            },
            "required": ["source", "target"],
        },
    },
    {
        "name": "vizcode_explain",
        "description": (
            "Explain what a module does: its semantic role, exported functions, "
            "and direct connections. Does not return raw source code."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "Module filename to explain"}
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "vizcode_report",
        "description": (
            "Return the full codebase Markdown report: scan overview, module dependency tree, "
            "hotspot nodes, surprising connections, health metrics. "
            "Call this first before deeper analysis to orient yourself and save context tokens."
        ),
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
]


# ─── C4: Report tool ─────────────────────────────────────────────────────────

def _tool_report(report_path: str) -> str:
    """Return the contents of vizcode_report.md, or a hint if it is missing."""
    p = Path(report_path)
    if p.is_file():
        return p.read_text(encoding='utf-8')
    return (
        "vizcode_report.md not found.\n"
        "Run `/vizcode --parse` (or `python vizcode.py <path> --scan-only`) "
        "to generate the report first."
    )


# ─── Server loop ──────────────────────────────────────────────────────────────

def _serve(scan_path: str, sem_path: str, report_path: str) -> None:
    scan = _load_json(scan_path)
    sem  = _load_json(sem_path)
    modules, edges, adj = _build_index(scan, sem)

    stdin  = sys.stdin.buffer
    stdout = sys.stdout.buffer
    initialized = False

    while True:
        msg = _read_message(stdin)
        if msg is None:
            break

        method = msg.get("method", "")
        req_id = msg.get("id")
        params = msg.get("params", {})

        # ── initialize ───────────────────────────────────────────────────────
        if method == "initialize":
            initialized = True
            _send_message(stdout, _ok(req_id, {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "vizcode", "version": "0.3"},
            }))

        # ── notifications/initialized ─────────────────────────────────────
        elif method == "notifications/initialized":
            pass  # no response needed for notifications

        # ── tools/list ────────────────────────────────────────────────────
        elif method == "tools/list":
            _send_message(stdout, _ok(req_id, {"tools": TOOLS}))

        # ── tools/call ────────────────────────────────────────────────────
        elif method == "tools/call":
            name = params.get("name", "")
            args = params.get("arguments", {})

            if name == "vizcode_query":
                text = _tool_query(args.get("question", ""), modules, edges)
            elif name == "vizcode_path":
                text = _tool_path(args.get("source", ""), args.get("target", ""), modules, adj)
            elif name == "vizcode_explain":
                text = _tool_explain(args.get("symbol", ""), modules, edges)
            elif name == "vizcode_report":
                text = _tool_report(report_path)
            else:
                _send_message(stdout, _err(req_id, -32601, f"Unknown tool: {name}"))
                continue

            _send_message(stdout, _ok(req_id, {
                "content": [{"type": "text", "text": text}]
            }))

        # ── unknown method ────────────────────────────────────────────────
        elif req_id is not None:
            _send_message(stdout, _err(req_id, -32601, f"Method not found: {method}"))


# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(prog="mcp_server", description="VizCode MCP stdio server")
    parser.add_argument("--scan", default=".local/scan_cache.json",
                        help="Path to scan_cache.json")
    parser.add_argument("--sem", default=".local/semantic_cache.json",
                        help="Path to semantic_cache.json")
    parser.add_argument("--report", default="",
                        help="Path to vizcode_report.md (default: derived from --scan)")
    args = parser.parse_args()
    report_path = args.report or args.scan.replace("scan_cache.json", "vizcode_report.md")
    _serve(args.scan, args.sem, report_path)


if __name__ == "__main__":
    main()
