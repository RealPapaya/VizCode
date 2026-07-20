#!/usr/bin/env python3
"""
ai/install.py — Deploy VizCode AI configs to platform-specific directories.

Usage:
  python ai/install.py --cursor      # Cursor AI
  python ai/install.py --windsurf    # Windsurf
  python ai/install.py --gemini      # Gemini CLI
  python ai/install.py --copilot     # GitHub Copilot (no MCP)
  python ai/install.py --all         # all platforms
  python ai/install.py --list        # show install status
  python ai/install.py --force       # overwrite without prompting (combine with above)
"""

import argparse
import json
import os
import shutil
import sys

# ─── Platform Definitions ────────────────────────────────────────────────────

# Each platform entry:
#   header    : path (relative to ai/) of the frontmatter template file
#   skill_dest: destination path (relative to project root) for the combined skill file
#   mcp_dest  : destination path for mcp.json; None = no MCP support
#   include_body: whether to append skill_body.md after the header
PLATFORMS = {
    'cursor': {
        'label':        'Cursor AI',
        'header':       'templates/cursor.mdc.header',
        'skill_dest':   '.cursor/rules/vizcode.mdc',
        'mcp_dest':     '.cursor/mcp.json',
        'include_body': True,
    },
    'windsurf': {
        'label':        'Windsurf',
        'header':       'templates/windsurf.md.header',
        'skill_dest':   '.windsurf/rules/vizcode.md',
        'mcp_dest':     '.windsurf/mcp.json',
        'include_body': True,
    },
    'gemini': {
        'label':        'Gemini CLI',
        'header':       'templates/gemini.md.header',
        'skill_dest':   'GEMINI.md',
        'mcp_dest':     '.gemini/settings.json',
        'include_body': True,
    },
    'copilot': {
        'label':        'GitHub Copilot',
        'header':       'templates/copilot.md.header',
        'skill_dest':   '.github/copilot-instructions.md',
        'mcp_dest':     None,
        'include_body': False,  # header already contains static report navigation
    },
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _ai_dir() -> str:
    """Absolute path to the ai/ directory (where this script lives)."""
    return os.path.dirname(os.path.abspath(__file__))


def _root_dir() -> str:
    """Project root = parent of ai/."""
    return os.path.dirname(_ai_dir())


def _read(rel_to_ai: str) -> str:
    path = os.path.join(_ai_dir(), rel_to_ai)
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def _write(abs_path: str, content: str, force: bool) -> bool:
    """Write content to abs_path. Returns True if written, False if skipped."""
    if os.path.exists(abs_path) and not force:
        ans = input(f"  Overwrite existing {os.path.relpath(abs_path, _root_dir())}? [y/N] ").strip().lower()
        if ans != 'y':
            print(f"  Skipped.")
            return False
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, 'w', encoding='utf-8') as fh:
        fh.write(content)
    return True


def _copy(src_abs: str, dst_abs: str, force: bool) -> bool:
    if os.path.exists(dst_abs) and not force:
        ans = input(f"  Overwrite existing {os.path.relpath(dst_abs, _root_dir())}? [y/N] ").strip().lower()
        if ans != 'y':
            print(f"  Skipped.")
            return False
    os.makedirs(os.path.dirname(dst_abs), exist_ok=True)
    shutil.copy2(src_abs, dst_abs)
    return True


def _check_exists(platform: str) -> dict:
    """Return dict with 'skill' and 'mcp' booleans for installed status."""
    cfg = PLATFORMS[platform]
    root = _root_dir()
    return {
        'skill': os.path.exists(os.path.join(root, cfg['skill_dest'])),
        'mcp':   cfg['mcp_dest'] is not None and os.path.exists(os.path.join(root, cfg['mcp_dest'])),
    }

# ─── Actions ──────────────────────────────────────────────────────────────────

def install_platform(name: str, force: bool) -> None:
    cfg = PLATFORMS[name]
    root = _root_dir()
    ai = _ai_dir()
    label = cfg['label']
    print(f"\n[{label}]")

    # 1. Build skill file content: header + (optionally) body
    header = _read(cfg['header'])
    if cfg['include_body']:
        body = _read('skill_body.md')
        content = header + body
    else:
        content = header

    skill_path = os.path.join(root, cfg['skill_dest'])
    written = _write(skill_path, content, force)
    if written:
        print(f"  + {cfg['skill_dest']}")

    # 2. MCP config (render mcp_template.json with this checkout's root path)
    if cfg['mcp_dest']:
        mcp_content = _read('mcp_template.json').replace(
            '{VIZCODE_ROOT}', root.replace('\\', '/'))
        json.loads(mcp_content)  # self-check: never write unparseable MCP config
        dst = os.path.join(root, cfg['mcp_dest'])
        copied = _write(dst, mcp_content, force)
        if copied:
            print(f"  + {cfg['mcp_dest']}")


def list_platforms() -> None:
    print("\nVizCode AI Platform Install Status")
    print("=" * 52)
    print(f"  {'Platform':<18} {'Skill':<28} {'MCP'}")
    print(f"  {'-'*18} {'-'*28} {'-'*5}")
    for name, cfg in PLATFORMS.items():
        st = _check_exists(name)
        skill_mark = 'installed' if st['skill'] else 'not installed'
        if cfg['mcp_dest']:
            mcp_mark = 'installed' if st['mcp'] else 'not installed'
        else:
            mcp_mark = 'N/A'
        print(f"  {cfg['label']:<18} {skill_mark:<28} {mcp_mark}")
    print()

# ─── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description='Deploy VizCode AI configs to platform directories.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('--cursor',   action='store_true', help='Install Cursor AI configs')
    parser.add_argument('--windsurf', action='store_true', help='Install Windsurf configs')
    parser.add_argument('--gemini',   action='store_true', help='Install Gemini CLI configs')
    parser.add_argument('--copilot',  action='store_true', help='Install GitHub Copilot configs')
    parser.add_argument('--all',      action='store_true', help='Install all platforms')
    parser.add_argument('--list',     action='store_true', help='Show install status for all platforms')
    parser.add_argument('--force',    action='store_true', help='Overwrite existing files without prompting')
    args = parser.parse_args()

    if args.list:
        list_platforms()
        return

    targets = []
    if args.all:
        targets = list(PLATFORMS)
    else:
        if args.cursor:   targets.append('cursor')
        if args.windsurf: targets.append('windsurf')
        if args.gemini:   targets.append('gemini')
        if args.copilot:  targets.append('copilot')

    if not targets:
        parser.print_help()
        sys.exit(0)

    for name in targets:
        install_platform(name, force=args.force)

    print('\nDone.')


if __name__ == '__main__':
    main()
