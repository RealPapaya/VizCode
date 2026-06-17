// @module viz_nav_history - Global view history for graph and symbol views.
// Owns: captureNavSnapshot, pushGlobalNavSnapshot, goGlobalBack,
//       goGlobalForward, syncGlobalNavButtons, applyPendingGlobalNavRestore.

const GLOBAL_NAV_HISTORY_CAP = 50;

function _globalNavState() {
    if (!state.globalNav) {
        state.globalNav = {
            back: [],
            forward: [],
            restoring: false,
            pendingRestore: null,
        };
    }
    return state.globalNav;
}

function isGlobalNavRestoring() {
    return !!_globalNavState().restoring;
}

function _navCloneViewport() {
    if (!cy) return null;
    try {
        return {
            pan: { ...cy.pan() },
            zoom: cy.zoom(),
        };
    } catch (_) {
        return null;
    }
}

function _navSelectedNodeId() {
    if (!cy) return null;
    try {
        if (typeof _hlPinnedNode !== 'undefined' && _hlPinnedNode && _hlPinnedNode.length) {
            return _hlPinnedNode.id();
        }
        const sel = cy.nodes(':selected').first();
        return sel && sel.length ? sel.id() : null;
    } catch (_) {
        return null;
    }
}

function _navCodePanelSnapshot() {
    if (typeof codeState === 'undefined') return null;
    return {
        isOpen: !!codeState.isOpen,
        userClosed: !!codeState.userClosed,
        currentFile: codeState.currentFile || null,
        currentFunc: codeState.currentFunc || null,
    };
}

function captureNavSnapshot() {
    const svActive = !!(window._sv && window._sv.active);
    const svSnap = svActive && typeof window.svGetNavSnapshot === 'function'
        ? window.svGetNavSnapshot()
        : null;

    return {
        view: svActive ? 'l3' : 'graph',
        level: state.level || 0,
        activeModule: state.activeModule || null,
        activeSubDir: state.activeSubDir || null,
        activeFile: state.activeFile || null,
        l2File: (typeof l2State !== 'undefined' && l2State.activeFile) ? l2State.activeFile : null,
        l2FuncIdx: (typeof l2State !== 'undefined') ? (l2State.activeFuncIdx || 0) : 0,
        selectedNodeId: _navSelectedNodeId(),
        viewport: _navCloneViewport(),
        codePanel: _navCodePanelSnapshot(),
        sv: svSnap,
    };
}

function _navSnapshotKey(snap) {
    if (!snap) return '';
    const vp = snap.viewport
        ? `${Math.round(snap.viewport.zoom * 1000)}:${Math.round(snap.viewport.pan.x)}:${Math.round(snap.viewport.pan.y)}`
        : '';
    const svZoom = snap.sv && snap.sv.zoom
        ? `${Math.round(snap.sv.zoom.k * 1000)}:${Math.round(snap.sv.zoom.x)}:${Math.round(snap.sv.zoom.y)}`
        : '';
    const sv = snap.sv
        ? `${snap.sv.fileRel || ''}:${snap.sv.focusId || ''}:${svZoom}`
        : '';
    return [
        snap.view,
        snap.level,
        snap.activeModule || '',
        snap.activeSubDir || '',
        snap.activeFile || '',
        snap.l2File || '',
        snap.l2FuncIdx || 0,
        snap.selectedNodeId || '',
        sv,
        vp,
    ].join('|');
}

function pushGlobalNavSnapshot(reason) {
    const nav = _globalNavState();
    if (nav.restoring) return;
    const snap = captureNavSnapshot();
    const last = nav.back[nav.back.length - 1];
    if (last && _navSnapshotKey(last) === _navSnapshotKey(snap)) return;
    nav.back.push(snap);
    while (nav.back.length > GLOBAL_NAV_HISTORY_CAP) nav.back.shift();
    nav.forward = [];
    syncGlobalNavButtons();
}

function _restoreCodePanelFromSnapshot(snap) {
    const cp = snap && snap.codePanel;
    if (!cp || typeof codeState === 'undefined') return;
    if (cp.isOpen && cp.currentFile && typeof loadFileInPanel === 'function') {
        codeState.userClosed = false;
        loadFileInPanel(cp.currentFile, cp.currentFunc || null);
    } else if (!cp.isOpen) {
        if (typeof closeCodePanel === 'function' && codeState.isOpen) closeCodePanel();
        codeState.currentFile = cp.currentFile || codeState.currentFile;
        codeState.currentFunc = cp.currentFunc || null;
        codeState.userClosed = !!cp.userClosed;
    }
}

function _applyGraphSnapshotNow(snap) {
    if (!snap || !cy) return false;
    if (snap.viewport) {
        try { cy.viewport({ zoom: snap.viewport.zoom, pan: snap.viewport.pan }); } catch (_) {}
    }
    try {
        cy.elements().unselect();
        cy.elements().removeClass('faded hl hl-edge-out hl-edge-in hl-node-out hl-node-in');
        if (snap.selectedNodeId && cy.hasElementWithId(snap.selectedNodeId)) {
            const node = cy.$id(snap.selectedNodeId);
            node.select();
            if (typeof pinHighlightNode === 'function') pinHighlightNode(node);
        } else if (typeof clearSelection === 'function') {
            clearSelection();
        }
    } catch (_) {}

    if (snap.level >= 2 && snap.l2File) {
        l2State.activeFuncIdx = snap.l2FuncIdx || 0;
        const shouldFocusFunc = !snap.selectedNodeId || snap.selectedNodeId === `fn-${l2State.activeFuncIdx}`;
        if (shouldFocusFunc && typeof focusL2Func === 'function') {
            focusL2Func(snap.l2File, l2State.activeFuncIdx, { center: false, openCodePanel: false });
        }
    }
    _restoreCodePanelFromSnapshot(snap);
    return true;
}

function applyPendingGlobalNavRestore(stage) {
    const nav = _globalNavState();
    const snap = nav.pendingRestore;
    if (!snap) return false;
    if (stage === 'l3') {
        if (snap.view !== 'l3') return false;
    } else {
        if (snap.view === 'l3') return false;
        if (stage === 'l0' && snap.level !== 0) return false;
        if (stage === 'l1' && snap.level !== 1) return false;
        if (stage === 'l2' && snap.level < 2) return false;
    }
    const applied = snap.view === 'l3'
        ? (typeof window.svApplyNavSnapshot === 'function' && window.svApplyNavSnapshot(snap.sv))
        : _applyGraphSnapshotNow(snap);
    if (applied) {
        nav.pendingRestore = null;
        nav.restoring = false;
        syncGlobalNavButtons();
    }
    return !!applied;
}

function _restoreGlobalNavSnapshot(snap) {
    const nav = _globalNavState();
    nav.restoring = true;
    nav.pendingRestore = snap;

    if (snap.view === 'l3') {
        if (!snap.sv || !snap.sv.fileRel) {
            nav.pendingRestore = null;
            nav.restoring = false;
            syncGlobalNavButtons();
            return;
        }
        state.level = snap.level || 2;
        state.activeModule = snap.activeModule || null;
        state.activeSubDir = snap.activeSubDir || null;
        state.activeFile = snap.activeFile || snap.l2File || null;
        if (snap.l2File) l2State.activeFile = snap.l2File;
        l2State.activeFuncIdx = snap.l2FuncIdx || 0;
        if (typeof window.svRestoreNavSnapshot === 'function') {
            window.svRestoreNavSnapshot(snap.sv);
        }
        setTimeout(() => applyPendingGlobalNavRestore('l3'), 1200);
        return;
    }

    if (window._sv && window._sv.active && typeof window.svHideSvView === 'function') {
        window.svHideSvView();
    }
    if (typeof window.svHideStructureBtn === 'function') window.svHideStructureBtn();

    if (snap.level === 0) {
        loadLevel0();
        return;
    }

    if (snap.level === 1) {
        if (!snap.activeModule) {
            nav.pendingRestore = null;
            nav.restoring = false;
            syncGlobalNavButtons();
            return;
        }
        hideFuncView();
        state.level = 1;
        state.activeModule = snap.activeModule;
        state.activeSubDir = snap.activeSubDir || null;
        state.activeFile = null;
        if (snap.activeSubDir && typeof filterGraphToSubPath === 'function') {
            filterGraphToSubPath(snap.activeModule, snap.activeSubDir);
        } else {
            drillToModule(snap.activeModule);
        }
        return;
    }

    if (snap.level >= 2) {
        const fileRel = snap.l2File || snap.activeFile;
        if (!fileRel) {
            nav.pendingRestore = null;
            nav.restoring = false;
            syncGlobalNavButtons();
            return;
        }
        hideFuncView();
        setL1ToolbarVisible(false);
        if (window.updateFilterTabEnabled) window.updateFilterTabEnabled();
        const ftWrap = document.getElementById('ft-filter');
        if (ftWrap) ftWrap.style.display = 'none';
        state.level = 2;
        state.activeModule = snap.activeModule || null;
        state.activeFile = snap.activeFile || snap.l2File || null;
        l2State.activeFuncIdx = snap.l2FuncIdx || 0;
        openL2File(fileRel, { pushHistory: false, newSession: false });
    }
}

function goGlobalBack() {
    const nav = _globalNavState();
    if (!nav.back.length || nav.restoring) return;
    const current = captureNavSnapshot();
    const prev = nav.back.pop();
    nav.forward.push(current);
    while (nav.forward.length > GLOBAL_NAV_HISTORY_CAP) nav.forward.shift();
    syncGlobalNavButtons();
    _restoreGlobalNavSnapshot(prev);
}

function goGlobalForward() {
    const nav = _globalNavState();
    if (!nav.forward.length || nav.restoring) return;
    const current = captureNavSnapshot();
    const next = nav.forward.pop();
    nav.back.push(current);
    while (nav.back.length > GLOBAL_NAV_HISTORY_CAP) nav.back.shift();
    syncGlobalNavButtons();
    _restoreGlobalNavSnapshot(next);
}

function syncGlobalNavButtons() {
    const nav = _globalNavState();
    const canBack = nav.back.length > 0 && !nav.restoring;
    const canForward = nav.forward.length > 0 && !nav.restoring;

    ['back-btn', 'l1-prev', 'l2-prev', 'sv-back-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = !canBack;
    });
    ['l1-next', 'l2-next', 'sv-fwd-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = !canForward;
    });
}

window.captureNavSnapshot = captureNavSnapshot;
window.pushGlobalNavSnapshot = pushGlobalNavSnapshot;
window.goGlobalBack = goGlobalBack;
window.goGlobalForward = goGlobalForward;
window.syncGlobalNavButtons = syncGlobalNavButtons;
window.applyPendingGlobalNavRestore = applyPendingGlobalNavRestore;
window.isGlobalNavRestoring = isGlobalNavRestoring;
