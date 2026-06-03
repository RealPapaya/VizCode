'use strict';

// ── Galaxy Physics — settings + main-thread fallback ─────────────────────────
// The simulation core (Barnes-Hut + ForceAtlas2 + Noverlap) now lives in
// viz_galaxy_worker.js as `_gSimCreate`, shared by the Web Worker and this
// fallback so the algorithm exists in exactly one place. This file owns the
// adaptive settings (mass, FA2 tuning, iteration/convergence limits, Noverlap
// params, edge-type weights) and `_galaxyFA2RunAsync`, the cooperative
// main-thread driver used when a worker is unavailable or for small graphs.

// ── Node mass for force simulation ──────────────────────────────────────────
const _G_MASS = {
    folder: 50,
    file: 5,
    class: 20,
    struct: 20,
    interface: 15,
    enum: 8,
    typedef: 5,
    function: 3,
    method: 2,
};

// ── Edge-type attraction weights ─────────────────────────────────────────────
// Structural edges (contain/define) should barely attract — they create trees
// that crush everything into a ball if given weight. Semantic edges matter more.
const _G_EDGE_TYPE_WEIGHT = {
    contain: 0.08, define: 0.06, import: 0.3, call: 0.1,
    extend: 0.7, implements: 0.7, mixin_include: 0.7,
    mixin_extend: 0.7, mixin_prepend: 0.7, behaviour_impl: 0.7,
    protocol_impl: 0.7, override: 0.3,
};

// ── ForceAtlas2 adaptive settings ───────────────────────────────────────────
function _galaxyFA2Settings(nodeCount) {
    const isSmall  = nodeCount < 500;
    const isMedium = nodeCount >= 500  && nodeCount < 2000;
    const isLarge  = nodeCount >= 2000 && nodeCount < 10000;
    return {
        // Lowered gravity to prevent over-compression toward center
        gravity:      isSmall ? 0.008 : isMedium ? 0.003 : isLarge ? 0.001 : 0.0005,
        // Higher scalingRatio = stronger repulsion = more spread
        scalingRatio: isSmall ? 400  : isMedium ? 800   : isLarge ? 1600  : 2400,
        slowDown:     isSmall ? 1.0  : isMedium ? 1.5  : isLarge ? 2.0   : 3.0,
        barnesHutOptimize: nodeCount > 150,
        barnesHutTheta:    isLarge ? 0.8 : 0.6,
        strongGravityMode: false,
        outboundAttractionDistribution: true,
        linLogMode: false,
        adjustSizes: true,
        edgeWeightInfluence: 1,
    };
}

function _galaxyFA2IterationLimit(nodeCount) {
    if (nodeCount >= 20000) return 1500;
    if (nodeCount >= 12000) return 2000;
    if (nodeCount >= 8000)  return 2500;
    if (nodeCount >= 4000)  return 3000;
    return Math.min(5000, Math.max(1500, Math.floor(nodeCount * 3)));
}

function _galaxyFA2ConvergenceSettings(nodeCount) {
    // Minimum iterations before convergence is even checked — let the layout breathe
    if (nodeCount >= 12000) return { threshold: 0.003, window: 30, minIters: 400 };
    if (nodeCount >= 4000)  return { threshold: 0.002, window: 40, minIters: 600 };
    return { threshold: 0.002, window: 50, minIters: 800 };
}

// ── Noverlap settings for final overlap removal ──────────────────────────────
const _G_NOVERLAP = {
    maxIterations: 80,     // More iterations for gentler movement
    ratio: 1.2,            // Reduced from 1.5 — less aggressive sizing
    margin: 40,            // Reduced from 60 — tighter spacing
    expansion: 1.4,        // Reduced from 1.8 — gentler push force
    gridSize: 100,
};

// ── ForceAtlas2 main-thread fallback (async, chunked, cancellable) ───────────
// Used when a Web Worker cannot be created (e.g. some file:// contexts) or for
// small graphs that converge instantly and do not justify worker spin-up. Drives
// the shared `_gSimCreate` core (from viz_galaxy_worker.js) through the same
// coarse → refine → noverlap schedule the worker uses, yielding via rAF so the
// UI stays responsive. Reads / writes _gGraph; references _gSig and _gLayoutToken.
async function _galaxyFA2RunAsync(token) {
    if (!_gGraph || _gGraph.order === 0) return;

    const snap = _galaxySnapshotGraphForSim();
    if (!snap || snap.n === 0) return;

    const sim = _gSimCreate(snap);
    const n = snap.n;
    const keys = snap.keys;
    const st = snap.settings.stage;

    // Sigma re-render throttle: yield every budgetMs for UI responsiveness, but
    // rate-limit the expensive Sigma redraws for large graphs.
    const sigmaRefreshInterval = n > 5000 ? 200 : n > 3000 ? 120 : n > 1500 ? 50 : 0;
    let lastSigmaRefresh = 0;

    const flush = () => {
        for (let i = 0; i < n; i++) {
            _gGraph.setNodeAttribute(keys[i], 'x', sim.xs[i]);
            _gGraph.setNodeAttribute(keys[i], 'y', sim.ys[i]);
        }
    };

    // Stage A (coarse) → Stage B (refine), matching the worker schedule.
    let stage = 0;
    let convergedCount = 0;
    sim.setTheta(st.coarseTheta);
    sim.setSlowDown(st.coarseSlowDown);
    let sliceStart = performance.now();

    for (let iter = 0; iter < st.maxIters; iter++) {
        if (stage === 0 && iter >= st.stageAIters) {
            stage = 1;
            sim.setTheta(st.refineTheta);
            sim.setSlowDown(st.refineSlowDown);
        }

        const swingRatio = sim.step();

        // Convergence check — refine stage only, after the minimum iterations.
        if (stage === 1 && iter >= st.minIters) {
            if (swingRatio < st.threshold) {
                convergedCount++;
                if (convergedCount >= st.window) {
                    console.log(`[galaxy] FA2 converged at iteration ${iter}/${st.maxIters}`);
                    break;
                }
            } else {
                convergedCount = 0;
            }
        }

        const backgroundMode = typeof _galaxyIsBackgroundPriority === 'function' && _galaxyIsBackgroundPriority();
        const visible = !!_gSig;
        const budgetMs = backgroundMode ? 5 : 14;

        if (performance.now() - sliceStart >= budgetMs) {
            if (visible) {
                const now = performance.now();
                if (sigmaRefreshInterval === 0 || now - lastSigmaRefresh >= sigmaRefreshInterval) {
                    flush();
                    if (n <= 30000) _gSig.refresh();
                    lastSigmaRefresh = now;
                }
            } else if (backgroundMode && (iter % 40) === 0) {
                flush(); // keep _gGraph warm for a mid-run open
            }
            if (_gLayoutToken !== token) return; // galaxy was closed — stop
            if (backgroundMode && typeof _galaxyWaitForBackgroundIdle === 'function') {
                const canContinue = await _galaxyWaitForBackgroundIdle(token, 360);
                if (!canContinue) return;
            } else {
                await new Promise(r => requestAnimationFrame(r));
            }
            sliceStart = performance.now();
        }
    }

    if (_gLayoutToken !== token) return;

    // Stage C: Noverlap overlap removal (cheap on the small / no-worker graphs
    // that reach this path). Yields each iteration for smooth animation.
    const NO = st.noverlap;
    for (let it = 0; it < NO.maxIterations; it++) {
        const moved = sim.noverlapStep();
        if (_gLayoutToken !== token) return;
        if (_gSig) {
            flush();
            if (n <= 30000) _gSig.refresh();
        }
        await new Promise(r => requestAnimationFrame(r));
        if (moved === 0) break;
    }

    if (_gLayoutToken !== token) return;

    // Write back final positions
    flush();
}
