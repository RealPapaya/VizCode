// dev.mjs — one-command dev loop for the VizCode frontend.
//
// What it does (the "npm run dev" you'd expect):
//   1. esbuild WATCH:  static/**/*.{ts,js}  ->  build/**/*.js, rebuilt on every save.
//   2. launches the app: `python src/vizcode.py <path>` (starts the server + opens
//      the browser, exactly like a normal run).
//
// Iteration loop: edit a .ts file -> esbuild rebuilds build/ automatically -> just
// refresh the browser (Ctrl+F5). No Python restart needed, because server.py calls
// html_builder.build_html() on every request and that re-reads build/*.js fresh.
//
// Usage:
//   npm run dev                 # analyses "." (this repo) — dogfood VizCode on itself
//   npm run dev -- <path>       # analyses <path>
//   VIZCODE_PYTHON=py npm run dev -- <path>   # override the python executable
//
// Note: the watched entry-point list is fixed when dev starts. If you ADD a brand-new
// .ts file, stop (Ctrl+C) and re-run `npm run dev` so esbuild picks it up.

import { context } from 'esbuild';
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives in scripts/, so the repo root is one level up.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'static');
const OUT = join(ROOT, 'build');

/** Recursively collect every .ts/.js source under static/, excluding .d.ts. */
function collect(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collect(full, acc);
    } else if (
      (name.endsWith('.ts') || name.endsWith('.js')) &&
      !name.endsWith('.d.ts')
    ) {
      acc.push(full);
    }
  }
  return acc;
}

const entryPoints = collect(SRC);

// 1) esbuild watch — same transform-only config as build.mjs (no bundling).
const ctx = await context({
  entryPoints,
  outdir: OUT,
  outbase: SRC,
  bundle: false,
  target: 'es2020',
  sourcemap: false,
  logLevel: 'info',
});

await ctx.rebuild();   // fresh build/ before the server starts serving it
await ctx.watch();
console.log(`[dev] esbuild watching ${entryPoints.length} files: static/ -> ${relative(ROOT, OUT)}/`);
console.log('[dev] edit a .ts file, then refresh the browser (Ctrl+F5) to see changes — no restart needed.');

// 2) Launch the Python app (server + browser), inheriting the terminal so its TUI shows.
const projectPath = process.argv[2] || '.';
const python = process.env.VIZCODE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
console.log(`[dev] launching: ${python} src/vizcode.py ${projectPath}`);

const app = spawn(python, ['src/vizcode.py', projectPath], { cwd: ROOT, stdio: 'inherit' });

// 3) Teardown — dispose esbuild when the app exits or on Ctrl+C.
let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await ctx.dispose(); } catch { /* ignore */ }
  process.exit(code ?? 0);
}

app.on('exit', (code) => shutdown(code ?? 0));
app.on('error', (err) => {
  console.error(`[dev] failed to launch python ("${python}"). Is Python on PATH? ` +
                'Override with VIZCODE_PYTHON=<exe>.\n', err.message);
  shutdown(1);
});
process.on('SIGINT', () => { try { app.kill(); } catch {} shutdown(0); });
process.on('SIGTERM', () => { try { app.kill(); } catch {} shutdown(0); });
