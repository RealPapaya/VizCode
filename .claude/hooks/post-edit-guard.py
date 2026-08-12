#!/usr/bin/env python3
"""PostToolUse hook: build-freshness / naming guard.

Referenced by .claude/settings.json since the hook block was written, but the
file itself was never committed — so every Write/Edit raised
"can't open file post-edit-guard.py" and the guard never ran.

Two checks, both advisory (never blocks the edit):
  1. `build/` is the bundle the browser actually loads. Editing `static/**/*.ts`
     without `npm run build` ships the old behaviour.
  2. `build/*.js` is generated output — hand-edits are overwritten by the next
     build and are lost silently.
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _newest_mtime(path: str) -> float:
    newest = 0.0
    for dirpath, _dirnames, filenames in os.walk(path):
        for name in filenames:
            if name.endswith('.js'):
                try:
                    newest = max(newest, os.path.getmtime(os.path.join(dirpath, name)))
                except OSError:
                    pass
    return newest


def main() -> None:
    data = json.load(sys.stdin)
    edited = (data.get('tool_input') or {}).get('file_path') or ''
    if not edited:
        return
    try:
        rel = os.path.relpath(os.path.abspath(edited), REPO).replace('\\', '/')
    except ValueError:
        return
    if rel.startswith('..'):
        return

    if rel.startswith('build/'):
        print(json.dumps({'systemMessage':
                          f'{rel} is generated output — edit the matching '
                          f'static/**/*.ts source and run `npm run build`.'}))
        return

    if rel.startswith('static/') and rel.endswith('.ts'):
        build_dir = os.path.join(REPO, 'build')
        if not os.path.isdir(build_dir):
            return
        try:
            src_mtime = os.path.getmtime(edited)
        except OSError:
            return
        if src_mtime > _newest_mtime(build_dir):
            print(json.dumps({'systemMessage':
                              f'build/ is now older than {rel} — run '
                              f'`npm run check && npm run build` before verifying '
                              f'in the app.'}))


try:
    main()
except Exception:
    pass
