#!/usr/bin/env bash
# launch.sh — VIZCODE launcher for macOS / Linux (POSIX equivalent of launch.bat)
# Zero pip dependencies — pure Python stdlib only.
set -euo pipefail

# Always run from the repo root (directory of this script).
cd "$(dirname "$0")"

MIN_PYTHON="3.6"

# Find a usable Python 3.6+ interpreter. We actually *run* each candidate rather
# than trusting `command -v`, so broken shims (e.g. the Microsoft Store python3
# stub under Git-Bash) are skipped instead of aborting the launch.
PY=""
for candidate in python3 python python3.12 python3.11 python3.10 python3.9 python3.8; do
    if "$candidate" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 6) else 1)" >/dev/null 2>&1; then
        PY="$candidate"
        break
    fi
done

if [ -z "$PY" ]; then
    echo "[ERROR] No usable Python ${MIN_PYTHON}+ found."
    echo "Install Python ${MIN_PYTHON}+ first:"
    echo "  macOS:  brew install python   (or https://www.python.org/downloads/)"
    echo "  Linux:  sudo apt install python3   (or your distro's package manager)"
    exit 1
fi

# Force UTF-8 I/O (matches launch.bat chcp 65001 behavior).
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

exec "$PY" src/vizcode.py "$@"
