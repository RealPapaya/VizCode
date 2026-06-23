// @module viz_state — Mutable runtime state objects
// Owns: state, l2State, depMapState, codeState, _fileIdToModule,
//       _fileIdToFile, buildFileIdLookup, _renderToken, cy,
//       tooltipPinned, tooltipHideTimer, GRAPH_ZOOM_SETTINGS,
//       _shapeMode, SIMPLE_NODE_SIZE_*, _registeredLayouts

// ─── State ────────────────────────────────────────────────────────────────────
interface AppState {
    level: number;          // 0=modules 1=files(subdirs) 1.5=files(subdir expanded) 2=functions
    tab: 'files' | 'calls';
    activeModule: string | null;
    activeSubDir: string | null;  // null = folder overview; string = inside a sub-folder
    activeFile: string | null;
    history: any[];
    pinnedNodes: Set<string>;
    galaxyActive: boolean;
    globalNav?: any;   // global nav-history stack (viz_nav_history)
}

const state: AppState = {
    level: 0,
    tab: 'files',
    activeModule: null,
    activeSubDir: null,
    activeFile: null,
    history: [],
    pinnedNodes: new Set(),
    galaxyActive: false,
};

let _shapeMode: 'detailed' | 'simple' = 'detailed';
const SIMPLE_NODE_SIZE_SM = 26;
const SIMPLE_NODE_SIZE_MD = 36;
const SIMPLE_NODE_SIZE_LG = 48;

interface L2State {
    activeFile: string | null;
    activeFuncIdx: number;
    expandedModules: Set<string>;
    externalModules: any[];
    fileHistory: any[];
    fileHistoryIdx: number;
    showExternalEdges: boolean;
    showExternalFuncs: boolean;
    expandOriginPos: any;
    preserveViewport: any;
    _prevNodeIds: any;
    _animGen: number;
    _l1Snapshot: any;            // { pan, zoom, selectedNodeId } saved when entering L2
    fileHistorySnapshots: any[]; // per-history-slot viewport+expand snapshots
    // Dynamic fields attached at runtime by the L2 call-flow renderer:
    _expandInitialized?: boolean;
    _sysMap?: any;
    _funcs?: any;
    sysCategories?: any;
    expandedSysCategories?: Set<string>;
    _fidMap?: any;
    _extMap?: any;
    _potMap?: any;
    _unkMap?: any;
}

const l2State: L2State = {
    activeFile: null,
    activeFuncIdx: 0,
    expandedModules: new Set(),
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
    fileHistorySnapshots: [],
};

// ─── Dependency Map (L1) external-files state ─────────────────────────────────
interface DepMapState {
    showExternalFiles: boolean;
    showEdgeTypeLabels: boolean;
    expandedExtModules: Set<string>;
    currentExtModules: any[];
    currentModId: string | null;
    pendingFocusFile: string | null;
    navHistory: any[];       // [{ modId, subDir }]
    navHistoryIdx: number;
    _navigating: boolean;    // true while stepping through history (don't push)
    expandOriginPos: any;    // { x, y } graph coords of the group node before re-render
    preserveViewport: any;   // { pan, zoom } to restore after layout
    _prevNodeIds: any;
    _animGen: number;        // increment every render; stale setTimeout callbacks bail out
}

const depMapState: DepMapState = {
    showExternalFiles: false,
    showEdgeTypeLabels: false,
    expandedExtModules: new Set(),
    currentExtModules: [],
    currentModId: null,
    pendingFocusFile: null,
    navHistory: [],
    navHistoryIdx: -1,
    _navigating: false,
    expandOriginPos: null,
    preserveViewport: null,
    _prevNodeIds: null,
    _animGen: 0,
};

// ─── Layout result cache (LRU) ───────────────────────────────────────────────
// viewKey → { positions: Map<nodeId, {x,y}>, ts }
// Hit: skip force-directed compute, paint via name:'preset'.
// Invalidated when node set for a view changes (toggle ext, expand, etc).
const _layoutCache = new Map();
const _LAYOUT_CACHE_MAX = 30;

function _layoutCacheKey(level, modId?, subDir?, fileRel?) {
    if (level === 0) return 'L0';
    if (level === 1) return `L1:${modId || ''}:${subDir || ''}`;
    if (level === 2) return `L2:${fileRel || ''}`;
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

// ─── History caps (prevent unbounded growth) ─────────────────────────────────
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

// File-ID → module/file lookup, built once after DATA is parsed
let _fileIdToModule: Record<number, string> = {};
let _fileIdToFile: Record<number, FileNode> = {};

function buildFileIdLookup() {
    Object.entries(DATA.files_by_module).forEach(([modId, files]) => {
        files.forEach(f => { _fileIdToModule[f.id] = modId; _fileIdToFile[f.id] = f; });
    });
    Object.entries(DATA.other_files_by_module || {}).forEach(([modId, files]) => {
        files.forEach(f => { _fileIdToModule[f.id] = modId; _fileIdToFile[f.id] = f; });
    });
}

// Code panel state
interface CodeState {
    jobId: string | null;
    currentFile: string | null;
    currentFunc: any;
    currentData: any;
    currentExt: string;
    currentName: string;
    currentLangHint: string;
    funcLineMap: Record<string, number>;  // funcName -> lineIndex (0-based)
    funcList: any[];                       // list of {name, line}
    funcIdx: number;
    isOpen: boolean;
    userClosed: boolean;
    rawLines: string[];
    multiSnip: boolean;
    viewMode: string;
}

const codeState: CodeState = {
    jobId: window.JOB_ID || null,
    currentFile: null,
    currentFunc: null,
    currentData: null,
    currentExt: '',
    currentName: '',
    currentLangHint: '',
    funcLineMap: {},   // funcName -> lineIndex (0-based)
    funcList: [],      // list of {name, line} for current file
    funcIdx: 0,        // current func index in funcList
    isOpen: false,
    userClosed: false, // true when user explicitly closed panel — prevents auto-reopen
    rawLines: [],      // cache raw contents for exact callsite matching
    multiSnip: false,  // true = multi-snippet mode (Structure View only)
    viewMode: 'code',
};

// ─── Layout extension availability ───────────────────────────────────────────
// All CDN UMD bundles (fcose, elk, cola) self-register by calling
// cytoscape.use() internally when their <script> tag executes.
// No manual cytoscape.use() or window.cytoscapeXxx lookup needed.
// We probe after cy is initialised: cy.layout({ name }) throws synchronously
// if the layout name is unknown, which tells us the CDN didn't load.

const _registeredLayouts = new Set([
    'dagre', 'cose', 'concentric', 'breadthfirst', 'circle', 'grid', 'random', 'preset', 'null',
]);

function _probeAvailableLayouts() {
    ['fcose', 'elk', 'cola'].forEach(name => {
        try {
            const dummy = cy.layout({ name, stop: () => { } });
            dummy.destroy();
            _registeredLayouts.add(name);
            console.log('[layout] available:', name);
        } catch (_) {
            console.warn('[layout] not available (CDN may not have loaded):', name);
        }
    });
    refreshLayoutSwitcher();
}

function _isLayoutAvailable(name) {
    return _registeredLayouts.has(name);
}

let cy: any = null;
let tooltipPinned = false;
let tooltipHideTimer: any = null;
const GRAPH_ZOOM_SETTINGS = Object.freeze({
    minZoom: 0.04,
    maxZoom: 5,
    buttonFactor: 1.12,
    animationMs: 140,
});
window.GRAPH_ZOOM_SETTINGS = GRAPH_ZOOM_SETTINGS;
const EXT_DOUBLE_CLICK_MS = 260;
let extClickLastId = null;
let extClickLastTime = 0;

// ─── Render cancel token ──────────────────────────────────────────────────────
// Incremented every time a render starts; async callbacks check staleness.
let _renderToken = 0;

