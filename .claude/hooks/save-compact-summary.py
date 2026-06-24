#!/usr/bin/env python3
"""PostCompact hook: save compaction summary to memory directory."""
import json
import sys
import datetime
import os

try:
    raw = sys.stdin.read()
    d = json.loads(raw) if raw.strip() else {}
    summary = d.get('summary', '')
    if not summary:
        sys.exit(0)

    mem_dir = os.path.join(
        os.path.expanduser('~'), '.claude', 'projects', 'D--Google-AI-VizCode', 'memory'
    )
    os.makedirs(mem_dir, exist_ok=True)

    ts = datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    sid = str(d.get('session_id', 'unknown'))[:8]
    fname = os.path.join(mem_dir, f'compact_{ts}_{sid}.md')

    with open(fname, 'w', encoding='utf-8') as f:
        f.write(f"# Session Compact Summary\n")
        f.write(f"- **Time**: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"- **Session**: {d.get('session_id', '?')}\n\n")
        f.write(summary)

    # Also append to rolling index
    index_path = os.path.join(mem_dir, 'MEMORY.md')
    entry = f"- [compact_{ts}](compact_{ts}_{sid}.md) — {datetime.datetime.now().strftime('%Y-%m-%d')} session compact\n"
    with open(index_path, 'a', encoding='utf-8') as f:
        f.write(entry)

except Exception:
    pass
