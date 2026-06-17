"use strict";
const _G_MASS = {
  folder: 14,
  file: 6,
  class: 9,
  struct: 9,
  interface: 8,
  enum: 6,
  typedef: 5,
  function: 4,
  method: 3
};
const _G_EDGE_TYPE_WEIGHT = {
  contain: 0.08,
  define: 0.06,
  import: 0.3,
  call: 0.1,
  extend: 0.7,
  implements: 0.7,
  mixin_include: 0.7,
  mixin_extend: 0.7,
  mixin_prepend: 0.7,
  behaviour_impl: 0.7,
  protocol_impl: 0.7,
  override: 0.3
};
function _galaxyFA2Settings(nodeCount) {
  const isSmall = nodeCount < 500;
  const isMedium = nodeCount >= 500 && nodeCount < 2e3;
  const isLarge = nodeCount >= 2e3 && nodeCount < 1e4;
  return {
    // Lowered gravity to prevent over-compression toward center
    gravity: isSmall ? 8e-3 : isMedium ? 3e-3 : isLarge ? 1e-3 : 5e-4,
    // Higher scalingRatio = stronger repulsion = more spread
    scalingRatio: isSmall ? 400 : isMedium ? 800 : isLarge ? 1600 : 2400,
    slowDown: isSmall ? 1 : isMedium ? 1.5 : isLarge ? 2 : 3,
    barnesHutOptimize: nodeCount > 150,
    barnesHutTheta: isLarge ? 0.8 : 0.6,
    strongGravityMode: false,
    outboundAttractionDistribution: true,
    linLogMode: false,
    adjustSizes: true,
    edgeWeightInfluence: 1
  };
}
function _galaxyFA2IterationLimit(nodeCount) {
  if (nodeCount >= 2e4) return 1500;
  if (nodeCount >= 12e3) return 2e3;
  if (nodeCount >= 8e3) return 2500;
  if (nodeCount >= 4e3) return 3e3;
  return Math.min(5e3, Math.max(1500, Math.floor(nodeCount * 3)));
}
function _galaxyFA2ConvergenceSettings(nodeCount) {
  if (nodeCount >= 12e3) return { threshold: 3e-3, window: 30, minIters: 400 };
  if (nodeCount >= 4e3) return { threshold: 2e-3, window: 40, minIters: 600 };
  return { threshold: 2e-3, window: 50, minIters: 800 };
}
const _G_NOVERLAP = {
  maxIterations: 80,
  // More iterations for gentler movement
  ratio: 1.2,
  // Reduced from 1.5 — less aggressive sizing
  margin: 40,
  // Reduced from 60 — tighter spacing
  expansion: 1.4,
  // Reduced from 1.8 — gentler push force
  gridSize: 100
};
async function _galaxyFA2RunAsync(token) {
  if (!_gGraph || _gGraph.order === 0) return;
  const snap = _galaxySnapshotGraphForSim();
  if (!snap || snap.n === 0) return;
  const sim = _gSimCreate(snap);
  const n = snap.n;
  const keys = snap.keys;
  const st = snap.settings.stage;
  const sigmaRefreshInterval = n > 5e3 ? 200 : n > 3e3 ? 120 : n > 1500 ? 50 : 0;
  let lastSigmaRefresh = 0;
  const flush = () => {
    for (let i = 0; i < n; i++) {
      _gGraph.setNodeAttribute(keys[i], "x", sim.xs[i]);
      _gGraph.setNodeAttribute(keys[i], "y", sim.ys[i]);
    }
  };
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
    const backgroundMode = typeof _galaxyIsBackgroundPriority === "function" && _galaxyIsBackgroundPriority();
    const visible = !!_gSig;
    const budgetMs = backgroundMode ? 5 : 14;
    if (performance.now() - sliceStart >= budgetMs) {
      if (visible) {
        const now = performance.now();
        if (sigmaRefreshInterval === 0 || now - lastSigmaRefresh >= sigmaRefreshInterval) {
          flush();
          if (n <= 3e4) _gSig.refresh();
          lastSigmaRefresh = now;
        }
      } else if (backgroundMode && iter % 40 === 0) {
        flush();
      }
      if (_gLayoutToken !== token) return;
      if (backgroundMode && typeof _galaxyWaitForBackgroundIdle === "function") {
        const canContinue = await _galaxyWaitForBackgroundIdle(token, 360);
        if (!canContinue) return;
      } else {
        await new Promise((r) => requestAnimationFrame(r));
      }
      sliceStart = performance.now();
    }
  }
  if (_gLayoutToken !== token) return;
  const NO = st.noverlap;
  for (let it = 0; it < NO.maxIterations; it++) {
    const moved = sim.noverlapStep();
    if (_gLayoutToken !== token) return;
    if (_gSig) {
      flush();
      if (n <= 3e4) _gSig.refresh();
    }
    await new Promise((r) => requestAnimationFrame(r));
    if (moved === 0) break;
  }
  if (_gLayoutToken !== token) return;
  flush();
}
