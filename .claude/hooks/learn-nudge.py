#!/usr/bin/env python3
"""Stop hook: nudge to capture a lesson if this session hit tool errors.

Fires at most ONCE per session (sentinel file). Non-blocking: emits a
systemMessage reminder only — never blocks stopping, never loops.
"""
import json
import os
import sys
import tempfile


def _had_tool_error(transcript_path):
    """Return True if any tool_result in the transcript is an error."""
    if not transcript_path or not os.path.exists(transcript_path):
        return False
    try:
        with open(transcript_path, encoding='utf-8') as fh:
            for line in fh:
                line = line.strip()
                if not line or '"is_error"' not in line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                msg = obj.get('message', obj)
                content = msg.get('content') if isinstance(msg, dict) else None
                if not isinstance(content, list):
                    continue
                for item in content:
                    if isinstance(item, dict) and item.get('type') == 'tool_result' \
                            and item.get('is_error'):
                        return True
    except Exception:
        return False
    return False


def main():
    try:
        raw = sys.stdin.read()
        d = json.loads(raw) if raw.strip() else {}
    except Exception:
        return

    # Guard against any continuation loop.
    if d.get('stop_hook_active'):
        return

    sid = str(d.get('session_id', 'unknown'))[:16]
    sentinel = os.path.join(tempfile.gettempdir(), f'vizcode_learn_nudge_{sid}.flag')
    if os.path.exists(sentinel):
        return  # already nudged this session

    if not _had_tool_error(d.get('transcript_path', '')):
        return

    try:
        with open(sentinel, 'w', encoding='utf-8') as fh:
            fh.write('1')
    except Exception:
        pass

    print(json.dumps({
        'systemMessage': (
            '[learn] This session hit a tool error. If a mistake cost real time, was '
            'non-obvious, and could recur, capture it with the /learn skill. Otherwise ignore.'
        )
    }))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        pass
