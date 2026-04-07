---
name: galaxy-workflow
description: Work on the Galaxy view in CodeViz. Use this skill whenever the user mentions Galaxy view, Galaxy button effects, background precompute, ForceAtlas2 layout, noverlap, Sigma/graphology rendering, Galaxy performance, Galaxy UX timing, or files under static/galaxy/. Also use it for Galaxy-specific bug fixes, architecture questions, or tuning when the normal graph view is not the topic.
---

# SKILL: Galaxy Workflow

Maintain and debug the Galaxy view in CodeViz. The Galaxy feature is a separate graph pipeline with its own lifecycle, caching, background precompute flow, and performance rules.

## File Map

| Area | File |
|------|------|
| Galaxy state, lifecycle, button effect, Sigma setup | `static/galaxy/viz_galaxy.js` |
| Galaxy graph build and initial positions | `static/galaxy/viz_galaxy_graph.js` |
| Galaxy physics, FA2, yield strategy, noverlap | `static/galaxy/viz_galaxy_physics.js` |
| Galaxy button animation and topbar styles | `static/viz.css` |
| App bootstrap that schedules background Galaxy work | `static/viz.js` |

## Current Background Stages

Treat the current Galaxy pipeline as 5 stages.

### Stage 1: Queue and visible button effect
When analysis finishes and the page is ready, `static/viz.js` calls `scheduleGalaxyPrecompute()`.

Current behavior:
- The Galaxy button effect should start almost immediately so the user sees Galaxy is being prepared.
- This stage should not do heavy graph work yet.
- Relevant flags live in `viz_galaxy.js`: `_gPrecomputeQueued`, `_gPrecomputePending`, `_galaxySyncButtonComputing()`.

### Stage 2: Idle gate before heavy background work
Background compute waits for a quiet period before starting heavy work.

Current rule:
- Require about `900ms` of no user activity before starting the expensive background run.
- Activity comes from pointer, wheel, key, touch, and scroll events.
- The gate lives in `_galaxyWaitForBackgroundIdle()`.

### Stage 3: Background graph preparation
Once idle, the background path may rebuild Galaxy data if the fingerprint changed.

Work in this stage:
- `_gComputeDataFingerprint()`
- `_galaxyTeardownSigma()` when data changed
- `_galaxyBuildGraph()`
- `_gBuildDegreeCache()`
- `_galaxyInitPositions()`

This stage should stay deterministic and avoid UI work unless needed.

### Stage 4: Low-priority background FA2 layout
The background path enters `_galaxyLayoutAsync()` and then `_galaxyFA2RunAsync()`.

Rules for this stage:
- Background mode must yield often and stay cooperative.
- If Galaxy is not visible, avoid unnecessary intermediate graph flushes.
- If the user becomes active again, pause and wait for quiet time instead of fighting the UI.
- In the current implementation, physics uses a tighter time budget in background mode and consults `_galaxyWaitForBackgroundIdle()` between slices.

### Stage 5: Foreground completion in Galaxy view
When the user opens Galaxy view, switch to high-priority work.

Rules for this stage:
- Do not keep the background pacing rules once Galaxy is actually open.
- Finish any remaining layout work eagerly.
- Run `_galaxyNoverlapPass()` in the foreground if it was deferred.
- Show the in-view badge while the foreground layout is running.

## Working Rules

### If the user reports Galaxy is slow
Check these first:
- Whether heavy work starts before the idle gate.
- Whether `_galaxyFA2RunAsync()` is flushing positions too often.
- Whether background mode is still active after Galaxy view opens.
- Whether `_gLayoutNeedsNoverlap` keeps extra work pending longer than necessary.

### If the user reports button effect is wrong
Check these first:
- `_gPrecomputeQueued`
- `_gPrecomputePending`
- `_gBackgroundPrecomputeMode`
- `_gLayoutRunning`
- `_gLayoutNeedsNoverlap`
- `_galaxyShouldShowButtonEffect()`
- `_galaxySetButtonComputing()`
- `.topbar-mode-btn.computing` in `static/viz.css`

The usual failure modes are:
- effect starts too late
- effect never appears
- effect never stops
- effect stops even though foreground Galaxy still has work left

### If the user reports Galaxy opens slowly
Separate the cause:
- graph build cost
- initial position cost
- FA2 cost
- noverlap cost
- Sigma renderer setup cost

Do not guess. Inspect which phase is responsible before changing thresholds.

## Recommended Debug Flow

1. Confirm whether the issue is in queued state, background compute, or foreground Galaxy entry.
2. Check the state flags in `static/galaxy/viz_galaxy.js`.
3. Check whether the problem belongs to graph build, physics, or CSS.
4. Make the smallest fix that preserves these design goals:
   - immediate visual feedback
   - no UI jank during background work
   - high-priority completion once Galaxy is opened
5. Re-run lightweight syntax validation on changed JS files with `node --check`.

## Safe Change Patterns

### Good changes
- Tuning idle thresholds with a clear reason.
- Changing background time slicing in physics.
- Deferring non-critical work like noverlap to foreground entry.
- Adjusting button-state predicates so the effect matches real work.
- Reducing intermediate refreshes when Galaxy is hidden.

### Risky changes
- Removing cache invalidation around `_gDataFingerprint`.
- Running background FA2 at full speed while Galaxy is hidden.
- Rebuilding Sigma repeatedly during background work.
- Keeping button effect tied to stale flags.
- Mixing Galaxy and non-Galaxy topbar behavior in the wrong file.

## Notes

- Galaxy behavior is intentionally different from the normal graph view.
- Prefer editing Galaxy behavior in `static/galaxy/*` rather than leaking logic into generic graph files.
- If a request is Galaxy-only, stay inside the Galaxy pipeline unless the bootstrap hook or topbar CSS truly needs adjustment.

## Known Sigma.js Rendering Limitations

### Edge-behind-node occlusion (CANNOT BE FIXED with z-index)

Sigma.js renders edges and nodes in separate WebGL draw passes within the same canvas context, in a hardcoded order: **edges → nodes → labels → hovers**. Because this is a WebGL draw-call order (not CSS stacking), **swapping CSS z-index on Sigma's canvas elements does NOT reliably change the edge/node ordering**. Attempts to manipulate `canvas.style.zIndex` may appear to work initially but cause labels, hovers, and mouse events to break.

**DO NOT attempt**: swapping z-index of Sigma's internal canvas elements.

**Correct solution**: Use **Isolate Mode** (`_gIsolateMode`). When a node is pinned, an eye-icon toggle button (`#galaxy-isolate-btn`) appears. When activated, non-neighbor nodes and non-connected edges are hidden (`data.hidden = true` in the reducers). This completely eliminates the occlusion problem by removing the interfering nodes from the render.

### Node size during highlight

Do **NOT** shrink unrelated nodes during hover/selection modes. The user expects nodes to remain their original size. Use only `_colorDim` or `_colorFog` for visual dimming, not `size` changes.

## FA2 Physics Tuning Reference (vs CodeViz)

The Galaxy FA2 parameters have been tuned to produce a layout similar to CodeViz. Key design decisions:

| Parameter | Rationale |
|-----------|-----------|
| `scalingRatio: 200-1200` | Very high repulsion to spread nodes wide. CodeViz uses 15-100 but runs FA2 for 20-45 seconds in a Web Worker; we need stronger repulsion to compensate for fewer effective iterations. |
| `gravity: 0.001-0.02` | Near-zero gravity lets clusters float freely. Higher gravity pulls everything to center → single blob. |
| `contain edge weight: 0.08` | Structural tree edges (folder→file) must have near-zero attraction to prevent the containment tree from collapsing everything into a ball. This was the single biggest fix. |
| `define edge weight: 0.06` | Same reasoning as contain. |
| `import/call weights: 0.1-0.3` | Cross-module semantic edges should gently attract but not dominate. |
| `_G_MASS folder: 50, class: 20, function: 3` | High mass ratio (25:1) lets structural nodes push surrounding nodes apart effectively. |
| `MIN_ITERS: 400-800` | Convergence is not checked until this many iterations have run. Without this, the layout appears to converge too early because initial swing is low when nodes are already spread wide. |
| `Iteration limit: 1500-5000` | Much higher than original (180-800) to give the layout time to settle. |
| `Speed cap: 0.5/swing` | Raised from 0.1/swing to allow faster node movement per iteration. |
| `Initial spread: √n × 300` | Very wide initial separation so FA2 starts from a dispersed state. |
| `Community pre-clustering` | Golden angle spiral places different communities at different angular positions, giving the layout a head start on cluster separation. |

### Smooth animation during FA2

The FA2 runner syncs positions to the graph (`flushNodePositions()` + `_gSig.refresh()`) on **every `requestAnimationFrame` yield** when the Galaxy is visible. This produces smooth ~60fps animation instead of choppy batch updates.

### All edges use curved rendering

All edge types (contain, define, import, call, extend, implements, override) use `type: 'curved'` with `curvature: 0.08 + Math.random() * 0.06`. No straight lines — they cause pixel aliasing artifacts at high density.

## CodeViz Reference

The layout algorithm was modeled after [CodeViz](../Reference/CodeViz-main/). Key reference files:
- `CodeViz-web/src/lib/graph-adapter.ts` — cluster-based initial positioning, golden angle spiral
- `CodeViz-web/src/hooks/useSigma.ts` — FA2 settings, adaptive gravity/scaling, noverlap
- `CodeViz-web/src/lib/constants.ts` — node size hierarchy