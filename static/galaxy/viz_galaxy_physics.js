'use strict';

// ── Galaxy Physics Engine ───────────────────────────────────────────────────
// Barnes-Hut quadtree, ForceAtlas2, and Noverlap — pure math, no DOM/Sigma.
// Reads from / writes to _gGraph (defined in viz_galaxy.js).
// References _gSig and _gLayoutToken (also defined in viz_galaxy.js).

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

// ── Barnes-Hut Quadtree ──────────────────────────────────────────────────────

class _BHRegion {
    constructor(cx, cy, size) {
        this.cx = cx; this.cy = cy; this.size = size;
        this.mass = 0; this.massCx = 0; this.massCy = 0;
        this.node = -1;
        this.q = null;
    }
}

function _bhGetQ(reg, x, y) {
    return (x < reg.cx ? 0 : 1) + (y < reg.cy ? 0 : 2);
}

function _bhSubReg(reg, q) {
    const qs = reg.size / 4;
    const ox = [[-qs, -qs], [qs, -qs], [-qs, qs], [qs, qs]];
    return new _BHRegion(reg.cx + ox[q][0], reg.cy + ox[q][1], reg.size / 2);
}

function _bhInsert(reg, idx, nodes) {
    const nm = nodes[idx].mass, nx = nodes[idx].x, ny = nodes[idx].y;
    const oldM = reg.mass;
    reg.mass += nm;
    reg.massCx = (reg.massCx * oldM + nx * nm) / reg.mass;
    reg.massCy = (reg.massCy * oldM + ny * nm) / reg.mass;
    if (reg.node === -1 && reg.q === null) { reg.node = idx; return; }
    if (reg.q === null) {
        const prev = reg.node;
        reg.node = -1;
        reg.q = [null, null, null, null];
        const pq = _bhGetQ(reg, nodes[prev].x, nodes[prev].y);
        if (!reg.q[pq]) reg.q[pq] = _bhSubReg(reg, pq);
        _bhInsert(reg.q[pq], prev, nodes);
    }
    const cq = _bhGetQ(reg, nx, ny);
    if (!reg.q[cq]) reg.q[cq] = _bhSubReg(reg, cq);
    _bhInsert(reg.q[cq], idx, nodes);
}

function _bhRepulse(reg, i, nodes, scaling, theta, adjustSizes, fx, fy) {
    if (reg.mass === 0) return;
    const dx = nodes[i].x - reg.massCx;
    const dy = nodes[i].y - reg.massCy;
    const d2 = dx * dx + dy * dy + 1;
    const d  = Math.sqrt(d2);
    if (reg.q === null && reg.node === i) return;
    if (reg.q === null || reg.size / d < theta) {
        const minDist = adjustSizes ? (nodes[i].size + 1) : 0;
        const effectiveD = Math.max(d, minDist + 0.1);
        const effectiveD2 = effectiveD * effectiveD;
        const f = scaling * nodes[i].mass * reg.mass / effectiveD2;
        fx[i] += dx / d * f; fy[i] += dy / d * f;
        return;
    }
    for (let q = 0; q < 4; q++) {
        if (reg.q[q]) _bhRepulse(reg.q[q], i, nodes, scaling, theta, adjustSizes, fx, fy);
    }
}

// ── ForceAtlas2 Main Runner (async, chunked, cancellable) ────────────────────

async function _galaxyFA2RunAsync(token) {
    if (!_gGraph || _gGraph.order === 0) return;

    const nodes = [];
    const nodeIdx = {};
    _gGraph.forEachNode((key, attrs) => {
        nodeIdx[key] = nodes.length;
        nodes.push({
            key,
            x: attrs.x, y: attrs.y,
            mass: _G_MASS[attrs._t] || 1,
            size: attrs.size || 3,
            outDegree: 0,
            inDegree: 0,
        });
    });

    const edgeList = [];
    _gGraph.forEachEdge((_e, eAttrs, src, tgt) => {
        const si = nodeIdx[src], ti = nodeIdx[tgt];
        if (si == null || ti == null) return;
        nodes[si].outDegree++;
        nodes[ti].inDegree++;
        // Structural edges (contain/define) should barely attract — they create trees
        // that crush everything into a ball if given weight. Semantic edges matter more.
        const edgeTypeWeight = { contain: 0.08, define: 0.06, import: 0.3, call: 0.1, extend: 0.7, implements: 0.7, override: 0.3 };
        edgeList.push({ si, ti, w: (eAttrs.size || 1) * (edgeTypeWeight[eAttrs._t] || 0.5) });
    });

    const n = nodes.length;
    if (n === 0) return;

    const settings = _galaxyFA2Settings(n);
    const maxIters = _galaxyFA2IterationLimit(n);
    const convergence = _galaxyFA2ConvergenceSettings(n);
    const useBH = settings.barnesHutOptimize;
    const theta = settings.barnesHutTheta;
    const scaling = settings.scalingRatio;
    const gravity = settings.gravity;
    const slowDown = settings.slowDown;
    const linLog = settings.linLogMode;
    const adjustSizes = settings.adjustSizes;
    const hubDissuasion = settings.outboundAttractionDistribution;
    const edgeWeightInfluence = settings.edgeWeightInfluence;

    const fx = new Float64Array(n), fy = new Float64Array(n);
    const pfx = new Float64Array(n), pfy = new Float64Array(n);
    let globalSpeed = 1;
    const TOLERANCE = 0.1;

    // Convergence detection — only checked after MIN_ITERS
    let convergedCount = 0;
    const CONVERGE_THRESHOLD = convergence.threshold;
    const CONVERGE_WINDOW = convergence.window;
    const MIN_ITERS = convergence.minIters || 500;

    // Adaptive batch size: used only for background (non-visible) periodic sync
    const BATCH = n > 20000 ? 200 : n > 5000 ? 80 : n > 1000 ? 40 : 20;
    const flushNodePositions = () => {
        for (let i = 0; i < n; i++) {
            _gGraph.setNodeAttribute(nodes[i].key, 'x', nodes[i].x);
            _gGraph.setNodeAttribute(nodes[i].key, 'y', nodes[i].y);
        }
    };
    let sliceStart = performance.now();

    for (let iter = 0; iter < maxIters; iter++) {
        fx.fill(0); fy.fill(0);

        // 1. Repulsion (Barnes-Hut or brute-force)
        if (useBH) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < n; i++) {
                if (nodes[i].x < minX) minX = nodes[i].x;
                if (nodes[i].x > maxX) maxX = nodes[i].x;
                if (nodes[i].y < minY) minY = nodes[i].y;
                if (nodes[i].y > maxY) maxY = nodes[i].y;
            }
            const sz = Math.max(maxX - minX, maxY - minY) * 1.2 + 1;
            const root = new _BHRegion((minX + maxX) / 2, (minY + maxY) / 2, sz);
            for (let i = 0; i < n; i++) _bhInsert(root, i, nodes);
            for (let i = 0; i < n; i++) _bhRepulse(root, i, nodes, scaling, theta, adjustSizes, fx, fy);
        } else {
            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
                    const d2 = dx * dx + dy * dy + 1;
                    const d = Math.sqrt(d2);
                    const minDist = adjustSizes ? (nodes[i].size + nodes[j].size + 1) : 0;
                    const ed = Math.max(d, minDist + 0.1);
                    const f = scaling * nodes[i].mass * nodes[j].mass / (ed * ed);
                    fx[i] += dx / d * f; fy[i] += dy / d * f;
                    fx[j] -= dx / d * f; fy[j] -= dy / d * f;
                }
            }
        }

        // 2. Edge attraction (with Hub Dissuasion)
        for (let e = 0; e < edgeList.length; e++) {
            const { si, ti, w } = edgeList[e];
            const dx = nodes[ti].x - nodes[si].x;
            const dy = nodes[ti].y - nodes[si].y;
            const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
            const weight = Math.pow(w, edgeWeightInfluence);

            let f;
            if (linLog) {
                f = weight * Math.log(1 + d) / d;
            } else {
                f = weight;
            }

            // Hub Dissuasion: divide by source out-degree
            if (hubDissuasion) {
                f /= Math.max(nodes[si].outDegree, 1);
            }

            fx[si] += dx / d * f * d; fy[si] += dy / d * f * d;
            fx[ti] -= dx / d * f * d; fy[ti] -= dy / d * f * d;
        }

        // 3. Gravity (pulls toward center, prevents drift)
        for (let i = 0; i < n; i++) {
            const d = Math.sqrt(nodes[i].x * nodes[i].x + nodes[i].y * nodes[i].y) + 0.1;
            const gf = gravity * nodes[i].mass;
            fx[i] -= nodes[i].x / d * gf;
            fy[i] -= nodes[i].y / d * gf;
        }

        // 4. Adaptive global speed (FA2 swing/traction)
        let gSwing = 0, gTraction = 0;
        for (let i = 0; i < n; i++) {
            const swx = fx[i] - pfx[i], swy = fy[i] - pfy[i];
            gSwing    += nodes[i].mass * Math.sqrt(swx * swx + swy * swy);
            gTraction += nodes[i].mass * Math.sqrt(
                (fx[i] + pfx[i]) * (fx[i] + pfx[i]) + (fy[i] + pfy[i]) * (fy[i] + pfy[i])
            ) * 0.5;
        }
        if (gSwing > 0) {
            const targetSpeed = TOLERANCE * gTraction / gSwing;
            globalSpeed = Math.min(targetSpeed, globalSpeed * 1.05);
        }

        // Convergence check — skip until minimum iterations reached
        if (iter >= MIN_ITERS) {
            const swingRatio = gTraction > 0 ? gSwing / gTraction : 0;
            if (swingRatio < CONVERGE_THRESHOLD) {
                convergedCount++;
                if (convergedCount >= CONVERGE_WINDOW) {
                    console.log(`[galaxy] FA2 converged at iteration ${iter}/${maxIters}`);
                    break;
                }
            } else {
                convergedCount = 0;
            }
        }

        // 5. Integrate
        for (let i = 0; i < n; i++) {
            const swx = fx[i] - pfx[i], swy = fy[i] - pfy[i];
            const swing = Math.sqrt(swx * swx + swy * swy) + 1e-5;
            const spd = Math.min(globalSpeed, 0.5 / swing) / slowDown;
            nodes[i].x += fx[i] * spd;
            nodes[i].y += fy[i] * spd;
            pfx[i] = fx[i]; pfy[i] = fy[i];
        }

        const backgroundMode = typeof _galaxyIsBackgroundPriority === 'function' && _galaxyIsBackgroundPriority();
        const visible = !!_gSig;
        const budgetMs = backgroundMode ? 5 : 14;
        const elapsed = performance.now() - sliceStart;

        // Foreground: yield every budgetMs and sync EVERY frame for smooth animation
        // Background: yield every budgetMs but only sync positions every BATCH iters
        if (elapsed >= budgetMs) {
            if (visible) {
                // Smooth 60fps: flush positions + refresh on every yield
                flushNodePositions();
                if (n <= 30000) _gSig.refresh();
            } else if ((iter + 1) % BATCH === 0) {
                // Background: periodic sync only
                flushNodePositions();
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

    // Write back final positions
    flushNodePositions();
}

// ── Noverlap: post-FA2 overlap removal ──────────────────────────────────────

async function _galaxyNoverlapPassAsync(token) {
    if (!_gGraph || _gGraph.order === 0) return;
    const S = _G_NOVERLAP;
    const nodes = [];
    _gGraph.forEachNode((key, attrs) => {
        nodes.push({
            key,
            x: attrs.x, y: attrs.y,
            size: (attrs.size || 3) * S.ratio + S.margin,
        });
    });
    const n = nodes.length;
    if (n < 2) return;

        let sliceStart = performance.now();
    const visible = !!_gSig;
    const RENDER_EVERY = 1; // Render every iteration for smooth animation

    for (let iter = 0; iter < S.maxIterations; iter++) {
        let moved = 0;
        const grid = new Map();
        const cellSize = S.gridSize;
        for (let i = 0; i < n; i++) {
            const gk = `${Math.floor(nodes[i].x / cellSize)},${Math.floor(nodes[i].y / cellSize)}`;
            if (!grid.has(gk)) grid.set(gk, []);
            grid.get(gk).push(i);
        }
        for (const [gk, cell] of grid) {
            const [cx, cy] = gk.split(',').map(Number);
            const nearby = [];
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const nc = grid.get(`${cx + dx},${cy + dy}`);
                    if (nc) nearby.push(...nc);
                }
            }
            for (const i of cell) {
                for (const j of nearby) {
                    if (j <= i) continue;
                    const ddx = nodes[i].x - nodes[j].x;
                    const ddy = nodes[i].y - nodes[j].y;
                    const dist = Math.sqrt(ddx * ddx + ddy * ddy) + 0.01;
                    const minDist = (nodes[i].size + nodes[j].size) * S.expansion;
                    if (dist < minDist) {
                        const push = (minDist - dist) / dist * 0.5;
                        nodes[i].x += ddx * push;
                        nodes[i].y += ddy * push;
                        nodes[j].x -= ddx * push;
                        nodes[j].y -= ddy * push;
                        moved++;
                    }
                }
            }
        }

        // Progressive rendering: update every RENDER_EVERY iterations, on last iteration, or when converged
        const shouldRender = (iter % RENDER_EVERY === 0) || (iter === S.maxIterations - 1) || (moved === 0);

        if (visible && shouldRender) {
            // Write current positions back to graph
            for (let i = 0; i < n; i++) {
                _gGraph.setNodeAttribute(nodes[i].key, 'x', nodes[i].x);
                _gGraph.setNodeAttribute(nodes[i].key, 'y', nodes[i].y);
            }

            // Refresh Sigma rendering (same threshold as FA2)
            if (n <= 30000) _gSig.refresh();

            // Check if cancelled
            if (_gLayoutToken !== token) return;

            // Yield control to browser for smooth animation
            await new Promise(r => requestAnimationFrame(r));
            sliceStart = performance.now();
        }

        if (moved === 0) break;
    }

    // Final position write-back (ensure all positions are committed)
    for (let i = 0; i < n; i++) {
        _gGraph.setNodeAttribute(nodes[i].key, 'x', nodes[i].x);
        _gGraph.setNodeAttribute(nodes[i].key, 'y', nodes[i].y);
    }
}
