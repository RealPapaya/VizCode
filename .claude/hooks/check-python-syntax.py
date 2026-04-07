#!/usr/bin/env python3
"""PostToolUse hook: check Python syntax after Write/Edit."""
import json
import sys
import subprocess

try:
    d = json.load(sys.stdin)
    f = d.get('tool_input', {}).get('file_path', '') or ''
    if f.endswith('.py'):
        r = subprocess.run(
            ['python', '-m', 'py_compile', f],
            capture_output=True, text=True
        )
        if r.returncode != 0:
            msg = r.stderr.strip()
            print(json.dumps({'systemMessage': f'Python syntax error: {msg}'}))
except Exception:
    pass
