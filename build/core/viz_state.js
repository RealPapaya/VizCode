const state = {
  level: 0,
  tab: "files",
  activeModule: null,
  activeSubDir: null,
  activeFile: null,
  history: [],
  pinnedNodes: /* @__PURE__ */ new Set(),
  galaxyActive: false
};
let _shapeMode = "detailed";
const SIMPLE_NODE_SIZE_SM = 26;
const SIMPLE_NODE_SIZE_MD = 36;
const SIMPLE_NODE_SIZE_LG = 48;
const l2State = {
  activeFile: null,
  activeFuncIdx: 0,
  expandedModules: /* @__PURE__ */ new Set(),
  externalModules: [],
  fileHistory: [],
  fileHistoryIdx: -1,
  showExternalEdges: false,
  showExternalFuncs: false,
  expandOriginPos: null,
  preserveViewport: null,
  _prevNodeIds: null,
  _animGen: 0,
  _l1Snapshot: null,
  fileHistorySnapshots: []
};
const depMapState = {
  showExternalFiles: false,
  showEdgeTypeLabels: false,
  expandedExtModules: /* @__PURE__ */ new Set(),
  currentExtModules: [],
  currentModId: null,
  pendingFocusFile: null,
  navHistory: [],
  navHistoryIdx: -1,
  _navigating: false,
  expandOriginPos: null,
  preserveViewport: null,
  _prevNodeIds: null,
  _animGen: 0
};
const _layoutCache = /* @__PURE__ */ new Map();
const _LAYOUT_CACHE_MAX = 30;
function _layoutCacheKey(level, modId, subDir, fileRel) {
  if (level === 0) return "L0";
  if (level === 1) return `L1:${modId || ""}:${subDir || ""}`;
  if (level === 2) return `L2:${fileRel || ""}`;
  return null;
}
function _layoutCacheGet(key) {
  if (!key) return null;
  const v = _layoutCache.get(key);
  if (!v) return null;
  v.ts = Date.now();
  _layoutCache.delete(key);
  _layoutCache.set(key, v);
  return v;
}
function _layoutCacheSet(key, positions) {
  if (!key || !positions || !positions.size) return;
  if (_layoutCache.has(key)) _layoutCache.delete(key);
  _layoutCache.set(key, { positions, ts: Date.now() });
  while (_layoutCache.size > _LAYOUT_CACHE_MAX) {
    const oldest = _layoutCache.keys().next().value;
    _layoutCache.delete(oldest);
  }
}
function _layoutCacheInvalidate(prefix) {
  if (!prefix) return;
  for (const k of Array.from(_layoutCache.keys())) {
    if (k === prefix || k.startsWith(prefix)) _layoutCache.delete(k);
  }
}
window._layoutCache = _layoutCache;
window._layoutCacheKey = _layoutCacheKey;
window._layoutCacheGet = _layoutCacheGet;
window._layoutCacheSet = _layoutCacheSet;
window._layoutCacheInvalidate = _layoutCacheInvalidate;
const _HISTORY_CAP = 50;
function pushFileHistorySnapshot(snap) {
  l2State.fileHistorySnapshots.push(snap);
  while (l2State.fileHistorySnapshots.length > _HISTORY_CAP)
    l2State.fileHistorySnapshots.shift();
}
function pushNavHistory(entry) {
  depMapState.navHistory.push(entry);
  while (depMapState.navHistory.length > _HISTORY_CAP) {
    depMapState.navHistory.shift();
    if (depMapState.navHistoryIdx > 0) depMapState.navHistoryIdx--;
  }
}
window.pushFileHistorySnapshot = pushFileHistorySnapshot;
window.pushNavHistory = pushNavHistory;
let _fileIdToModule = {};
let _fileIdToFile = {};
function buildFileIdLookup() {
  Object.entries(DATA.files_by_module).forEach(([modId, files]) => {
    files.forEach((f) => {
      _fileIdToModule[f.id] = modId;
      _fileIdToFile[f.id] = f;
    });
  });
  Object.entries(DATA.other_files_by_module || {}).forEach(([modId, files]) => {
    files.forEach((f) => {
      _fileIdToModule[f.id] = modId;
      _fileIdToFile[f.id] = f;
    });
  });
}
const codeState = {
  jobId: window.JOB_ID || null,
  currentFile: null,
  renderedFile: null,
  // file whose content is actually rendered in the panel (drives skip-fetch guards)
  currentFunc: null,
  currentData: null,
  currentExt: "",
  currentName: "",
  currentLangHint: "",
  funcLineMap: {},
  // funcName -> lineIndex (0-based)
  funcList: [],
  // list of {name, line} for current file
  funcIdx: 0,
  // current func index in funcList
  isOpen: false,
  userClosed: false,
  // true when user explicitly closed panel — prevents auto-reopen
  rawLines: [],
  // cache raw contents for exact callsite matching
  multiSnip: false,
  // true = multi-snippet mode (Structure View only)
  viewMode: "code"
};
const _registeredLayouts = /* @__PURE__ */ new Set([
  "dagre",
  "cose",
  "concentric",
  "breadthfirst",
  "circle",
  "grid",
  "random",
  "preset",
  "null"
]);
function _probeAvailableLayouts() {
  ["fcose", "elk", "cola"].forEach((name) => {
    try {
      const dummy = cy.layout({ name, stop: () => {
      } });
      dummy.destroy();
      _registeredLayouts.add(name);
      console.log("[layout] available:", name);
    } catch (_) {
      console.warn("[layout] not available (CDN may not have loaded):", name);
    }
  });
  refreshLayoutSwitcher();
}
function _isLayoutAvailable(name) {
  return _registeredLayouts.has(name);
}
let cy = null;
let tooltipPinned = false;
let tooltipHideTimer = null;
const GRAPH_ZOOM_SETTINGS = Object.freeze({
  minZoom: 0.04,
  maxZoom: 5,
  buttonFactor: 1.12,
  animationMs: 140
});
window.GRAPH_ZOOM_SETTINGS = GRAPH_ZOOM_SETTINGS;
const EXT_DOUBLE_CLICK_MS = 260;
let extClickLastId = null;
let extClickLastTime = 0;
let _renderToken = 0;
