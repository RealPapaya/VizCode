"use strict";
let _overviewSankeyResizeObserver = null;
let _overviewSankeyResizeTimer = null;
let _overviewSankeyStack = [{ level: "module" }];
let _overviewSankeyViewport = { x: 0, y: 0, k: 1 };
let _overviewSankeyWorld = { w: 0, h: 0 };
let _overviewSankeyDrag = null;
let _overviewSankeySuppressClick = false;
let _overviewSankeySelectedId = "";
let _overviewSankeyLastLayout = null;
const _OVERVIEW_SANKEY_MIN_ZOOM = 0.4;
const _OVERVIEW_SANKEY_MAX_ZOOM = 6;
const _OVERVIEW_SANKEY_TOP_MODULES = 15;
const _OVERVIEW_SANKEY_MAX_SIDE_NODES = 24;
const _OVERVIEW_SANKEY_NODE_W = 14;
const _OVERVIEW_SANKEY_NODE_GAP = 6;
const _OVERVIEW_SANKEY_LABEL_W = 190;
const _OVERVIEW_SANKEY_MIN_NODE_H = 4;
const _OVERVIEW_SANKEY_PAD = 14;
const _OVERVIEW_SANKEY_OTHERS = "__others__";
const _OVERVIEW_SANKEY_GRAY = "#64748b";
const _OVERVIEW_SANKEY_SVG_NS = "http://www.w3.org/2000/svg";
function _sankeyModuleLabel(modId) {
  const mod = (window.DATA?.modules || []).find((m) => m.id === modId);
  return mod?.label || modId;
}
function _sankeyModuleColor(modId) {
  const mod = (window.DATA?.modules || []).find((m) => m.id === modId);
  return mod?.color || _OVERVIEW_SANKEY_GRAY;
}
function _sankeyAddFlow(counts, s, t) {
  const key = `${s}\0${t}`;
  counts.set(key, (counts.get(key) || 0) + 1);
}
function _sankeyFlowsToLinks(counts) {
  return Array.from(counts.entries()).map(([key, w]) => {
    const [s, t] = key.split("\0");
    return { s, t, w };
  });
}
function _sankeyBuildModuleFlows() {
  const counts = /* @__PURE__ */ new Map();
  Object.values(window.DATA?.file_edges_by_module || {}).forEach((edges) => {
    (edges || []).forEach((e) => {
      const sMod = _fileIdToModule[e.s];
      const tMod = _fileIdToModule[e.t];
      if (!sMod || !tMod || sMod === tMod) return;
      _sankeyAddFlow(counts, sMod, tMod);
    });
  });
  const totals = /* @__PURE__ */ new Map();
  counts.forEach((w, key) => {
    const [s, t] = key.split("\0");
    totals.set(s, (totals.get(s) || 0) + w);
    totals.set(t, (totals.get(t) || 0) + w);
  });
  const ranked = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  const kept = new Set(ranked.slice(0, _OVERVIEW_SANKEY_TOP_MODULES).map(([id]) => id));
  const folded = ranked.slice(_OVERVIEW_SANKEY_TOP_MODULES).map(([id]) => _sankeyModuleLabel(id));
  const merged = /* @__PURE__ */ new Map();
  counts.forEach((w, key) => {
    let [s, t] = key.split("\0");
    if (!kept.has(s)) s = _OVERVIEW_SANKEY_OTHERS;
    if (!kept.has(t)) t = _OVERVIEW_SANKEY_OTHERS;
    const k = `${s}\0${t}`;
    merged.set(k, (merged.get(k) || 0) + w);
  });
  const nodes = /* @__PURE__ */ new Map();
  kept.forEach((id) => nodes.set(id, {
    label: _sankeyModuleLabel(id),
    color: _sankeyModuleColor(id),
    title: _sankeyModuleLabel(id),
    drill: { level: "file", module: id }
  }));
  if (folded.length) {
    nodes.set(_OVERVIEW_SANKEY_OTHERS, {
      label: `${T("sankeyOthers")} (${folded.length})`,
      color: _OVERVIEW_SANKEY_GRAY,
      gray: true,
      title: folded.join(", ")
    });
  }
  return { nodes, links: _sankeyFlowsToLinks(merged), unit: T("sankeyUnitDeps") };
}
function _sankeyBuildFileFlows(modId) {
  const counts = /* @__PURE__ */ new Map();
  const nodes = /* @__PURE__ */ new Map();
  const color = _sankeyModuleColor(modId);
  const fileNode = (fid) => {
    const file = _fileIdToFile[fid];
    if (!file?.path) return null;
    const id = `f:${file.path}`;
    if (!nodes.has(id)) {
      nodes.set(id, {
        label: file.label || file.path.split("/").pop(),
        color,
        title: file.path,
        drill: { level: "func", module: modId, file: file.path }
      });
    }
    return id;
  };
  const boundaryNode = (prefix, mod, arrow) => {
    const id = `${prefix}:${mod}`;
    if (!nodes.has(id)) {
      nodes.set(id, {
        label: `${arrow} ${_sankeyModuleLabel(mod)}`,
        color: _OVERVIEW_SANKEY_GRAY,
        gray: true,
        title: _sankeyModuleLabel(mod)
      });
    }
    return id;
  };
  Object.values(window.DATA?.file_edges_by_module || {}).forEach((edges) => {
    (edges || []).forEach((e) => {
      const sMod = _fileIdToModule[e.s];
      const tMod = _fileIdToModule[e.t];
      if (sMod !== modId && tMod !== modId) return;
      const sId = sMod === modId ? fileNode(e.s) : boundaryNode("in", sMod, "\u21E0");
      const tId = tMod === modId ? fileNode(e.t) : boundaryNode("out", tMod, "\u21E2");
      if (!sId || !tId || sId === tId) return;
      _sankeyAddFlow(counts, sId, tId);
    });
  });
  _sankeyFoldSides(counts, nodes);
  return { nodes, links: _sankeyFlowsToLinks(counts), unit: T("sankeyUnitDeps") };
}
function _sankeyBuildFuncFlows(fileRel, modId) {
  const counts = /* @__PURE__ */ new Map();
  const nodes = /* @__PURE__ */ new Map();
  const color = _sankeyModuleColor(modId);
  const funcs = window.DATA?.funcs_by_file?.[fileRel] || [];
  const fidMap = /* @__PURE__ */ new Map();
  funcs.forEach((f, i) => fidMap.set(f.label, i));
  const fnNode = (idx) => {
    const id = `fn:${idx}`;
    if (!nodes.has(id)) nodes.set(id, {
      label: funcs[idx].label,
      color,
      title: funcs[idx].label,
      // Clicking a function node highlights its code section (no drill-down).
      highlight: { file: fileRel, func: funcs[idx].label }
    });
    return id;
  };
  const extNode = (id, label, title) => {
    if (!nodes.has(id)) nodes.set(id, { label, color: _OVERVIEW_SANKEY_GRAY, gray: true, title });
    return id;
  };
  const callList = window.DATA?.func_calls_by_file?.[fileRel];
  if (Array.isArray(callList) && callList.length) {
    const nameToFile = window.DATA?.func_name_to_file || {};
    const nameToFiles = window.DATA?.func_name_to_files || {};
    const knownCats = window.DATA?.func_known_categories || {};
    funcs.forEach((f, i) => {
      const calls = Array.isArray(callList[i]) ? callList[i] : [];
      calls.forEach((callee) => {
        const idx = fidMap.get(callee);
        let tId = null;
        if (idx != null) {
          if (idx === i) return;
          tId = fnNode(idx);
        } else if (Object.prototype.hasOwnProperty.call(nameToFile, callee)) {
          const target = nameToFile[callee];
          tId = extNode(`ext:${target}`, `\u21E2 ${target.split("/").pop()}`, target);
        } else if (Object.prototype.hasOwnProperty.call(nameToFiles, callee)) {
          tId = extNode(`amb:${callee}`, `${callee} ?`, (nameToFiles[callee] || []).join(", "));
        } else if (knownCats[callee]) {
          tId = extNode(`sys:${knownCats[callee]}`, knownCats[callee], knownCats[callee]);
        }
        if (tId) _sankeyAddFlow(counts, fnNode(i), tId);
      });
    });
  } else {
    (window.DATA?.func_edges_by_file?.[fileRel] || []).forEach((e) => {
      if (e.s === e.t || !funcs[e.s] || !funcs[e.t]) return;
      _sankeyAddFlow(counts, fnNode(e.s), fnNode(e.t));
    });
  }
  _sankeyFoldSides(counts, nodes);
  return { nodes, links: _sankeyFlowsToLinks(counts), unit: T("sankeyUnitCalls") };
}
function _sankeyFoldSides(counts, nodes) {
  const outT = /* @__PURE__ */ new Map();
  const inT = /* @__PURE__ */ new Map();
  counts.forEach((w, key) => {
    const [s, t] = key.split("\0");
    outT.set(s, (outT.get(s) || 0) + w);
    inT.set(t, (inT.get(t) || 0) + w);
  });
  const keep = (totals) => new Set(Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, _OVERVIEW_SANKEY_MAX_SIDE_NODES).map(([id]) => id));
  const keptL = keep(outT);
  const keptR = keep(inT);
  if (keptL.size >= outT.size && keptR.size >= inT.size) return;
  const merged = /* @__PURE__ */ new Map();
  let foldedAny = false;
  counts.forEach((w, key) => {
    let [s, t] = key.split("\0");
    if (!keptL.has(s)) {
      s = _OVERVIEW_SANKEY_OTHERS;
      foldedAny = true;
    }
    if (!keptR.has(t)) {
      t = _OVERVIEW_SANKEY_OTHERS;
      foldedAny = true;
    }
    const k = `${s}\0${t}`;
    merged.set(k, (merged.get(k) || 0) + w);
  });
  counts.clear();
  merged.forEach((w, key) => counts.set(key, w));
  if (foldedAny && !nodes.has(_OVERVIEW_SANKEY_OTHERS)) {
    nodes.set(_OVERVIEW_SANKEY_OTHERS, {
      label: T("sankeyOthers"),
      color: _OVERVIEW_SANKEY_GRAY,
      gray: true,
      title: T("sankeyOthers")
    });
  }
}
function _sankeyBuildModel(frame) {
  try {
    if (frame.level === "file") return _sankeyBuildFileFlows(frame.module);
    if (frame.level === "func") return _sankeyBuildFuncFlows(frame.file, frame.module);
    return _sankeyBuildModuleFlows();
  } catch (e) {
    console.error("[sankey]", e);
    return { nodes: /* @__PURE__ */ new Map(), links: [], unit: "" };
  }
}
function _sankeyFrameTitle(frame) {
  if (frame.level === "file") return T("sankeyLevelFiles", { name: _sankeyModuleLabel(frame.module) });
  if (frame.level === "func") return T("sankeyLevelFuncs", { name: frame.file.split("/").pop() });
  return T("sankeyLevelModules");
}
function _sankeyLayout(model, w, h) {
  const outT = /* @__PURE__ */ new Map();
  const inT = /* @__PURE__ */ new Map();
  model.links.forEach((l) => {
    outT.set(l.s, (outT.get(l.s) || 0) + l.w);
    inT.set(l.t, (inT.get(l.t) || 0) + l.w);
  });
  const order = (totals) => Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  const left = order(outT);
  const right = order(inT);
  const sum = (list) => list.reduce((acc, [, v]) => acc + v, 0);
  const gapsFor = (list) => Math.max(0, list.length - 1) * _OVERVIEW_SANKEY_NODE_GAP;
  const avail = Math.max(120, h - _OVERVIEW_SANKEY_PAD * 2);
  const scale = Math.max(
    1e-4,
    (avail - Math.max(gapsFor(left), gapsFor(right))) / Math.max(1, sum(left), sum(right))
  );
  const place = (list, x) => {
    const placed = /* @__PURE__ */ new Map();
    let y = _OVERVIEW_SANKEY_PAD;
    list.forEach(([id, total]) => {
      const nodeH = Math.max(_OVERVIEW_SANKEY_MIN_NODE_H, total * scale);
      placed.set(id, { id, x, y, h: nodeH, total, used: 0 });
      y += nodeH + _OVERVIEW_SANKEY_NODE_GAP;
    });
    return { placed, bottom: y };
  };
  const x0 = _OVERVIEW_SANKEY_PAD + _OVERVIEW_SANKEY_LABEL_W;
  const x1 = Math.max(x0 + 120, w - _OVERVIEW_SANKEY_PAD - _OVERVIEW_SANKEY_LABEL_W - _OVERVIEW_SANKEY_NODE_W);
  const L = place(left, x0);
  const R = place(right, x1);
  const links = model.links.slice().sort((a, b) => L.placed.get(a.s).y - L.placed.get(b.s).y || R.placed.get(a.t).y - R.placed.get(b.t).y);
  const ribbons = links.map((l) => {
    const s = L.placed.get(l.s);
    const t = R.placed.get(l.t);
    const sh = l.w / s.total * s.h;
    const th = l.w / t.total * t.h;
    const r = { s: l.s, t: l.t, w: l.w, sy0: s.y + s.used, ty0: t.y + t.used };
    r.sy1 = r.sy0 + sh;
    r.ty1 = r.ty0 + th;
    s.used += sh;
    t.used += th;
    return r;
  });
  return { left: L.placed, right: R.placed, ribbons, x0, x1, height: Math.max(L.bottom, R.bottom) + _OVERVIEW_SANKEY_PAD };
}
function _sankeyGrid() {
  return document.querySelector("#overview-sankey-host .overview-sankey-grid");
}
function _sankeyClampViewport() {
  const grid = _sankeyGrid();
  if (!grid) return;
  const vw = grid.clientWidth || 1;
  const vh = grid.clientHeight || 1;
  const worldW = Math.max(1, _overviewSankeyWorld.w * _overviewSankeyViewport.k);
  const worldH = Math.max(1, _overviewSankeyWorld.h * _overviewSankeyViewport.k);
  const slack = Math.max(96, Math.min(vw, vh) * 0.72);
  const minX = Math.min(0, vw - worldW) - slack;
  const maxX = Math.max(0, vw - worldW) + slack;
  const minY = Math.min(0, vh - worldH) - slack;
  const maxY = Math.max(0, vh - worldH) + slack;
  _overviewSankeyViewport.x = Math.min(maxX, Math.max(minX, _overviewSankeyViewport.x));
  _overviewSankeyViewport.y = Math.min(maxY, Math.max(minY, _overviewSankeyViewport.y));
}
function _sankeyApplyTransform() {
  const canvas = document.querySelector("#overview-sankey-host .overview-sankey-canvas");
  if (!canvas) return;
  _sankeyClampViewport();
  canvas.style.transform = `translate(${_overviewSankeyViewport.x}px, ${_overviewSankeyViewport.y}px) scale(${_overviewSankeyViewport.k})`;
}
function _sankeyZoomAt(clientX, clientY, nextK) {
  const grid = _sankeyGrid();
  if (!grid) return;
  const rect = grid.getBoundingClientRect();
  const k = Math.max(_OVERVIEW_SANKEY_MIN_ZOOM, Math.min(_OVERVIEW_SANKEY_MAX_ZOOM, nextK));
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const wx = (px - _overviewSankeyViewport.x) / _overviewSankeyViewport.k;
  const wy = (py - _overviewSankeyViewport.y) / _overviewSankeyViewport.k;
  _overviewSankeyViewport.x = px - wx * k;
  _overviewSankeyViewport.y = py - wy * k;
  _overviewSankeyViewport.k = k;
  _sankeyApplyTransform();
}
function _sankeyResetViewport() {
  _overviewSankeyViewport = { x: 0, y: 0, k: 1 };
  _sankeyApplyTransform();
}
function _sankeyCenterEntry(entry, animated = true) {
  const grid = _sankeyGrid();
  const canvas = document.querySelector("#overview-sankey-host .overview-sankey-canvas");
  if (!grid || !canvas || !entry) return;
  const k = Math.max(1, Math.min(2.4, _overviewSankeyViewport.k || 1));
  _overviewSankeyViewport.k = k;
  _overviewSankeyViewport.x = (grid.clientWidth || 0) / 2 - (entry.x + _OVERVIEW_SANKEY_NODE_W / 2) * k;
  _overviewSankeyViewport.y = (grid.clientHeight || 0) / 2 - (entry.y + entry.h / 2) * k;
  canvas.classList.toggle("is-animating", !!animated);
  _sankeyApplyTransform();
  if (animated) setTimeout(() => canvas.classList.remove("is-animating"), 220);
}
function _sankeyInstallInteractions(grid) {
  if (!grid || grid.dataset.sankeyBound === "1") return;
  grid.dataset.sankeyBound = "1";
  grid.addEventListener("wheel", (event) => {
    if (_overviewMode !== "sankey") return;
    event.preventDefault();
    const buttonFactor = window.GRAPH_ZOOM_SETTINGS?.buttonFactor || 1.12;
    const factor = event.deltaY < 0 ? buttonFactor : 1 / buttonFactor;
    _sankeyZoomAt(event.clientX, event.clientY, _overviewSankeyViewport.k * factor);
    if (typeof refreshGraphZoomControls === "function") refreshGraphZoomControls();
  }, { passive: false });
  grid.addEventListener("pointerdown", (event) => {
    if (_overviewMode !== "sankey" || event.button !== 0) return;
    _overviewSankeyDrag = { id: event.pointerId, sx: event.clientX, sy: event.clientY, x: _overviewSankeyViewport.x, y: _overviewSankeyViewport.y, moved: false, captured: false };
  });
  grid.addEventListener("pointermove", (event) => {
    const drag = _overviewSankeyDrag;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.sx;
    const dy = event.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (!drag.captured) {
      grid.setPointerCapture?.(event.pointerId);
      drag.captured = true;
    }
    event.preventDefault();
    grid.classList.add("dragging");
    _overviewSankeyViewport.x = drag.x + dx;
    _overviewSankeyViewport.y = drag.y + dy;
    _sankeyApplyTransform();
  });
  const finishDrag = (event) => {
    const drag = _overviewSankeyDrag;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.captured) grid.releasePointerCapture?.(event.pointerId);
    grid.classList.remove("dragging");
    _overviewSankeyDrag = null;
    if (drag.moved) {
      _overviewSankeySuppressClick = true;
      setTimeout(() => {
        _overviewSankeySuppressClick = false;
      }, 0);
    }
  };
  grid.addEventListener("pointerup", finishDrag);
  grid.addEventListener("pointercancel", finishDrag);
  grid.addEventListener("dblclick", (event) => {
    event.preventDefault();
    _sankeyResetViewport();
    if (typeof refreshGraphZoomControls === "function") refreshGraphZoomControls();
  });
}
function _sankeySvgEl(tag, attrs) {
  const el = document.createElementNS(_OVERVIEW_SANKEY_SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
}
function _sankeyTooltip(html, color, event) {
  const { container } = _overviewEnsureHosts();
  if (!container) return;
  if (!_gTooltipEl) {
    _gTooltipEl = document.createElement("div");
    _gTooltipEl.className = "galaxy-tooltip";
    container.appendChild(_gTooltipEl);
  }
  _gTooltipEl.innerHTML = html;
  _gTooltipEl.style.display = "block";
  _gTooltipEl.style.borderColor = color;
  const bounds = container.getBoundingClientRect();
  const pad = 10;
  const width = _gTooltipEl.offsetWidth || 0;
  const height = _gTooltipEl.offsetHeight || 0;
  const lx = Math.min(Math.max(event.clientX - bounds.left + 14, pad), Math.max(pad, container.clientWidth - width - pad));
  const ty = Math.min(Math.max(event.clientY - bounds.top + 14, pad), Math.max(pad, container.clientHeight - height - pad));
  _gTooltipEl.style.left = `${lx}px`;
  _gTooltipEl.style.top = `${ty}px`;
}
function _sankeyNodeTooltip(meta, entry, side, model, event) {
  const flow = T(side === "left" ? "sankeyOutflow" : "sankeyInflow", { n: entry.total, unit: model.unit });
  _sankeyTooltip(
    `<div class="gt-name" style="color:${meta.gray ? "var(--text)" : meta.color}">${_gEsc(meta.label)}</div><div class="gt-loc">${_gEsc(meta.title || "")}</div><div class="gt-degree">${_gEsc(flow)}</div>`,
    meta.color,
    event
  );
}
function _sankeyRibbonTooltip(r, model, event) {
  const sMeta = model.nodes.get(r.s);
  const tMeta = model.nodes.get(r.t);
  _sankeyTooltip(
    `<div class="gt-name">${_gEsc(sMeta?.label || r.s)} \u2192 ${_gEsc(tMeta?.label || r.t)}</div><div class="gt-degree">${r.w} ${_gEsc(model.unit)}</div>`,
    sMeta?.color || _OVERVIEW_SANKEY_GRAY,
    event
  );
}
function _sankeySyncExplorer(drill) {
  if (!drill) return;
  if (drill.level === "func" && drill.file) {
    if (typeof revealSidebarExplorerPath === "function") revealSidebarExplorerPath(drill.file, "file");
    if (typeof updateCallGraphBtn === "function") updateCallGraphBtn(drill.file);
  } else if (drill.level === "file" && drill.module) {
    if (typeof setSidebarActive === "function") setSidebarActive(drill.module);
  }
}
function _sankeyRenderNodes(svg, placed, side, model) {
  placed.forEach((entry) => {
    const meta = model.nodes.get(entry.id) || { label: entry.id, color: _OVERVIEW_SANKEY_GRAY };
    const isActive = entry.id === _overviewSankeySelectedId;
    const g = _sankeySvgEl("g", { class: `overview-sankey-node${meta.drill ? " drillable" : ""}${meta.highlight ? " selectable" : ""}${meta.gray ? " gray" : ""}${isActive ? " active" : ""}` });
    g.appendChild(_sankeySvgEl("rect", {
      x: entry.x,
      y: entry.y,
      width: _OVERVIEW_SANKEY_NODE_W,
      height: entry.h,
      rx: 2,
      fill: meta.color
    }));
    const label = _sankeySvgEl("text", {
      x: side === "left" ? entry.x - 8 : entry.x + _OVERVIEW_SANKEY_NODE_W + 8,
      y: entry.y + entry.h / 2,
      "text-anchor": side === "left" ? "end" : "start",
      "dominant-baseline": "central",
      class: "overview-sankey-label"
    });
    const text = String(meta.label || "");
    label.textContent = text.length > 26 ? `${text.slice(0, 25)}\u2026` : text;
    g.appendChild(label);
    g.addEventListener("mouseenter", (e) => _sankeyNodeTooltip(meta, entry, side, model, e));
    g.addEventListener("mousemove", (e) => _sankeyNodeTooltip(meta, entry, side, model, e));
    g.addEventListener("mouseleave", _galaxyHideTooltip);
    if (meta.drill) {
      g.addEventListener("click", () => {
        if (_overviewSankeySuppressClick) return;
        _galaxyHideTooltip();
        _sankeySyncExplorer(meta.drill);
        _overviewSankeySelectedId = "";
        _overviewSankeyStack.push(meta.drill);
        _overviewSankeyViewport = { x: 0, y: 0, k: 1 };
        _overviewRenderSankey();
      });
    } else if (meta.highlight) {
      g.addEventListener("click", () => {
        if (_overviewSankeySuppressClick) return;
        _galaxyHideTooltip();
        _overviewSankeySelectedId = entry.id;
        if (typeof revealSidebarExplorerPath === "function") revealSidebarExplorerPath(meta.highlight.file, "file");
        if (typeof updateCallGraphBtn === "function") updateCallGraphBtn(meta.highlight.file);
        if (typeof loadFileInPanel === "function") loadFileInPanel(meta.highlight.file, meta.highlight.func);
        _overviewRenderSankey();
      });
    }
    svg.appendChild(g);
  });
}
function _sankeyRenderRibbons(svg, layout, model) {
  const sx = layout.x0 + _OVERVIEW_SANKEY_NODE_W;
  const mx = (sx + layout.x1) / 2;
  layout.ribbons.forEach((r) => {
    const sMeta = model.nodes.get(r.s);
    const d = `M ${sx} ${r.sy0} C ${mx} ${r.sy0}, ${mx} ${r.ty0}, ${layout.x1} ${r.ty0} L ${layout.x1} ${r.ty1} C ${mx} ${r.ty1}, ${mx} ${r.sy1}, ${sx} ${r.sy1} Z`;
    const path = _sankeySvgEl("path", {
      d,
      fill: sMeta?.color || _OVERVIEW_SANKEY_GRAY,
      class: "overview-sankey-ribbon"
    });
    path.addEventListener("mouseenter", (e) => _sankeyRibbonTooltip(r, model, e));
    path.addEventListener("mousemove", (e) => _sankeyRibbonTooltip(r, model, e));
    path.addEventListener("mouseleave", _galaxyHideTooltip);
    svg.appendChild(path);
  });
}
function _sankeyRenderHeader(host) {
  const header = document.createElement("div");
  header.className = "overview-sankey-header";
  if (_overviewSankeyStack.length > 1) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "overview-sankey-back";
    back.textContent = `\u2190 ${T("sankeyBack")}`;
    back.addEventListener("click", () => {
      _galaxyHideTooltip();
      _overviewSankeySelectedId = "";
      _overviewSankeyStack.pop();
      _overviewSankeyViewport = { x: 0, y: 0, k: 1 };
      _overviewRenderSankey();
    });
    header.appendChild(back);
  }
  const crumb = document.createElement("span");
  crumb.className = "overview-sankey-crumb";
  crumb.textContent = _overviewSankeyStack.map(_sankeyFrameTitle).join("  \u203A  ");
  header.appendChild(crumb);
  host.appendChild(header);
  return header;
}
function _overviewRenderSankey() {
  const host = document.getElementById("overview-sankey-host");
  if (!host || _overviewMode !== "sankey") return;
  host.innerHTML = "";
  _sankeyRenderHeader(host);
  const body = document.createElement("div");
  body.className = "overview-sankey-body";
  host.appendChild(body);
  const frame = _overviewSankeyStack[_overviewSankeyStack.length - 1];
  const model = _sankeyBuildModel(frame);
  if (!model.links.length) {
    _overviewSankeyLastLayout = null;
    const empty = document.createElement("div");
    empty.className = "overview-sankey-empty";
    empty.textContent = T("sankeyNoFlows");
    body.appendChild(empty);
    return;
  }
  const grid = document.createElement("div");
  grid.className = "overview-sankey-grid";
  const canvas = document.createElement("div");
  canvas.className = "overview-sankey-canvas";
  grid.appendChild(canvas);
  body.appendChild(grid);
  const w = Math.max(420, grid.clientWidth || body.clientWidth || host.clientWidth || 800);
  const h = Math.max(220, grid.clientHeight || body.clientHeight || 480);
  const layout = _sankeyLayout(model, w, h);
  _overviewSankeyLastLayout = layout;
  const svgH = Math.max(h, layout.height);
  _overviewSankeyWorld = { w, h: svgH };
  canvas.style.width = `${w}px`;
  canvas.style.height = `${svgH}px`;
  const svg = _sankeySvgEl("svg", {
    width: w,
    height: svgH,
    viewBox: `0 0 ${w} ${svgH}`,
    class: "overview-sankey-svg"
  });
  _sankeyRenderRibbons(svg, layout, model);
  _sankeyRenderNodes(svg, layout.left, "left", model);
  _sankeyRenderNodes(svg, layout.right, "right", model);
  canvas.appendChild(svg);
  _sankeyInstallInteractions(grid);
  _sankeyApplyTransform();
}
function _overviewSankeyDisableFilterPanel() {
  const wrap = document.getElementById("sb-body-filters");
  if (wrap && _gFilterPanelSaved === null) _gFilterPanelSaved = wrap.innerHTML;
  if (wrap) {
    wrap.innerHTML = '<div id="filters-title" data-i18n="filters">Filters</div><div class="ft-filter-placeholder">Sankey uses Explorer and Search for file selection.</div>';
  }
  if (typeof _sbActiveTab !== "undefined" && _sbActiveTab === "filters") {
    _sbActiveTab = "explorer";
    if (typeof _applySidebarTab === "function") _applySidebarTab();
  }
  if (typeof updateFilterTabEnabled === "function") updateFilterTabEnabled();
}
function _overviewSankeyInstallResize() {
  const host = document.getElementById("overview-sankey-host");
  if (!host || _overviewSankeyResizeObserver || typeof ResizeObserver !== "function") return;
  _overviewSankeyResizeObserver = new ResizeObserver(() => {
    if (_overviewMode !== "sankey") return;
    clearTimeout(_overviewSankeyResizeTimer);
    _overviewSankeyResizeTimer = setTimeout(_overviewRenderSankey, 80);
  });
  _overviewSankeyResizeObserver.observe(host);
}
function _overviewSankeyDestroy() {
  clearTimeout(_overviewSankeyResizeTimer);
  _overviewSankeyResizeTimer = null;
  if (_overviewSankeyResizeObserver) {
    try {
      _overviewSankeyResizeObserver.disconnect();
    } catch (_) {
    }
    _overviewSankeyResizeObserver = null;
  }
  _overviewSankeyStack = [{ level: "module" }];
  _overviewSankeyViewport = { x: 0, y: 0, k: 1 };
  _overviewSankeySelectedId = "";
  _overviewSankeyLastLayout = null;
  const host = document.getElementById("overview-sankey-host");
  if (host) host.innerHTML = "";
}
window.overviewSankeyOpen = function() {
  _overviewSankeyDisableFilterPanel();
  _overviewSankeyInstallResize();
  requestAnimationFrame(_overviewRenderSankey);
};
window.overviewSankeyClose = function() {
  _galaxyHideTooltip();
};
window.overviewSankeyDestroy = _overviewSankeyDestroy;
window.overviewSankeyZoomByStep = function(direction) {
  const grid = _sankeyGrid();
  if (!grid) return false;
  const rect = grid.getBoundingClientRect();
  const buttonFactor = window.GRAPH_ZOOM_SETTINGS?.buttonFactor || 1.12;
  const factor = direction > 0 ? buttonFactor : 1 / buttonFactor;
  _sankeyZoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, _overviewSankeyViewport.k * factor);
  if (typeof refreshGraphZoomControls === "function") refreshGraphZoomControls();
  return true;
};
window.overviewSankeyZoomState = function() {
  return {
    zoom: _overviewSankeyViewport.k || 1,
    minZoom: _OVERVIEW_SANKEY_MIN_ZOOM,
    maxZoom: _OVERVIEW_SANKEY_MAX_ZOOM
  };
};
window.overviewSankeySelectFile = function(path) {
  if (_overviewMode !== "sankey" || !state?.galaxyActive) return false;
  if (!path) return false;
  const modId = typeof resolveModuleForFile === "function" ? resolveModuleForFile(path) : null;
  if (!modId || modId === "_root") return false;
  _overviewSankeyStack = [{ level: "module" }, { level: "file", module: modId }];
  _overviewSankeySelectedId = `f:${path}`;
  _overviewSankeyViewport = { x: 0, y: 0, k: 1 };
  _overviewRenderSankey();
  if (typeof loadFileInPanel === "function") loadFileInPanel(path);
  if (typeof updateCallGraphBtn === "function") updateCallGraphBtn(path);
  const entry = _overviewSankeyLastLayout && (_overviewSankeyLastLayout.left.get(_overviewSankeySelectedId) || _overviewSankeyLastLayout.right.get(_overviewSankeySelectedId));
  if (entry) {
    _sankeyCenterEntry(entry, true);
    return true;
  }
  return false;
};
window.isOverviewSankeyActive = function() {
  return !!state?.galaxyActive && _overviewMode === "sankey";
};
