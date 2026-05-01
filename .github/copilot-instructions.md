---
applyTo: "**"
---

> **Note:** GitHub Copilot does not support MCP. Use the static report files below instead of calling MCP tools.

## 無 MCP 時：靜態報告導航

Run scan first:
```bash
python vizcode.py <project_path> --scan-only
```

Then read in order:
1. `.vizcode/INDEX.md` — L0 module overview (always start here, ~100-200 lines)
2. `.vizcode/L1/<module>.md` — file map for a specific module (~30-70 lines)
3. `.vizcode/L2/<module>/<file>.md` — function call graph for a specific file (~50-100 lines)

**Do not read** `.vizcode/scan_cache.json` or `.vizcode/semantic_cache.json` directly.

---
