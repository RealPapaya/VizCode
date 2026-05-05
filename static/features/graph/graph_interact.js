// ─── Node Tap ─────────────────────────────────────────────────────────────────
function onNodeTap(node) {
    hideTooltip();
    clearHighlight();
    const d = node.data();

    if (state.level === 2) {
        if (d._t === 'func') {
            pinHighlightNode(node);
            focusL2Func(d._f, d.idx, { center: true });
            return;
        }
        if (d._t === 'ext_group') {
            toggleExternalGroup(d.mod);
            return;
        }
        // Single-tap: expand/collapse known system API or unresolved groups
        if (d._t === 'sys_group') {
            toggleSysGroup(d.syscat);
            return;
        }
        // sys_func node — highlight and scroll code panel to the callsite
        if (d._t === 'sys_func') {
            pinHighlightNode(node);
            const callerIdx = pickCallerIdxForExternal(node);
            if (callerIdx != null) l2State.activeFuncIdx = callerIdx;
            syncActiveL2FuncCode(d.fn);
            return;
        }
        // Click on a drill_group compound box → collapse it
        if (d._t === 'drill_group') {
            const srcNodeId = d._srcNodeId;
            const srcNode = srcNodeId ? cy.$id(srcNodeId) : null;
            const fn = srcNode?.data('fn') || '';
            _collapseDrillGroup(srcNode || node, node.id(), fn);
            return;
        }

        if (d._t === 'ext_func') {
            // NOTE: drill expand/collapse is handled exclusively by the cy.on('dbltap') handler.
            // Do NOT call drillDownExtFunc here — it races with dbltap: the second tap fires
            // drillDownExtFunc (collapse), then dbltap fires it again (re-expand). ✗
            pinHighlightNode(node);
            if (d._f) {
                _syncCodePanel(d._f, d.fn);
            } else {
                const callerIdx = pickCallerIdxForExternal(node);
                if (callerIdx != null) l2State.activeFuncIdx = callerIdx;
                syncActiveL2FuncCode(d.fn);
            }
            return;
        }
        if (d._t === 'potential_func') {
            // Same — drill handled exclusively by dbltap handler.
            pinHighlightNode(node);
            if (d._f) {
                _syncCodePanel(d._f, d.fn);
            } else {
                const callerIdx = pickCallerIdxForExternal(node);
                if (callerIdx != null) l2State.activeFuncIdx = callerIdx;
                syncActiveL2FuncCode(d.fn);
            }
            return;
        }
    }

    if (state.level === 0 && d._t === 'module') {
        drillToModule(d._m.id);
        return;
    }

    // ─── L1 external module group: toggle expand/collapse ────────────────────
    if (state.level === 1 && d._t === 'dep_ext_group') {
        toggleDepMapExtGroup(d.mod);
        return;
    }

    // ─── L1 external file node: preview in code panel ────────────────────────
    if (state.level === 1 && d._t === 'dep_ext_file') {
        pinHighlightNode(node);
        if (d._f?.path) loadFileInPanel(d._f.path);
        return;
    }

    if (d._t === 'file') {
        const now = performance.now();
        const sameNode = extClickLastId === node.id();
        const isDouble = sameNode && (now - extClickLastTime) < EXT_DOUBLE_CLICK_MS;

        extClickLastId = node.id();
        extClickLastTime = now;

        pinHighlightNode(node);

        if (isDouble) {
            if (d._f?.path) {
                const hasFuncs = window.DATA?.funcs_by_file?.[d._f.path]?.length > 0;
                if (hasFuncs) drillToFile(d._f.path);
            }
        } else {
            // Single click → code panel preview + show call-graph button if file has funcs
            if (d._f?.path) {
                loadFileInPanel(d._f.path);
                updateCallGraphBtn(d._f.path);
                window.revealSidebarExplorerPath?.(d._f.path, 'file');
            }
        }
        return;
    }

    pinHighlightNode(node);
}

// ─── Edge Tap ─────────────────────────────────────────────────────────────────
function onEdgeTap(edge) {
    hideTooltip();

    if (_hlPinned && _hlPinnedNode) {
        const isRelated = edge.source().id() === _hlPinnedNode.id() || edge.target().id() === _hlPinnedNode.id();
        if (!isRelated) {
            clearSelection();
        }
    }

    const d = edge.data();

    if (state.level === 2) {
        const srcData = cy.$id(d.source).data();
        const tgtData = cy.$id(d.target).data();
        if (srcData._t === 'func') {
            const fileRel = srcData._f;
            if (fileRel) _syncCodePanel(fileRel, srcData.fn, tgtData.fn);
        }
        return;
    }

    if (state.level === 1) {
        const srcNode = cy.$id(d.source);
        const tgtNode = cy.$id(d.target);
        const srcFile = srcNode.data('_f');
        const tgtLabel = tgtNode.data('label') || tgtNode.data('_f')?.label || '';
        if (srcFile?.path) {
            _lastTappedEdge = edge;  // remember for code-panel reverse sync
            updateCallGraphBtn(srcFile.path);
            _syncCodePanel(srcFile.path, null, null, tgtLabel);
        }
        return;
    }
}

// ─── Code Panel → Graph sync ──────────────────────────────────────────────────
// Called from viz_code_panel.js when user clicks in the code panel.
// lineIdx: 0-based line index; word: clicked identifier (may be null).
window.cpSyncToGraph = function cpSyncToGraph(lineIdx, word) {
    if (!cy) return;

    // ── L2: line/word → function node (or edge if callee clicked) ────────────
    if (state.level === 2 && l2State.activeFile) {
        const fileRel = l2State.activeFile;
        const funcs = DATA.funcs_by_file[fileRel] || [];
        if (!funcs.length) return;

        // Determine which function body contains lineIdx (the caller)
        let callerIdx = -1;
        if (lineIdx >= 0 && codeState.funcList?.length) {
            const sorted = codeState.funcList.slice().sort((a, b) => a.line - b.line);
            let best = null;
            for (const entry of sorted) {
                if (entry.line <= lineIdx) best = entry;
                else break;
            }
            if (best) callerIdx = funcs.findIndex(f => f.label === best.name);
        }

        // Priority: find an outgoing edge from callerIdx whose target label appears on this line
        if (callerIdx >= 0 && lineIdx >= 0 && codeState.rawLines?.[lineIdx] !== undefined) {
            const lineText = codeState.rawLines[lineIdx];
            const srcId = `fn-${callerIdx}`;
            const outEdges = cy.edges().filter(e => e.data('source') === srcId);
            let bestEdge = null;
            outEdges.forEach(e => {
                if (bestEdge) return;
                const tgt = cy.$id(e.data('target'));
                const tgtFn = e.data('tt')?.split('→')[1]?.trim().split(' ')[0] || '';
                const tgtLabel = tgtFn || tgt.data('fn') || tgt.data('label') || '';
                if (!tgtLabel) return;
                const matches = word
                    ? tgtLabel === word
                    : new RegExp(`\\b${tgtLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lineText);
                if (matches) bestEdge = e;
            });
            if (bestEdge) {
                cy.elements().unselect();
                bestEdge.select();
                cy.animate({ center: { eles: bestEdge }, duration: 200 });
                return;
            }
        }

        // Fallback: select node — priority 1: word match, priority 2: caller by line
        let targetIdx = -1;
        if (word) targetIdx = funcs.findIndex(f => f.label === word);
        if (targetIdx < 0) targetIdx = callerIdx;

        if (targetIdx < 0) return;
        if (l2State.activeFuncIdx === targetIdx) return; // already active, skip
        const node = cy.$id(`fn-${targetIdx}`);
        if (!node || !node.length) return;

        pinHighlightNode(node);
        cy.elements().unselect();
        node.select();
        cy.animate({ center: { eles: node }, duration: 200 });
        l2State.activeFuncIdx = targetIdx;
        updateL2NavButtons();
        return;
    }

    // ── L1: line click → re-select last tapped edge (if line matches its import) ─
    if (state.level === 1) {
        // No-word click: if the highlighted line belongs to the last tapped edge, re-select it
        if (!word && _lastTappedEdge && lineIdx >= 0 && codeState.rawLines?.[lineIdx] !== undefined) {
            const lineText = codeState.rawLines[lineIdx];
            const tgtNode = cy.$id(_lastTappedEdge.data('target'));
            const tgtLabel = tgtNode.data('label') || tgtNode.data('_f')?.label || '';
            const matchStr = tgtLabel.replace(/\.[^.]*$/, '').split('/').pop();
            if (tgtLabel && lineText.includes(matchStr)) {
                cy.elements().unselect();
                _lastTappedEdge.select();
                cy.animate({ center: { eles: _lastTappedEdge }, duration: 200 });
                // Re-apply code line highlight (unselect clears it via re-render side-effects)
                const lineEl = document.getElementById(`cl-${lineIdx}`);
                if (lineEl) {
                    document.querySelectorAll('.code-line.fn-highlight').forEach(el => el.classList.remove('fn-highlight'));
                    lineEl.classList.add('fn-highlight');
                }
                return;
            }
        }

        // Word click: find dep node matching the word, select edge between src and target
        if (word) {
            const currentFile = codeState.currentFile;
            if (!currentFile) return;
            let srcNode = null, targetNode = null;
            cy.nodes().each(n => {
                if (srcNode) return;
                const f = n.data('_f');
                if (f && f.path === currentFile) srcNode = n;
            });
            cy.nodes().each(n => {
                if (targetNode) return;
                const f = n.data('_f');
                if (!f) return;
                const base = (f.path || '').replace(/\\/g, '/').split('/').pop().replace(/\.[^.]*$/, '');
                const lbl = (n.data('label') || '').toLowerCase();
                if (base.toLowerCase() === word.toLowerCase() || lbl === word.toLowerCase()) targetNode = n;
            });
            if (srcNode && targetNode) {
                const edgeCandidates = cy.edges().filter(e => {
                    const d = e.data();
                    return (d.source === srcNode.id() && d.target === targetNode.id()) ||
                           (d.source === targetNode.id() && d.target === srcNode.id());
                });
                if (edgeCandidates.length) {
                    cy.elements().unselect();
                    edgeCandidates.select();
                    pinHighlightNode(targetNode);
                    cy.animate({ center: { eles: edgeCandidates }, duration: 200 });
                    return;
                }
            }
            const focusNode = targetNode || srcNode;
            if (!focusNode) return;
            if (_hlPinnedNode && _hlPinnedNode.same(focusNode)) return;
            pinHighlightNode(focusNode);
            cy.animate({ center: { eles: focusNode }, duration: 200 });
        }
    }
};

// ─── Navigation ───────────────────────────────────────────────────────────────
function goBack() {
    // If Galaxy is active, close it and return to previous view
    if (state.galaxyActive) {
        if (typeof closeGalaxy === 'function') closeGalaxy();
        return;
    }
    const prev = state.history.pop();
    if (!prev) return;
    if (cy) {
        cy.elements().removeClass('faded hl');
    }
    hideFuncView();
    if (prev.level === 0) {
        loadLevel0();
    } else if (prev.level === 1) {
        const savedHistory = [...state.history];
        drillToModule(prev.activeModule);
        state.history = savedHistory;
    }
}

window.goLevel = function (n) {
    if (n === 0) { state.history = []; loadLevel0(); }
    else if (n === 1 && state.activeModule) {
        hideFuncView(); state.history = [{ level: 0 }]; drillToModule(state.activeModule);
    }
};

window.switchTab = function (tab) {
    state.tab = tab;
    document.getElementById('tab-files').classList.toggle('active', tab === 'files');
    document.getElementById('tab-calls').classList.toggle('active', tab === 'calls');
    state.history = []; loadLevel0();
};

window.goBack = goBack;

function _clearGraphNavigationViewport() {
    if (typeof depMapState === 'undefined') return;
    depMapState.preserveViewport = null;
    depMapState.expandOriginPos = null;
    depMapState.pendingFocusFile = null;
}

function updateBreadcrumb() {
    const container = document.getElementById('bc-items');
    container.innerHTML = '';

    function addSeg(label, clickFn, isCurrent, title) {
        if (container.children.length > 0) {
            const sep = document.createElement('span');
            sep.className = 'bc-sep';
            sep.textContent = '›';
            container.appendChild(sep);
        }
        const seg = document.createElement('span');
        seg.className = 'bc-item' + (isCurrent ? ' bc-current' : '');
        seg.textContent = label;
        seg.title = title || label || '';
        if (clickFn) seg.onclick = clickFn;
        container.appendChild(seg);
    }

    // Level 0: always show Modules
    addSeg(T('sidebarModules'), () => { _clearGraphNavigationViewport(); state.history = []; loadLevel0(); }, state.level === 0, 'Modules');

    if (state.level >= 1 && state.activeModule) {
        const isModActive = state.level === 1 && !state.activeSubDir;
        addSeg(state.activeModule,
            isModActive ? null : () => {
                if (state.level >= 2) {
                    const h = [...state.history]; _clearGraphNavigationViewport(); drillToModule(state.activeModule); state.history = h;
                } else {
                    _clearGraphNavigationViewport(); drillToModule(state.activeModule);
                }
            },
            isModActive,
            state.activeModule);
    }

    // Level 1: Sub-directory
    if (state.level === 1 && state.activeSubDir) {
        const parts = state.activeSubDir.split('/');
        parts.forEach((part, i) => {
            const isLast = i === parts.length - 1;
            const subPath = parts.slice(0, i + 1).join('/');
            const fullPath = (state.activeModule ? state.activeModule + '/' : '') + subPath;
            addSeg(part,
                isLast ? null : () => {
                    filterGraphToSubPath(state.activeModule, subPath);
                    setSubdirActive(state.activeModule, subPath);
                },
                isLast,
                fullPath);
        });
    }

    // Level 2: File (functions)
    if (state.level >= 2 && state.level < 3 && state.activeFile) {
        // Build all path segments between module and filename
        const modId = state.activeModule || '';
        const full = state.activeFile;              // e.g. "AmiNetworkPkg/Dhcp4Dxe/Dhcp4Driver.c"
        const prefix = modId ? modId + '/' : '';
        const rel = full.startsWith(prefix) ? full.slice(prefix.length) : full;
        // rel = "Dhcp4Dxe/Dhcp4Driver.c"
        const parts = rel.split('/');              // ["Dhcp4Dxe", "Dhcp4Driver.c"]

        parts.forEach((part, i) => {
            const isLast = i === parts.length - 1;
            const subPath = parts.slice(0, i + 1).join('/');
            const fullPath = (modId ? modId + '/' : '') + subPath;
            addSeg(part,
                isLast ? null : () => {
                    state.level = 1;
                    hideFuncView();
                    if (window._sv && window._sv.active && window.svHideSvView) window.svHideSvView();
                    if (window.svHideStructureBtn) svHideStructureBtn();
                    setCodeBtnEnabled(false);
                    filterGraphToSubPath(state.activeModule, subPath);
                    setSubdirActive(state.activeModule, subPath);
                },
                isLast,
                fullPath);
        });
    }

    _updateBannerBreadcrumbs();

    // Update Back button visibility (now managed via disabled attribute)
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
        if (state.history.length > 0) {
            backBtn.disabled = false;
        } else {
            backBtn.disabled = true;
        }
    }

    // Sync level switcher active segment
    if (window._lswUpdate) {
        const isL2 = state.level >= 2;
        const structActive = !!(window._sv && window._sv.active);
        window._lswUpdate({ active: structActive ? 2 : (isL2 ? 1 : 0) });
    }
}

function _updateBannerBreadcrumbs() {
    const containers = [
        document.getElementById('l1-breadcrumb-items'),
        document.getElementById('l2-breadcrumb-items'),
        document.getElementById('sv-breadcrumb')
    ].filter(Boolean);
    if (!containers.length) return;

    const structActive = !!(window._sv && window._sv.active);
    containers.forEach(container => { container.innerHTML = ''; });

    function addSeg(label, clickFn, isCurrent, title) {
        containers.forEach(container => {
            if (container.children.length > 0) {
                const sep = document.createElement('span');
                sep.className = 'bc-sep';
                sep.textContent = '>';
                container.appendChild(sep);
            }

            const seg = document.createElement('span');
            seg.className = 'bc-item' + (isCurrent ? ' bc-current' : '');
            seg.textContent = label;
            seg.title = title || label || '';
            if (clickFn) seg.addEventListener('click', clickFn);
            container.appendChild(seg);
        });
    }

    addSeg(T('sidebarModules'), () => { _clearGraphNavigationViewport(); state.history = []; loadLevel0(); }, state.level === 0, 'Modules');

    if (state.level >= 1 && state.activeModule) {
        const isModActive = state.level === 1 && !state.activeSubDir;
        addSeg(state.activeModule,
            isModActive ? null : () => {
                if (state.level >= 2) {
                    const h = [...state.history];
                    _clearGraphNavigationViewport(); drillToModule(state.activeModule);
                    state.history = h;
                } else {
                    _clearGraphNavigationViewport(); drillToModule(state.activeModule);
                }
            },
            isModActive,
            state.activeModule);
    }

    if (state.level === 1 && state.activeSubDir) {
        const parts = state.activeSubDir.split('/');
        parts.forEach((part, i) => {
            const isLast = i === parts.length - 1;
            const subPath = parts.slice(0, i + 1).join('/');
            const fullPath = (state.activeModule ? state.activeModule + '/' : '') + subPath;
            addSeg(part,
                isLast ? null : () => {
                    filterGraphToSubPath(state.activeModule, subPath);
                    setSubdirActive(state.activeModule, subPath);
                },
                isLast,
                fullPath);
        });
    }

    if (state.level >= 2 && state.level < 3 && state.activeFile) {
        const modId = state.activeModule || '';
        const full = state.activeFile;
        const prefix = modId ? modId + '/' : '';
        const rel = full.startsWith(prefix) ? full.slice(prefix.length) : full;
        const parts = rel.split('/');

        parts.forEach((part, i) => {
            const isLast = i === parts.length - 1;
            const canReturnFromStructure = isLast && structActive;
            const subPath = parts.slice(0, i + 1).join('/');
            const fullPath = (modId ? modId + '/' : '') + subPath;
            addSeg(part,
                isLast && !canReturnFromStructure ? null : () => {
                    if (canReturnFromStructure && window.svHideSvView) {
                        svHideSvView();
                        updateBreadcrumb();
                        return;
                    }
                    state.level = 1;
                    hideFuncView();
                    if (window._sv && window._sv.active && window.svHideSvView) window.svHideSvView();
                    if (window.svHideStructureBtn) svHideStructureBtn();
                    setCodeBtnEnabled(false);
                    filterGraphToSubPath(state.activeModule, subPath);
                    setSubdirActive(state.activeModule, subPath);
                },
                isLast && !canReturnFromStructure,
                fullPath);
        });
    }

    if (structActive) {
        addSeg('Structure', null, true, 'Structure');
    }
}

function setSidebarActive(modId) {
    document.querySelectorAll('.mod-row').forEach(el => el.classList.remove('active'));
    if (modId) {
        const el = document.getElementById(`mi-${modId}`);
        if (el) el.classList.add('active');
    }
}


window.hideGraphIsolateBtn = _graphHideIsolateBtn;
window.syncGraphIsolateBtn = _graphSyncIsolateBtn;
