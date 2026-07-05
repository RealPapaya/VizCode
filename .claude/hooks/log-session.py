#!/usr/bin/env python3
"""Stop hook: log session end to memory/sessions.log."""
import json
import sys
import datetime
import os

try:
    raw = sys.stdin.read()
    d = json.loads(raw) if raw.strip() else {}
    mem_dir = os.path.join(os.path.expanduser('~'), '.claude', 'projects', 'D--Google-AI-VizCode', 'memory')
    os.makedirs(mem_dir, exist_ok=True)
    log_path = os.path.join(mem_dir, 'sessions.log')
    sid = str(d.get('session_id', '?'))[:8]
    ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(f"{ts} | sid={sid}\n")
except Exception:
    pass
