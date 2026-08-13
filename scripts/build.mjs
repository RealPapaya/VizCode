// build.mjs — transpile the frontend (static/**/*.{ts,js}) into build/ with esbuild.
//
// Transform-only (no bundling): every source file becomes one plain .js script with
// type annotations stripped. Because no source uses import/export, the output is
// byte-equivalent in semantics to the original concatenation model — top-level
// const/let/function stay global, so html_builder.py can concatenate build/*.js
// exactly as it did static/*.js today.
//
// .d.ts files (static/types/*) are type-only and produce no runtime output — skipped.
//
// Run: npm run build   (must be re-run after editing any .ts; commit build/).

import { build } from 'esbuild';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

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
console.log(`[build] transpiling ${entryPoints.length} files: static/ -> build/`);

await build({
  entryPoints,
  outdir: OUT,
  outbase: SRC,
  // bundle:false (default) => each file transpiled independently, NO IIFE wrapper,
  // so top-level declarations remain global after concatenation.
  bundle: false,
  target: 'es2020',
  sourcemap: false,
  logLevel: 'info',
}).then(() => {
  console.log(`[build] done. Output: ${relative(ROOT, OUT)}/`);
});
