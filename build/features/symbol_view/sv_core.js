"use strict";
const _svState = {
  fileRel: null,
  // current file path rel to project root
  focusId: null,
  // focused symbol id inside fileRel, or null
  history: [],
  // back stack of { fileRel, focusId }
  future: [],
  // forward stack
  jobId: null,
  ready: false,
  // DOM mounted?
  svg: null,
  viewport: null,
  measureHost: null,
  zoom: { k: 1, x: 0, y: 0 },
  currentGraph: null,
  // last rendered file graph model
  currentData: null,
  // raw /symbol-file response for the current file
  baseLayoutSnapshot: null,
  focusLayoutSnapshot: null,
  activeAnimationToken: 0,
  searchOpen: false,
  searchCache: /* @__PURE__ */ new Map(),
  hiddenEdgeTypes: /* @__PURE__ */ new Set(),
  hiddenKinds: /* @__PURE__ */ new Set(),
  // symbol kinds hidden via the sidebar SYMBOL TYPE filter
  hideUnrelated: false,
  edgeJumpCursor: /* @__PURE__ */ new Map(),
  selectedEdgeId: null,
  metricHighlight: null,
  // 'callers' | 'callees' | null — metrics-click edge highlight
  focusCardHeightOverrides: /* @__PURE__ */ new Map(),
  detailSectionCollapsed: /* @__PURE__ */ new Set(),
  // "signature" | "docstring" | "metrics"
  compoundCollapsed: /* @__PURE__ */ new Set(),
  // class compound ids whose methods are hidden
  compoundSectionExpanded: /* @__PURE__ */ new Set(),
  // `${classId}:${public|private}` sections expanded inside class cards
  _collapseAllOnLoad: true,
  // when true, next load collapses all classes by default
  showExternal: false,
  // when false, ghost (external) nodes are hidden
  _legendSnap: null,
  // Back-compat alias — viz_code_panel.js / viz_graph.js / viz_sidebar.js
  // read `window._sv.active` as a truthy "is symbol view open" flag. Keep
  // it in sync via _svSyncActive().
  active: null
};
function _svSyncActive() {
  _svState.active = _svState.fileRel || null;
}
const _SV_KIND_COLOR = {
  class: "#9ca3af",
  // gray
  struct: "#9ca3af",
  interface: "#2dd4bf",
  // teal — distinct from class
  enum: "#a855f7",
  // purple
  type: "#9ca3af",
  method: "#fbbf24",
  // yellow
  function: "#fbbf24",
  field: "#60a5fa",
  // blue
  key: "#60a5fa",
  keyframes: "#a855f7",
  variable: "#60a5fa",
  constant: "#38bdf8",
  // sky — distinct from variable
  property: "#60a5fa",
  // ── Extended kinds (multi-language) ──────────────────────────────────
  // Grouped by semantics so kinds that co-occur stay distinguishable:
  // contract-like → teal · data types → light purple · grouping scopes →
  // indigo · metadata → pink · concurrency/macro → orange.
  protocol: "#2dd4bf",
  // teal — interface-like contract (Swift/ObjC/Elixir)
  trait: "#2dd4bf",
  // teal — Rust/Scala/PHP trait
  mixin: "#5eead4",
  // light teal — mixed-in behavior
  record: "#c084fc",
  // light purple — data type (Java/C#/Clojure)
  union: "#c084fc",
  // light purple — tagged/data union
  typealias: "#9ca3af",
  // gray — type alias
  object: "#9ca3af",
  // gray — singleton object (Scala/Kotlin)
  impl: "#9ca3af",
  // gray — impl block (Rust)
  extend: "#9ca3af",
  // gray — extension
  namespace: "#818cf8",
  // indigo — grouping scope
  module: "#818cf8",
  // indigo — grouping scope
  package: "#818cf8",
  // indigo — grouping scope
  annotation: "#f472b6",
  // pink — annotation / attribute type
  actor: "#fb923c",
  // orange — concurrency type (Swift)
  macro: "#fb923c",
  // orange — macro definition
  default: "#94a3b8"
};
const _SV_EDGE_COLOR = {
  call: "#fbbf24",
  inheritance: "#9ca3af",
  implements: "#2dd4bf",
  mixin_include: "#14b8a6",
  mixin_extend: "#06b6d4",
  mixin_prepend: "#f59e0b",
  behaviour_impl: "#c084fc",
  protocol_impl: "#e879f9",
  override: "#f472b6",
  import: "#34d399",
  include: "#34d399",
  type_usage: "#60a5fa",
  member: "#a78bfa",
  default: "#64748b"
};
const _SV_CARD_KINDS = /* @__PURE__ */ new Set(["class", "struct", "interface", "enum"]);
const _SV_DUR_MS = 780;
function _svIsLightTheme() {
  const theme = document.body.getAttribute("data-theme");
  return theme === "claude" || theme === "parchment";
}
function _svKindColor(kind) {
  const isLight = _svIsLightTheme();
  if (isLight) {
    const lightKindColors = {
      class: "#4b5563",
      // dark gray
      struct: "#4b5563",
      interface: "#0d9488",
      // dark teal
      enum: "#7c3aed",
      // purple
      type: "#4b5563",
      method: "#b45309",
      // amber
      function: "#b45309",
      field: "#2563eb",
      // blue
      key: "#2563eb",
      keyframes: "#7c3aed",
      variable: "#2563eb",
      constant: "#0284c7",
      // sky
      property: "#2563eb",
      protocol: "#0d9488",
      trait: "#0d9488",
      mixin: "#0f766e",
      record: "#9333ea",
      union: "#9333ea",
      typealias: "#4b5563",
      object: "#4b5563",
      impl: "#4b5563",
      extend: "#4b5563",
      namespace: "#4f46e5",
      module: "#4f46e5",
      package: "#4f46e5",
      annotation: "#db2777",
      actor: "#ea580c",
      macro: "#ea580c",
      default: "#6b7280"
    };
    return lightKindColors[kind] || lightKindColors.default;
  }
  return _SV_KIND_COLOR[kind] || _SV_KIND_COLOR.default;
}
function _svSymDotColor(sym, isMethod) {
  const kind = sym && sym.kind;
  const isLight = _svIsLightTheme();
  if (isMethod && (kind === "method" || kind === "function")) {
    if (sym.is_public === false) {
      return isLight ? "#d97706" : "#e8762a";
    } else {
      return isLight ? "#2563eb" : "#60a5fa";
    }
  }
  return _svKindColor(kind);
}
function _svEdgeColor(type) {
  const isLight = _svIsLightTheme();
  if (isLight) {
    const lightColors = {
      call: "#d97706",
      // dark amber
      inheritance: "#4b5563",
      // dark gray
      implements: "#0d9488",
      // dark teal
      mixin_include: "#0f766e",
      // darker teal
      mixin_extend: "#0891b2",
      // dark cyan
      mixin_prepend: "#b45309",
      // dark orange-brown
      behaviour_impl: "#7c3aed",
      // dark violet
      protocol_impl: "#c026d3",
      // dark fuchsia
      override: "#db2777",
      // dark pink
      import: "#059669",
      // dark emerald
      include: "#059669",
      // dark emerald
      type_usage: "#2563eb",
      // dark blue
      member: "#6d28d9",
      // dark indigo
      default: "#4b5563"
    };
    return lightColors[type] || lightColors.default;
  }
  return _SV_EDGE_COLOR[type] || _SV_EDGE_COLOR.default;
}
function _svEnsureDom() {
  if (_svState.ready) return;
  const root = document.getElementById("sym-view");
  if (!root) return;
  root.innerHTML = `
      <div id="sv-toolbar">
        <div class="sv-tb-top">
          <span class="sv-tb-title"><span class="banner-lvl l3-clr">Level 3</span> \xB7 Structure</span>
          <span id="sv-breadcrumb" class="banner-breadcrumb"></span>
        </div>
        <div class="sv-tb-actions">
          <button id="sv-back-btn" class="l2-btn" title="Back" disabled>&#x21A9;</button>
          <button id="sv-fwd-btn"  class="l2-btn" title="Forward" disabled>&#x21AA;</button>
          <button id="sv-expand-all-btn" title="Expand all classes">Expand All</button>
          <button id="sv-collapse-all-btn" title="Collapse all classes">Collapse All</button>
          <button id="sv-ext-btn" title="Show/hide external symbols">External Symbol</button>
          <span id="sv-stats" class="sv-tb-stats"></span>
        </div>
      </div>
      <svg id="sv-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="sv-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse"
                  markerUnits="userSpaceOnUse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"></path>
          </marker>
        </defs>
        <g class="sv-viewport">
          <g class="sv-edges"></g>
          <g class="sv-edge-labels"></g>
          <g class="sv-cards"></g>
          <g class="sv-ghosts"></g>
        </g>
      </svg>
                  <div id="sv-empty" hidden>
        <div class="sv-empty-icon">&#10697;</div>
        <div class="sv-empty-msg">No file loaded</div>
      </div>
      <div id="sv-card-measure" aria-hidden="true"></div>
      <div id="sv-edge-tip" hidden></div>
    `;
  _svState.svg = root.querySelector("#sv-svg");
  _svState.viewport = root.querySelector(".sv-viewport");
  _svState.measureHost = root.querySelector("#sv-card-measure");
  root.querySelector("#sv-back-btn").onclick = goGlobalBack;
  root.querySelector("#sv-fwd-btn").onclick = goGlobalForward;
  root.querySelector("#sv-expand-all-btn").onclick = _svExpandAll;
  root.querySelector("#sv-collapse-all-btn").onclick = _svCollapseAll;
  root.querySelector("#sv-ext-btn").onclick = _svToggleExternal;
  root.querySelector("#sv-ext-btn").classList.toggle("sv-btn-active", _svState.showExternal);
  _svInitPanZoom();
  if (typeof _svInitSearch === "function") _svInitSearch();
  _svState.ready = true;
}
function _svInitPanZoom() {
  const svg = _svState.svg;
  if (!svg) return;
  let isPanning = false;
  let didPan = false;
  let panStart = null;
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 0.9;
    const rect = svg.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const z = _svState.zoom;
    const nk = Math.max(0.1, Math.min(4, z.k * factor));
    z.x = cx - (cx - z.x) * (nk / z.k);
    z.y = cy - (cy - z.y) * (nk / z.k);
    z.k = nk;
    _svApplyZoom();
  }, { passive: false });
  svg.addEventListener("mousedown", (e) => {
    if (e.target !== svg && !e.target.classList.contains("sv-viewport")) return;
    isPanning = true;
    didPan = false;
    panStart = { x: e.clientX - _svState.zoom.x, y: e.clientY - _svState.zoom.y };
    svg.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (e) => {
    if (!isPanning) return;
    didPan = true;
    _svState.zoom.x = e.clientX - panStart.x;
    _svState.zoom.y = e.clientY - panStart.y;
    _svApplyZoom();
  });
  window.addEventListener("mouseup", () => {
    if (!isPanning) return;
    isPanning = false;
    svg.style.cursor = "";
  });
  svg.addEventListener("click", (e) => {
    if (didPan) return;
    const onBackground = e.target === svg || e.target === _svState.viewport || e.target.classList.contains("sv-edges") || e.target.classList.contains("sv-edge-labels") || e.target.classList.contains("sv-cards") || e.target.classList.contains("sv-ghosts");
    if (onBackground && _svState.focusId) {
      pushGlobalNavSnapshot("sv-clear-focus");
      _svState.focusId = null;
      if (typeof _svRebuildForFocus === "function") _svRebuildForFocus();
      else if (typeof _svApplyFocus === "function") _svApplyFocus();
    }
  });
}
function _svApplyZoom() {
  const z = _svState.zoom;
  if (_svState.viewport) {
    _svState.viewport.setAttribute("transform", `translate(${z.x},${z.y}) scale(${z.k})`);
  }
}
function _svResetZoom(animate = true) {
  const svg = _svState.svg;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const targetZoom = { k: 1, x: rect.width / 2, y: rect.height / 2 };
  if (!animate) {
    _svState.zoom = targetZoom;
    _svApplyZoom();
    return;
  }
  _svAnimateValue(_svState.zoom, targetZoom, _SV_DUR_MS, _svApplyZoom);
}
function _svAnimateValue(obj, target, durationMs, onStep) {
  const start = {};
  for (const k in target) start[k] = obj[k];
  const t0 = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - t0) / durationMs);
    const e = _svEase(t);
    for (const k in target) obj[k] = start[k] + (target[k] - start[k]) * e;
    if (onStep) onStep();
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function _svEase(t) {
  return 1 - Math.pow(1 - t, 4);
}
function symViewOpen(fileRel) {
  _svEnsureDom();
  _svState.jobId = window.JOB_ID || null;
  if (!fileRel) return;
  const root = document.getElementById("sym-view");
  if (!root) return;
  if (!isGlobalNavRestoring()) pushGlobalNavSnapshot("sv-open");
  const cy = document.getElementById("cy");
  if (cy) cy.style.display = "none";
  const ls = document.getElementById("layout-switcher");
  if (ls) ls.style.display = "none";
  root.classList.add("active");
  _svSaveLegend();
  _svHideLegend();
  _svPushHistory();
  _svState.fileRel = fileRel;
  _svState.focusId = null;
  _svState.detailSectionCollapsed.clear();
  _svState.compoundCollapsed.clear();
  _svState.compoundSectionExpanded.clear();
  _svState._collapseAllOnLoad = true;
  _svState.edgeJumpCursor.clear();
  _svState.selectedEdgeId = null;
  _svState.baseLayoutSnapshot = null;
  _svState.focusLayoutSnapshot = null;
  _svState.activeAnimationToken += 1;
  _svSyncActive();
  if (typeof _svLoadFileGraph === "function") {
    _svLoadFileGraph(fileRel);
  }
  _svSyncNavBtns();
  _svUpdateStructBtn(true);
  if (typeof refreshGraphZoomControls === "function") refreshGraphZoomControls();
}
function symViewActivate(symId) {
  if (!symId) return;
  _svEnsureDom();
  _svState.jobId = window.JOB_ID || null;
  const sym = window.DATA && DATA.symbol_index ? DATA.symbol_index[symId] : null;
  if (!sym || !sym.file) return;
  const root = document.getElementById("sym-view");
  if (!root) return;
  if (!isGlobalNavRestoring()) pushGlobalNavSnapshot("sv-activate");
  const cy = document.getElementById("cy");
  if (cy) cy.style.display = "none";
  const ls = document.getElementById("layout-switcher");
  if (ls) ls.style.display = "none";
  root.classList.add("active");
  _svSaveLegend();
  _svHideLegend();
  _svPushHistory();
  if (sym.file !== _svState.fileRel) {
    _svState.fileRel = sym.file;
    _svState.focusId = symId;
    _svState.detailSectionCollapsed.clear();
    _svState.compoundCollapsed.clear();
    _svState.compoundSectionExpanded.clear();
    _svState._collapseAllOnLoad = true;
    _svState.edgeJumpCursor.clear();
    _svState.selectedEdgeId = null;
    _svState.baseLayoutSnapshot = null;
    _svState.focusLayoutSnapshot = null;
    _svState.activeAnimationToken += 1;
    _svSyncActive();
    if (typeof _svLoadFileGraph === "function") {
      _svLoadFileGraph(sym.file, { pendingFocus: symId });
    }
  } else {
    _svSetFocus(symId);
  }
  _svSyncNavBtns();
  _svUpdateStructBtn(true);
}
function symViewClose() {
  if (window._sv && window._sv.active && !isGlobalNavRestoring()) {
    pushGlobalNavSnapshot("sv-close");
  }
  const root = document.getElementById("sym-view");
  if (root) root.classList.remove("active");
  const cy = document.getElementById("cy");
  if (cy) cy.style.display = "";
  const ls = document.getElementById("layout-switcher");
  if (ls) ls.style.display = "";
  _svState.fileRel = null;
  _svState.focusId = null;
  _svState.currentGraph = null;
  _svState.currentData = null;
  _svState.baseLayoutSnapshot = null;
  _svState.focusLayoutSnapshot = null;
  _svState.activeAnimationToken += 1;
  _svSyncActive();
  _svRestoreLegend();
  _svSyncNavBtns();
  _svUpdateStructBtn(false);
  const results = document.getElementById("sv-search-results");
  if (results) results.hidden = true;
  _svState.searchOpen = false;
  if (typeof syncTopbarModeButtons === "function") {
    syncTopbarModeButtons();
  }
  if (typeof refreshGraphZoomControls === "function") refreshGraphZoomControls();
  if (typeof buildEdgeFilter === "function") buildEdgeFilter();
  if (typeof buildNodeLegend === "function") buildNodeLegend();
  if (typeof buildFtFilter === "function") {
    const _mod = typeof state !== "undefined" && state ? state.activeModule || null : null;
    const _sub = typeof state !== "undefined" && state ? state.activeSubDir || null : null;
    buildFtFilter(_mod, _sub);
  }
}
function _svPushHistory() {
  if (!_svState.fileRel) return;
  _svState.history.push({ fileRel: _svState.fileRel, focusId: _svState.focusId });
  if (_svState.history.length > 100) _svState.history.shift();
  _svState.future.length = 0;
}
function _svGoBack() {
  if (!_svState.history.length) return;
  const prev = _svState.history.pop();
  _svState.future.push({ fileRel: _svState.fileRel, focusId: _svState.focusId });
  _svJumpTo(prev);
}
function _svGoForward() {
  if (!_svState.future.length) return;
  const nxt = _svState.future.pop();
  _svState.history.push({ fileRel: _svState.fileRel, focusId: _svState.focusId });
  _svJumpTo(nxt);
}
function _svJumpTo(snap) {
  if (!snap) return;
  const prevFile = _svState.fileRel;
  _svState.fileRel = snap.fileRel || null;
  _svState.focusId = snap.focusId || null;
  _svState.detailSectionCollapsed.clear();
  _svState.compoundCollapsed.clear();
  _svState.compoundSectionExpanded.clear();
  _svState.edgeJumpCursor.clear();
  _svState.focusLayoutSnapshot = null;
  _svSyncActive();
  if (_svState.fileRel && _svState.fileRel !== prevFile) {
    if (typeof _svLoadFileGraph === "function") {
      _svLoadFileGraph(_svState.fileRel, { pendingFocus: _svState.focusId });
    }
  } else if (typeof _svRebuildForFocus === "function") {
    _svRebuildForFocus();
  } else if (typeof _svApplyFocus === "function") {
    _svApplyFocus();
  }
  _svSyncNavBtns();
}
function _svSetFocus(symId) {
  if (typeof _svIsCompoundSymbolId === "function" && _svIsCompoundSymbolId(symId)) {
    if (!isGlobalNavRestoring()) pushGlobalNavSnapshot("sv-compound-open");
    if (typeof _svOpenCompoundInline === "function") _svOpenCompoundInline(symId, { toggle: false });
    return;
  }
  if (!isGlobalNavRestoring()) pushGlobalNavSnapshot("sv-focus");
  _svPushHistory();
  _svState.focusId = symId;
  _svState.detailSectionCollapsed.clear();
  _svState.edgeJumpCursor.clear();
  _svState.selectedEdgeId = null;
  if (typeof _svRebuildForFocus === "function") _svRebuildForFocus();
  else if (typeof _svApplyFocus === "function") _svApplyFocus();
  _svSyncNavBtns();
}
function _svSyncNavBtns() {
  if (typeof syncGlobalNavButtons === "function") syncGlobalNavButtons();
  if (!_svState.focusId) _svState.hideUnrelated = false;
  if (typeof refreshGraphZoomControls === "function") refreshGraphZoomControls();
}
function svGetNavSnapshot() {
  return {
    fileRel: _svState.fileRel || null,
    focusId: _svState.focusId || null,
    zoom: _svState.zoom ? { ..._svState.zoom } : null
  };
}
function svRestoreNavSnapshot(snap) {
  if (!snap || !snap.fileRel) return false;
  _svEnsureDom();
  _svState.jobId = window.JOB_ID || null;
  const root = document.getElementById("sym-view");
  if (!root) return false;
  const cyEl = document.getElementById("cy");
  if (cyEl) cyEl.style.display = "none";
  const ls = document.getElementById("layout-switcher");
  if (ls) ls.style.display = "none";
  root.classList.add("active");
  _svSaveLegend();
  _svHideLegend();
  _svState.fileRel = snap.fileRel;
  _svState.focusId = snap.focusId || null;
  _svState.detailSectionCollapsed.clear();
  _svState.compoundCollapsed.clear();
  _svState.compoundSectionExpanded.clear();
  _svState.edgeJumpCursor.clear();
  _svState.selectedEdgeId = null;
  _svState.baseLayoutSnapshot = null;
  _svState.focusLayoutSnapshot = null;
  _svState.activeAnimationToken += 1;
  _svSyncActive();
  if (typeof _svLoadFileGraph === "function") {
    _svLoadFileGraph(snap.fileRel, snap.focusId ? { pendingFocus: snap.focusId } : {});
  }
  _svSyncNavBtns();
  _svUpdateStructBtn(true);
  return true;
}
function svApplyNavSnapshot(snap) {
  if (!snap) return false;
  if (!_svState.currentGraph || _svState.fileRel !== snap.fileRel) return false;
  if (snap.zoom) {
    _svState.zoom = { ...snap.zoom };
    _svApplyZoom();
  }
  _svSyncNavBtns();
  if (typeof refreshGraphZoomControls === "function") refreshGraphZoomControls();
  return true;
}
function _svUpdateStructBtn(isOpen) {
  if (!window._lswUpdate) return;
  const isL2 = !!(state && state.level >= 2);
  window._lswUpdate({ active: isOpen ? 3 : isL2 ? 2 : state && state.level === 1 ? 1 : 0 });
}
function _svSaveLegend() {
  if (_svState._legendSnap) return;
  const leg = document.getElementById("graph-legend");
  if (!leg) {
    _svState._legendSnap = { existed: false };
    return;
  }
  _svState._legendSnap = {
    existed: true,
    html: leg.innerHTML,
    className: leg.className,
    display: leg.style.display
  };
}
function _svHideLegend() {
  const leg = document.getElementById("graph-legend");
  if (leg) leg.style.display = "none";
}
function _svRestoreLegend() {
  const snap = _svState._legendSnap;
  if (!snap) return;
  const leg = document.getElementById("graph-legend");
  if (!snap.existed) {
    if (leg) leg.remove();
  } else if (leg) {
    leg.innerHTML = snap.html;
    leg.className = snap.className;
    leg.style.display = snap.display || "";
  }
  _svState._legendSnap = null;
}
function _svEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
window._svState = _svState;
window.symViewOpen = symViewOpen;
window.symViewActivate = symViewActivate;
window.symViewClose = symViewClose;
window.svGetNavSnapshot = svGetNavSnapshot;
window.svRestoreNavSnapshot = svRestoreNavSnapshot;
window.svApplyNavSnapshot = svApplyNavSnapshot;
window.svHideSvView = symViewClose;
function _svFileHasSymbols(fileRel) {
  return !!(fileRel && window.DATA && window.DATA.symbol_index && Object.values(window.DATA.symbol_index).some((s) => s.file === fileRel));
}
window.svUpdateStructureBtn = function(fileRel, _ext) {
  if (!window._lswUpdate) return;
  const hasSymbols = _svFileHasSymbols(fileRel);
  const isActive = hasSymbols && !!_svState.fileRel;
  window._lswUpdate({ l3Available: hasSymbols, ...isActive ? { active: 3 } : {} });
};
window.svHideStructureBtn = function() {
  if (!window._lswUpdate) return;
  const openFile = typeof codeState !== "undefined" ? codeState.currentFile : null;
  const hasSymbols = _svFileHasSymbols(openFile);
  window._lswUpdate({ l3Available: hasSymbols });
  if (!hasSymbols && window._lswGetActive && window._lswGetActive() === 3) {
    const fallback = state && state.level >= 2 ? 2 : state && state.level === 1 ? 1 : 0;
    window._lswUpdate({ active: fallback });
  }
};
window.symShowCurrentSnippets = function() {
};
window.svHighlightLine = function(lineIdx) {
  const lineNo = lineIdx + 1;
  if (!_svState.fileRel || !window.DATA || !DATA.symbol_index) return;
  const candidates = Object.values(DATA.symbol_index).filter((s) => s.file === _svState.fileRel);
  let best = null;
  for (const s of candidates) {
    const start = s.line || 0;
    const end = s.end_line || start;
    if (start && lineNo >= start && lineNo <= end) {
      if (!best || (s.line || 0) > (best.line || 0)) best = s;
    }
  }
  if (!best) return;
  if (best.id === _svState.focusId) return;
  if (typeof _svIsCompoundSymbolId === "function" && _svIsCompoundSymbolId(best.id)) {
    if (typeof _svOpenCompoundInline === "function") _svOpenCompoundInline(best.id, { toggle: false });
    return;
  }
  _svState.focusId = best.id;
  _svState.detailSectionCollapsed.clear();
  _svState.edgeJumpCursor.clear();
  _svState.selectedEdgeId = null;
  if (typeof _svRebuildForFocus === "function") _svRebuildForFocus();
  else if (typeof _svApplyFocus === "function") _svApplyFocus({ noHistory: true });
  _svSyncNavBtns();
};
window.svHighlightBadgeByName = function(word) {
  if (!word || !window.DATA || !DATA.symbol_index) return;
  const file = _svState.fileRel;
  if (!file) return;
  const all = Object.values(DATA.symbol_index);
  const inFile = all.filter((s) => s.file === file && s.name === word);
  const match = inFile.length ? inFile[0] : all.find((s) => s.name === word);
  if (!match) return;
  symViewActivate(match.id);
};
window._sv = _svState;
