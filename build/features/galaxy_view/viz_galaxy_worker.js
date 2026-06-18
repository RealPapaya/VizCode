"use strict";
function _gSimCreate(P) {
  const n = P.n | 0;
  const e = P.e | 0;
  const xs = P.xs, ys = P.ys;
  const mass = P.mass, size = P.size;
  const outDeg = P.outDeg;
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
  function Region(cx, cy, sz) {
    this.cx = cx;
    this.cy = cy;
    this.size = sz;
    this.mass = 0;
    this.massCx = 0;
    this.massCy = 0;
    this.node = -1;
    this.q = null;
  }
  function getQ(reg, x, y) {
    return (x < reg.cx ? 0 : 1) + (y < reg.cy ? 0 : 2);
  }
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
    if (reg.node === -1 && reg.q === null) {
      reg.node = i;
      return;
    }
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
      const minDist = adjustSizes ? size[i] + 1 : 0;
      const ed = Math.max(d, minDist + 0.1);
      const f = scaling * mass[i] * reg.mass / (ed * ed);
      fx[i] += dx / d * f;
      fy[i] += dy / d * f;
      return;
    }
    for (let q = 0; q < 4; q++) {
      if (reg.q[q]) repulse(reg.q[q], i);
    }
  }
  function step() {
    fx.fill(0);
    fy.fill(0);
    if (useBH) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
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
          const minDist = adjustSizes ? size[i] + size[j] + 1 : 0;
          const ed = Math.max(d, minDist + 0.1);
          const f = scaling * mass[i] * mass[j] / (ed * ed);
          fx[i] += dx / d * f;
          fy[i] += dy / d * f;
          fx[j] -= dx / d * f;
          fy[j] -= dy / d * f;
        }
      }
    }
    for (let k = 0; k < e; k++) {
      const si = esrc[k], ti = etgt[k];
      const dx = xs[ti] - xs[si];
      const dy = ys[ti] - ys[si];
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const weight = Math.pow(ew[k], edgeWeightInfluence);
      let f = linLog ? weight * Math.log(1 + d) / d : weight;
      if (hubDissuasion) f /= Math.max(outDeg[si], 1);
      fx[si] += dx / d * f * d;
      fy[si] += dy / d * f * d;
      fx[ti] -= dx / d * f * d;
      fy[ti] -= dy / d * f * d;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(xs[i] * xs[i] + ys[i] * ys[i]) + 0.1;
      const gf = gravity * mass[i];
      fx[i] -= xs[i] / d * gf;
      fy[i] -= ys[i] / d * gf;
    }
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
    for (let i = 0; i < n; i++) {
      const swx = fx[i] - pfx[i], swy = fy[i] - pfy[i];
      const swing = Math.sqrt(swx * swx + swy * swy) + 1e-5;
      const spd = Math.min(globalSpeed, 0.5 / swing) / slowDown;
      xs[i] += fx[i] * spd;
      ys[i] += fy[i] * spd;
      pfx[i] = fx[i];
      pfy[i] = fy[i];
    }
    return gTraction > 0 ? gSwing / gTraction : 0;
  }
  const NO = s.noverlap;
  function noverlapStep() {
    const cell = NO.gridSize;
    const grid = /* @__PURE__ */ new Map();
    for (let i = 0; i < n; i++) {
      const gk = Math.floor(xs[i] / cell) + "," + Math.floor(ys[i] / cell);
      let a = grid.get(gk);
      if (!a) {
        a = [];
        grid.set(gk, a);
      }
      a.push(i);
    }
    let moved = 0;
    for (const entry of grid) {
      const parts = entry[0].split(",");
      const cx = +parts[0], cy = +parts[1];
      const cellArr = entry[1];
      const nearby = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nc = grid.get(cx + dx + "," + (cy + dy));
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
            xs[i] += ddx * push;
            ys[i] += ddy * push;
            xs[j] -= ddx * push;
            ys[j] -= ddy * push;
            moved++;
          }
        }
      }
    }
    return moved;
  }
  return {
    n,
    xs,
    ys,
    step,
    noverlapStep,
    setTheta: function(t) {
      theta = t;
    },
    setSlowDown: function(sd) {
      slowDown = sd;
    }
  };
}
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
    for (let i = 0; i < n; i++) {
      buf[2 * i] = xs[i];
      buf[2 * i + 1] = ys[i];
    }
  }
  function postPositions(type) {
    const buf = takeBuf();
    packInto(buf);
    self.postMessage({ type, pos: buf, iter: iterCount }, [buf.buffer]);
  }
  self.onmessage = function(ev) {
    const m = ev.data;
    if (!m) return;
    if (m.type === "init") {
      settings = m.settings;
      cadenceMs = m.cadenceMs || 33;
      sim = _gSimCreate({
        n: m.n,
        e: m.e,
        xs: m.xs,
        ys: m.ys,
        mass: m.mass,
        size: m.size,
        outDeg: m.outDeg,
        esrc: m.esrc,
        etgt: m.etgt,
        ew: m.ew,
        settings: m.settings
      });
      running = true;
      stopped = false;
      iterCount = 0;
      runForce();
    } else if (m.type === "recycle") {
      if (pool.length < 3 && m.buf) pool.push(new Float32Array(m.buf));
    } else if (m.type === "cadence") {
      cadenceMs = m.ms || cadenceMs;
    } else if (m.type === "stop") {
      running = false;
      stopped = true;
    }
  };
  function runForce() {
    const st = settings.stage;
    const maxIters = st.maxIters;
    let stage = 0;
    let convergedCount = 0;
    sim.setTheta(st.coarseTheta);
    sim.setSlowDown(st.coarseSlowDown);
    let lastPost = self.performance ? self.performance.now() : 0;
    function now() {
      return self.performance ? self.performance.now() : lastPost;
    }
    function loop() {
      if (!running) {
        if (!stopped) runNoverlap();
        return;
      }
      const sliceStart = now();
      while (running) {
        if (stage === 0 && iterCount >= st.stageAIters) {
          stage = 1;
          sim.setTheta(st.refineTheta);
          sim.setSlowDown(st.refineSlowDown);
          postPositions("tick");
          lastPost = now();
          break;
        }
        if (iterCount >= maxIters) {
          running = false;
          break;
        }
        const swingRatio = sim.step();
        iterCount++;
        if (stage === 1 && iterCount >= st.minIters) {
          if (swingRatio < st.threshold) {
            convergedCount++;
            if (convergedCount >= st.window) {
              running = false;
              break;
            }
          } else {
            convergedCount = 0;
          }
        }
        const t = now();
        if (t - lastPost >= cadenceMs) {
          postPositions("tick");
          lastPost = t;
          break;
        }
        if (t - sliceStart >= 250) break;
      }
      if (running) {
        setTimeout(loop, 0);
        return;
      }
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
          postPositions("tick");
          setTimeout(nloop, 0);
        } else {
          postPositions("done");
        }
      }
      nloop();
    }
    loop();
  }
}
let _gSimWorker = null;
let _gSimWorkerUrl = null;
function _galaxyBuildSimWorkerSource() {
  return "'use strict';\n" + _gSimCreate.toString() + "\n" + _gSimWorkerEntry.toString() + "\n_gSimWorkerEntry();\n";
}
function _galaxyCreateSimWorker() {
  const src = _galaxyBuildSimWorkerSource();
  const url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
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
    try {
      _gSimWorker.postMessage({ type: "stop" });
    } catch (_) {
    }
    try {
      _gSimWorker.terminate();
    } catch (_) {
    }
    _gSimWorker = null;
  }
  if (_gSimWorkerUrl) {
    try {
      URL.revokeObjectURL(_gSimWorkerUrl);
    } catch (_) {
    }
    _gSimWorkerUrl = null;
  }
}
function _galaxySnapshotGraphForSim() {
  const g = _gGraph;
  if (!g || g.order === 0) return null;
  const n = g.order;
  const keys = new Array(n);
  const idx = /* @__PURE__ */ Object.create(null);
  const xs = new Float32Array(n), ys = new Float32Array(n);
  const mass = new Float32Array(n), size = new Float32Array(n);
  const outDeg = new Float32Array(n);
  let i = 0;
  g.forEachNode((key, attrs) => {
    keys[i] = key;
    idx[key] = i;
    xs[i] = attrs.x;
    ys[i] = attrs.y;
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
    esrc[ei] = si;
    etgt[ei] = ti;
    ew[ei] = (eAttrs.size || 1) * (_G_EDGE_TYPE_WEIGHT[eAttrs._t] || 0.5);
    ei++;
  });
  const base = _galaxyFA2Settings(n);
  const maxIters = _galaxyFA2IterationLimit(n);
  const convergence = _galaxyFA2ConvergenceSettings(n);
  const settings = Object.assign({}, base, {
    maxIters,
    convergence,
    noverlap: _G_NOVERLAP,
    stage: {
      maxIters,
      // Coarse budget: ~22% of the iteration limit, clamped. With the compact
      // seed this stage IS the supernova bloom, so give it enough room to play.
      stageAIters: Math.min(Math.max(160, Math.floor(maxIters * 0.22)), 500),
      coarseTheta: 0.9,
      // Energetic coarse pass (was base·2, which muted the explosion): from a
      // compact seed we want nodes to visibly burst outward, not crawl.
      coarseSlowDown: base.slowDown * 0.8,
      refineTheta: base.barnesHutTheta,
      refineSlowDown: base.slowDown,
      minIters: convergence.minIters || 500,
      threshold: convergence.threshold,
      window: convergence.window,
      noverlap: _G_NOVERLAP
    }
  });
  return { n, e: ei, keys, xs, ys, mass, size, outDeg, esrc, etgt, ew, settings };
}
function _galaxyFA2RunWorker(token) {
  const snap = _galaxySnapshotGraphForSim();
  if (!snap || snap.n === 0) return Promise.resolve();
  const worker = _galaxyCreateSimWorker();
  _gSimWorker = worker;
  const n = snap.n;
  const e = snap.e;
  const backgroundMode = typeof _galaxyIsBackgroundPriority === "function" && _galaxyIsBackgroundPriority();
  const heavy = n > 8e3 || e > 16e3;
  const medium = n > 3e3 || e > 6e3;
  const cadenceMs = backgroundMode ? 250 : heavy ? 90 : medium ? 55 : 33;
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollId = 0;
    let pendingPos = null;
    let rafScheduled = false;
    const recycle = (buf) => {
      try {
        worker.postMessage({ type: "recycle", buf }, [buf]);
      } catch (_) {
      }
    };
    const cleanup = () => {
      if (pollId) {
        clearInterval(pollId);
        pollId = 0;
      }
      pendingPos = null;
      worker.onmessage = null;
      worker.onerror = null;
      if (_gSimWorker === worker) _galaxyStopSimWorker();
    };
    const done = (fn) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const bulkWrite = (pos) => {
      let i = 0;
      _gGraph.updateEachNodeAttributes((node, attr) => {
        attr.x = pos[2 * i];
        attr.y = pos[2 * i + 1];
        i++;
        return attr;
      }, { attributes: ["x", "y"] });
    };
    const renderFrame = () => {
      rafScheduled = false;
      const pos = pendingPos;
      pendingPos = null;
      if (!pos) return;
      if (_gLayoutToken !== token) {
        recycle(pos.buffer);
        done(resolve);
        return;
      }
      const visible = !!_gSig && !!(typeof state !== "undefined" && state && state.galaxyActive);
      if (visible) {
        bulkWrite(pos);
        if (n <= 3e4) _gSig.refresh();
      }
      recycle(pos.buffer);
    };
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (!m) return;
      if (_gLayoutToken !== token) {
        done(resolve);
        return;
      }
      if (m.type === "done") {
        if (pendingPos) {
          recycle(pendingPos.buffer);
          pendingPos = null;
        }
        bulkWrite(m.pos);
        done(resolve);
        return;
      }
      if (m.type !== "tick") return;
      if (pendingPos) recycle(pendingPos.buffer);
      pendingPos = m.pos;
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(renderFrame);
      }
    };
    worker.onerror = (err) => {
      done(() => reject(err && err.error || new Error("galaxy sim worker error")));
    };
    pollId = setInterval(() => {
      if (_gLayoutToken !== token) done(resolve);
    }, 120);
    worker.postMessage({
      type: "init",
      n: snap.n,
      e: snap.e,
      xs: snap.xs,
      ys: snap.ys,
      mass: snap.mass,
      size: snap.size,
      outDeg: snap.outDeg,
      esrc: snap.esrc,
      etgt: snap.etgt,
      ew: snap.ew,
      settings: snap.settings,
      cadenceMs
    }, [
      snap.xs.buffer,
      snap.ys.buffer,
      snap.mass.buffer,
      snap.size.buffer,
      snap.outDeg.buffer,
      snap.esrc.buffer,
      snap.etgt.buffer,
      snap.ew.buffer
    ]);
  });
}
