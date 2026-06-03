'use strict';

// ── Galaxy Off-Thread Physics ────────────────────────────────────────────────
// Runs the Galaxy force simulation in a Web Worker so heavy math never blocks
// the main thread — pan / zoom / hover / selection stay smooth while the layout
// converges live. The same simulation core (`_gSimCreate`) drives BOTH the
// worker and the main-thread fallback, so the algorithm exists in exactly one
// place. The worker is built from a Blob URL by serialising `_gSimCreate` plus
// a small harness, which keeps the generated HTML self-contained (build inlines
// every JS file into one <script>, so there is no separate worker URL to load).
//
// Depends on (all share global scope after concatenation):
//   viz_galaxy_physics.js — _G_MASS, _G_EDGE_TYPE_WEIGHT, _G_NOVERLAP,
//                           _galaxyFA2Settings/_galaxyFA2IterationLimit/
//                           _galaxyFA2ConvergenceSettings, _galaxyFA2RunAsync (fallback)
//   viz_galaxy.js         — _gGraph, _gSig, _gLayoutToken, state,
//                           _galaxyIsBackgroundPriority

// ── Shared simulation core (pure math — no DOM / Graphology / Sigma) ──────────
// Operates entirely on typed arrays. Used verbatim inside the worker (via
// `.toString()` serialisation) and on the main thread for the fallback. It must
// stay self-contained: it may not reference any outer-scope symbol, because the
// worker only receives its serialised source.
function _gSimCreate(P) {
    const n = P.n | 0;
    const e = P.e | 0;
    const xs = P.xs, ys = P.ys;          // Float32Array — mutated in place
    const mass = P.mass, size = P.size;  // Float32Array
    const outDeg = P.outDeg;             // Float32Array
    const esrc = P.esrc, etgt = P.etgt, ew = P.ew;
    const s = P.settings;

    const scaling = s.scalingRatio;
    const gravity = s.gravity;
    const adjustSizes = s.adjustSizes;
    const hubDissuasion = s.outboundAttractionDistribution;
    const edgeWeightInfluence = s.edgeWeightInfluence;
    const linLog = s.linLogMode;
    let slowDown = s.slowDown;
    let theta = s.barnesHutTheta;
    const useBH = s.barnesHutOptimize;

    const fx = new Float64Array(n), fy = new Float64Array(n);
    const pfx = new Float64Array(n), pfy = new Float64Array(n);
    let globalSpeed = 1;
    const TOLERANCE = 0.1;

    // ── Barnes-Hut quadtree (index-based, mirrors the original object tree) ────
    function Region(cx, cy, sz) {
        this.cx = cx; this.cy = cy; this.size = sz;
        this.mass = 0; this.massCx = 0; this.massCy = 0;
        this.node = -1; this.q = null;
    }
    function getQ(reg, x, y) { return (x < reg.cx ? 0 : 1) + (y < reg.cy ? 0 : 2); }
    function subReg(reg, q) {
        const qs = reg.size / 4;
        const ox = [[-qs, -qs], [qs, -qs], [-qs, qs], [qs, qs]];
        return new Region(reg.cx + ox[q][0], reg.cy + ox[q][1], reg.size / 2);
    }
    function insert(reg, i) {
        const nm = mass[i], nx = xs[i], ny = ys[i];
        const oldM = reg.mass;
        reg.mass += nm;
        reg.massCx = (reg.massCx * oldM + nx * nm) / reg.mass;
        reg.massCy = (reg.massCy * oldM + ny * nm) / reg.mass;
        if (reg.node === -1 && reg.q === null) { reg.node = i; return; }
        if (reg.q === null) {
            const prev = reg.node;
            reg.node = -1;
            reg.q = [null, null, null, null];
            const pq = getQ(reg, xs[prev], ys[prev]);
            if (!reg.q[pq]) reg.q[pq] = subReg(reg, pq);
            insert(reg.q[pq], prev);
        }
        const cq = getQ(reg, nx, ny);
        if (!reg.q[cq]) reg.q[cq] = subReg(reg, cq);
        insert(reg.q[cq], i);
    }
    function repulse(reg, i) {
        if (reg.mass === 0) return;
        const dx = xs[i] - reg.massCx;
        const dy = ys[i] - reg.massCy;
        const d2 = dx * dx + dy * dy + 1;
        const d = Math.sqrt(d2);
        if (reg.q === null && reg.node === i) return;
        if (reg.q === null || reg.size / d < theta) {
            const minDist = adjustSizes ? (size[i] + 1) : 0;
            const ed = Math.max(d, minDist + 0.1);
            const f = scaling * mass[i] * reg.mass / (ed * ed);
            fx[i] += dx / d * f; fy[i] += dy / d * f;
            return;
        }
        for (let q = 0; q < 4; q++) {
            if (reg.q[q]) repulse(reg.q[q], i);
        }
    }

    // One ForceAtlas2 iteration. Returns the swing/traction ratio for convergence.
    function step() {
        fx.fill(0); fy.fill(0);

        // 1. Repulsion (Barnes-Hut or brute force)
        if (useBH) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < n; i++) {
                const x = xs[i], y = ys[i];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
            const sz = Math.max(maxX - minX, maxY - minY) * 1.2 + 1;
            const root = new Region((minX + maxX) / 2, (minY + maxY) / 2, sz);
            for (let i = 0; i < n; i++) insert(root, i);
            for (let i = 0; i < n; i++) repulse(root, i);
        } else {
            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    const dx = xs[i] - xs[j], dy = ys[i] - ys[j];
                    const d2 = dx * dx + dy * dy + 1;
                    const d = Math.sqrt(d2);
                    const minDist = adjustSizes ? (size[i] + size[j] + 1) : 0;
                    const ed = Math.max(d, minDist + 0.1);
                    const f = scaling * mass[i] * mass[j] / (ed * ed);
                    fx[i] += dx / d * f; fy[i] += dy / d * f;
                    fx[j] -= dx / d * f; fy[j] -= dy / d * f;
                }
            }
        }

        // 2. Edge attraction (with hub dissuasion)
        for (let k = 0; k < e; k++) {
            const si = esrc[k], ti = etgt[k];
            const dx = xs[ti] - xs[si];
            const dy = ys[ti] - ys[si];
            const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
            const weight = Math.pow(ew[k], edgeWeightInfluence);
            let f = linLog ? weight * Math.log(1 + d) / d : weight;
            if (hubDissuasion) f /= Math.max(outDeg[si], 1);
            fx[si] += dx / d * f * d; fy[si] += dy / d * f * d;
            fx[ti] -= dx / d * f * d; fy[ti] -= dy / d * f * d;
        }

        // 3. Gravity toward the center
        for (let i = 0; i < n; i++) {
            const d = Math.sqrt(xs[i] * xs[i] + ys[i] * ys[i]) + 0.1;
            const gf = gravity * mass[i];
            fx[i] -= xs[i] / d * gf;
            fy[i] -= ys[i] / d * gf;
        }

        // 4. Adaptive global speed (FA2 swing / traction)
        let gSwing = 0, gTraction = 0;
        for (let i = 0; i < n; i++) {
            const swx = fx[i] - pfx[i], swy = fy[i] - pfy[i];
            gSwing += mass[i] * Math.sqrt(swx * swx + swy * swy);
            gTraction += mass[i] * Math.sqrt(
                (fx[i] + pfx[i]) * (fx[i] + pfx[i]) + (fy[i] + pfy[i]) * (fy[i] + pfy[i])
            ) * 0.5;
        }
        if (gSwing > 0) {
            const targetSpeed = TOLERANCE * gTraction / gSwing;
            globalSpeed = Math.min(targetSpeed, globalSpeed * 1.05);
        }

        // 5. Integrate
        for (let i = 0; i < n; i++) {
            const swx = fx[i] - pfx[i], swy = fy[i] - pfy[i];
            const swing = Math.sqrt(swx * swx + swy * swy) + 1e-5;
            const spd = Math.min(globalSpeed, 0.5 / swing) / slowDown;
            xs[i] += fx[i] * spd;
            ys[i] += fy[i] * spd;
            pfx[i] = fx[i]; pfy[i] = fy[i];
        }

        return gTraction > 0 ? gSwing / gTraction : 0;
    }

    // One grid-based Noverlap iteration. Returns the number of overlapping pairs
    // that were pushed apart (0 ⇒ converged).
    const NO = s.noverlap;
    function noverlapStep() {
        const cell = NO.gridSize;
        const grid = new Map();
        for (let i = 0; i < n; i++) {
            const gk = Math.floor(xs[i] / cell) + ',' + Math.floor(ys[i] / cell);
            let a = grid.get(gk);
            if (!a) { a = []; grid.set(gk, a); }
            a.push(i);
        }
        let moved = 0;
        for (const entry of grid) {
            const parts = entry[0].split(',');
            const cx = +parts[0], cy = +parts[1];
            const cellArr = entry[1];
            const nearby = [];
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const nc = grid.get((cx + dx) + ',' + (cy + dy));
                    if (nc) for (let z = 0; z < nc.length; z++) nearby.push(nc[z]);
                }
            }
            for (let a = 0; a < cellArr.length; a++) {
                const i = cellArr[a];
                const ri = size[i] * NO.ratio + NO.margin;
                for (let b = 0; b < nearby.length; b++) {
                    const j = nearby[b];
                    if (j <= i) continue;
                    const rj = size[j] * NO.ratio + NO.margin;
                    const ddx = xs[i] - xs[j];
                    const ddy = ys[i] - ys[j];
                    const dist = Math.sqrt(ddx * ddx + ddy * ddy) + 0.01;
                    const minDist = (ri + rj) * NO.expansion;
                    if (dist < minDist) {
                        const push = (minDist - dist) / dist * 0.5;
                        xs[i] += ddx * push; ys[i] += ddy * push;
                        xs[j] -= ddx * push; ys[j] -= ddy * push;
                        moved++;
                    }
                }
            }
        }
        return moved;
    }

    return {
        n: n, xs: xs, ys: ys,
        step: step,
        noverlapStep: noverlapStep,
        setTheta: function (t) { theta = t; },
        setSlowDown: function (sd) { slowDown = sd; },
    };
}

// ── Worker harness ───────────────────────────────────────────────────────────
// Serialised into the Blob alongside `_gSimCreate`. Runs the staged schedule:
//   Stage A (coarse)  — high theta + larger slowDown, short budget → fast first
//                        paint (<~1s) of a usable layout.
//   Stage B (refine)  — adaptive theta/slowDown, runs to the convergence window.
//   Stage C (noverlap)— grid overlap removal; free here because it is off-thread.
// Positions stream back as transferable Float32Arrays at a size-matched cadence;
// buffers ping-pong via 'recycle' so neither side reallocates per frame.
function _gSimWorkerEntry() {
    let sim = null;
    let settings = null;
    let cadenceMs = 33;
    let running = false;
    let stopped = false;
    let iterCount = 0;
    const pool = [];

    function takeBuf() {
        const need = sim.n * 2;
        let b = pool.pop();
        if (!b || b.length !== need) b = new Float32Array(need);
        return b;
    }
    function packInto(buf) {
        const xs = sim.xs, ys = sim.ys, n = sim.n;
        for (let i = 0; i < n; i++) { buf[2 * i] = xs[i]; buf[2 * i + 1] = ys[i]; }
    }
    function postPositions(type) {
        const buf = takeBuf();
        packInto(buf);
        self.postMessage({ type: type, pos: buf, iter: iterCount }, [buf.buffer]);
    }

    self.onmessage = function (ev) {
        const m = ev.data;
        if (!m) return;
        if (m.type === 'init') {
            settings = m.settings;
            cadenceMs = m.cadenceMs || 33;
            sim = _gSimCreate({
                n: m.n, e: m.e,
                xs: m.xs, ys: m.ys, mass: m.mass, size: m.size, outDeg: m.outDeg,
                esrc: m.esrc, etgt: m.etgt, ew: m.ew,
                settings: m.settings,
            });
            running = true; stopped = false; iterCount = 0;
            runForce();
        } else if (m.type === 'recycle') {
            if (pool.length < 3 && m.buf) pool.push(new Float32Array(m.buf));
        } else if (m.type === 'cadence') {
            cadenceMs = m.ms || cadenceMs;
        } else if (m.type === 'stop') {
            running = false; stopped = true;
        }
    };

    function runForce() {
        const st = settings.stage;
        const maxIters = st.maxIters;
        let stage = 0; // 0 = coarse, 1 = refine
        let convergedCount = 0;
        sim.setTheta(st.coarseTheta);
        sim.setSlowDown(st.coarseSlowDown);
        let lastPost = self.performance ? self.performance.now() : 0;

        function now() { return self.performance ? self.performance.now() : lastPost; }

        function loop() {
            if (!running) { if (!stopped) runNoverlap(); return; }
            const sliceStart = now();
            while (running) {
                if (stage === 0 && iterCount >= st.stageAIters) {
                    stage = 1;
                    sim.setTheta(st.refineTheta);
                    sim.setSlowDown(st.refineSlowDown);
                    postPositions('tick');           // first paint after the coarse pass
                    lastPost = now();
                    break;
                }
                if (iterCount >= maxIters) { running = false; break; }
                const swingRatio = sim.step();
                iterCount++;
                if (stage === 1 && iterCount >= st.minIters) {
                    if (swingRatio < st.threshold) {
                        convergedCount++;
                        if (convergedCount >= st.window) { running = false; break; }
                    } else {
                        convergedCount = 0;
                    }
                }
                const t = now();
                if (t - lastPost >= cadenceMs) { postPositions('tick'); lastPost = t; break; }
                if (t - sliceStart >= 250) break; // yield so recycle/stop messages are seen
            }
            if (running) { setTimeout(loop, 0); return; }
            if (!stopped) runNoverlap();
        }

        function runNoverlap() {
            const NO = settings.stage.noverlap;
            let it = 0;
            function nloop() {
                if (stopped) return;
                let moved = 0;
                const sliceStart = now();
                while (it < NO.maxIterations) {
                    moved = sim.noverlapStep();
                    it++;
                    if (moved === 0) break;
                    if (now() - sliceStart >= cadenceMs) break;
                }
                if (it < NO.maxIterations && moved > 0) {
                    postPositions('tick');
                    setTimeout(nloop, 0);
                } else {
                    postPositions('done');
                }
            }
            nloop();
        }

        loop();
    }
}

// ── Blob worker factory ──────────────────────────────────────────────────────
let _gSimWorker = null;
let _gSimWorkerUrl = null;

function _galaxyBuildSimWorkerSource() {
    // Serialise the shared core + harness, then auto-invoke the harness.
    return "'use strict';\n" +
        _gSimCreate.toString() + '\n' +
        _gSimWorkerEntry.toString() + '\n' +
        '_gSimWorkerEntry();\n';
}

function _galaxyCreateSimWorker() {
    // Throws if workers / Blob URLs are unavailable (e.g. some file:// contexts);
    // the caller treats a throw as "use the main-thread fallback".
    const src = _galaxyBuildSimWorkerSource();
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    let worker;
    try {
        worker = new Worker(url);
    } catch (err) {
        URL.revokeObjectURL(url);
        throw err;
    }
    _gSimWorkerUrl = url;
    return worker;
}

function _galaxyStopSimWorker() {
    if (_gSimWorker) {
        try { _gSimWorker.postMessage({ type: 'stop' }); } catch (_) { }
        try { _gSimWorker.terminate(); } catch (_) { }
        _gSimWorker = null;
    }
    if (_gSimWorkerUrl) {
        try { URL.revokeObjectURL(_gSimWorkerUrl); } catch (_) { }
        _gSimWorkerUrl = null;
    }
}

// ── Graph → typed-array snapshot ─────────────────────────────────────────────
// Bakes per-node mass / size and per-edge weight (the values the main-thread
// engine computed inline) into transferable arrays, plus the full settings the
// simulation needs — including the staged schedule, so the worker harness does
// not depend on any helper beyond `_gSimCreate`.
function _galaxySnapshotGraphForSim() {
    const g = _gGraph;
    if (!g || g.order === 0) return null;
    const n = g.order;
    const keys = new Array(n);
    const idx = Object.create(null);
    const xs = new Float32Array(n), ys = new Float32Array(n);
    const mass = new Float32Array(n), size = new Float32Array(n);
    const outDeg = new Float32Array(n);
    let i = 0;
    g.forEachNode((key, attrs) => {
        keys[i] = key; idx[key] = i;
        xs[i] = attrs.x; ys[i] = attrs.y;
        mass[i] = _G_MASS[attrs._t] || 1;
        size[i] = attrs.size || 3;
        i++;
    });

    const m = g.size;
    const esrc = new Int32Array(m), etgt = new Int32Array(m), ew = new Float32Array(m);
    let ei = 0;
    g.forEachEdge((_e, eAttrs, src, tgt) => {
        const si = idx[src], ti = idx[tgt];
        if (si == null || ti == null) return;
        outDeg[si]++;
        esrc[ei] = si; etgt[ei] = ti;
        ew[ei] = (eAttrs.size || 1) * (_G_EDGE_TYPE_WEIGHT[eAttrs._t] || 0.5);
        ei++;
    });

    const base = _galaxyFA2Settings(n);
    const maxIters = _galaxyFA2IterationLimit(n);
    const convergence = _galaxyFA2ConvergenceSettings(n);
    const settings = Object.assign({}, base, {
        maxIters: maxIters,
        convergence: convergence,
        noverlap: _G_NOVERLAP,
        stage: {
            maxIters: maxIters,
            // Short coarse budget: ~18% of the iteration limit, clamped, so a
            // usable layout appears fast before the slower refine pass.
            stageAIters: Math.min(Math.max(120, Math.floor(maxIters * 0.18)), 400),
            coarseTheta: 0.9,
            coarseSlowDown: base.slowDown * 2,
            refineTheta: base.barnesHutTheta,
            refineSlowDown: base.slowDown,
            minIters: convergence.minIters || 500,
            threshold: convergence.threshold,
            window: convergence.window,
            noverlap: _G_NOVERLAP,
        },
    });

    return { n: n, e: ei, keys: keys, xs: xs, ys: ys, mass: mass, size: size, outDeg: outDeg, esrc: esrc, etgt: etgt, ew: ew, settings: settings };
}

// ── Main-thread worker driver ────────────────────────────────────────────────
// Resolves when the worker reports 'done' or when the layout is cancelled
// (_gLayoutToken changes). Throws if the worker cannot be created or errors —
// the caller then runs the main-thread fallback. Writes positions back to
// _gGraph and refreshes Sigma at the worker's (size-matched) cadence; only
// touches the DOM when the Galaxy is actually visible.
function _galaxyFA2RunWorker(token) {
    const snap = _galaxySnapshotGraphForSim();
    if (!snap || snap.n === 0) return Promise.resolve();

    const worker = _galaxyCreateSimWorker(); // may throw → fallback
    _gSimWorker = worker;

    const n = snap.n;
    const keys = snap.keys;
    const sigmaCadence = n > 5000 ? 200 : n > 3000 ? 120 : n > 1500 ? 50 : 33;
    const backgroundMode = typeof _galaxyIsBackgroundPriority === 'function' && _galaxyIsBackgroundPriority();
    const cadenceMs = backgroundMode ? 250 : sigmaCadence;

    return new Promise((resolve, reject) => {
        let settled = false;
        let pollId = 0;

        const cleanup = () => {
            if (pollId) { clearInterval(pollId); pollId = 0; }
            worker.onmessage = null;
            worker.onerror = null;
            if (_gSimWorker === worker) _galaxyStopSimWorker();
        };
        const done = (fn) => { if (settled) return; settled = true; cleanup(); fn(); };

        const writeBack = (pos) => {
            for (let i = 0; i < n; i++) {
                _gGraph.setNodeAttribute(keys[i], 'x', pos[2 * i]);
                _gGraph.setNodeAttribute(keys[i], 'y', pos[2 * i + 1]);
            }
        };

        worker.onmessage = (ev) => {
            const m = ev.data;
            if (!m) return;
            if (_gLayoutToken !== token) { done(resolve); return; }
            if (m.type !== 'tick' && m.type !== 'done') return;

            const isDone = m.type === 'done';
            const visible = !!_gSig && !!(typeof state !== 'undefined' && state && state.galaxyActive);
            if (isDone || visible) {
                writeBack(m.pos);
                if (_gSig && n <= 30000) _gSig.refresh();
            }
            if (isDone) {
                done(resolve);
            } else {
                // Ping-pong the buffer back so the worker reuses it.
                try { worker.postMessage({ type: 'recycle', buf: m.pos.buffer }, [m.pos.buffer]); } catch (_) { }
            }
        };
        worker.onerror = (err) => {
            done(() => reject((err && err.error) || new Error('galaxy sim worker error')));
        };

        // Watchdog: guarantees the promise settles on cancellation even if the
        // worker stops emitting messages (e.g. terminated by closeGalaxy).
        pollId = setInterval(() => {
            if (_gLayoutToken !== token) done(resolve);
        }, 120);

        worker.postMessage({
            type: 'init',
            n: snap.n, e: snap.e,
            xs: snap.xs, ys: snap.ys, mass: snap.mass, size: snap.size, outDeg: snap.outDeg,
            esrc: snap.esrc, etgt: snap.etgt, ew: snap.ew,
            settings: snap.settings,
            cadenceMs: cadenceMs,
        }, [
            snap.xs.buffer, snap.ys.buffer, snap.mass.buffer, snap.size.buffer, snap.outDeg.buffer,
            snap.esrc.buffer, snap.etgt.buffer, snap.ew.buffer,
        ]);
    });
}
