// @module viz_graph — Cytoscape core: init, styles, highlight, level navigation
// Owns: initCy, CY_STYLE, clearSelection, highlightNode, clearHighlight,
//       loadLevel0, drillToModule, renderFilesFlat, drillToFile, showFuncView,
//       onNodeTap, goBack, updateBreadcrumb, renderL2Flowchart, etc.

function renderL2Flowchart(fileRel, focusFuncName = null) {
    if (!fileRel) return;
    showLoading(true, T('renderingCallFlow'));
    clearFuncOverlay();
    setL2ToolbarVisible(true);

    if (l2State.activeFile !== fileRel) {
        resetL2State(fileRel);
        l2State._expandInitialized = false;
    }

    const funcs = DATA.funcs_by_file[fileRel] || [];
    if (focusFuncName) {
        const idx = funcs.findIndex(f => f.label === focusFuncName);
        if (idx >= 0) l2State.activeFuncIdx = idx;
    }
    if (l2State.activeFuncIdx >= funcs.length) l2State.activeFuncIdx = 0;
    updateL2Toolbar(fileRel, { funcs: funcs.length, internalEdges: 0, extModules: 0, extFuncs: 0 });

    if (!funcs.length) {
        showFuncViewEmpty(fileRel);
        showLoading(false);
        buildEdgeFilter();
        buildNodeLegend();
        updateSidebarStats();
        return;
    }

    const callList = (DATA.func_calls_by_file && DATA.func_calls_by_file[fileRel]) || null;
    const hasCallList = Array.isArray(callList) && callList.length > 0;
    const legacyEdges = DATA.func_edges_by_file[fileRel] || [];
    const nameToFile = DATA.func_name_to_file || {};
    const nameToFiles = DATA.func_name_to_files || {};  // ambiguous: name → [file, ...]
    const fileToModule = DATA.file_to_module || {};
    const moduleColorMap = {};
    (DATA.modules || []).forEach(m => { moduleColorMap[m.id] = m.color; });

    const currentModule = fileToModule[fileRel] || resolveModuleForFile(fileRel) || '';

    const fidMap = new Map();
    funcs.forEach((f, i) => fidMap.set(f.label, i));

    const isSimple = _shapeMode === 'simple';
    const els = [];
    funcs.forEach((f, i) => {
        const isPublic = !!f.is_public;
        const isEfi = !!f.is_efiapi;
        const bg = isEfi ? '#3d2e00' : isPublic ? '#0b2745' : '#1e2433';
        const bc = isEfi ? '#fbbf24' : isPublic ? '#60a5fa' : '#94a3b8';
        const access = isPublic ? T('public') : T('static');
        els.push({
            data: {
                id: `fn-${i}`, label: f.label,
                bg: isSimple ? bc : bg, bc,
                w: isSimple ? SIMPLE_NODE_SIZE_SM : 150, h: isSimple ? SIMPLE_NODE_SIZE_SM : 38,
                sh: isSimple ? 'ellipse' : 'roundrectangle',
                lvl: 2, _t: 'func', fn: f.label, _f: fileRel,
                idx: i, access, tt: `${T('function')}: ${f.label}\n${access}${isEfi ? ' EFIAPI' : ''}${f.doc ? '\n\n' + f.doc : ''}`,
                simple: isSimple ? 1 : 0,
            }
        });
    });

    // extMap:  modName → Map<funcName, { files[], callers:Set }>
    // potMap:  key     → { callee, files[], callers:Set }   (ambiguous)
    // sysMap:  category → Map<funcName, callers:Set>        (known system/UEFI/C-runtime)
    const extMap = new Map();
    const potMap = new Map();
    const sysMap = new Map();
    let internalEdgeCount = 0;

    const knownCats = DATA.func_known_categories || {};

    function addExt(modName, callee, targetFiles, callerIdx) {
        if (!extMap.has(modName)) extMap.set(modName, new Map());
        const fm = extMap.get(modName);
        if (!fm.has(callee)) fm.set(callee, { files: targetFiles, callers: new Set() });
        fm.get(callee).callers.add(callerIdx);
    }

    function addSys(category, callee, callerIdx) {
        if (!sysMap.has(category)) sysMap.set(category, new Map());
        const cm = sysMap.get(category);
        if (!cm.has(callee)) cm.set(callee, new Set());
        cm.get(callee).add(callerIdx);
    }

    if (hasCallList) {
        for (let i = 0; i < funcs.length; i++) {
            const calls = Array.isArray(callList[i]) ? callList[i] : [];
            const uniq = new Set(calls);
            for (const callee of uniq) {
                const calleeIdx = fidMap.get(callee);
                if (calleeIdx != null) {
                    if (calleeIdx === i) continue;
                    els.push({
                        data: {
                            id: `ie-${i}-${calleeIdx}`,
                            source: `fn-${i}`, target: `fn-${calleeIdx}`,
                            w: EDGE_WIDTH.callInternal, ec: edgeTypeStyle('call').color, es: EDGE_STYLE_INTERNAL,
                            el: '', kind: 'call', l2kind: 'call_internal',
                            tt: `${funcs[i].label} → ${callee}`,
                        }
                    });
                    internalEdgeCount++;
                    continue;
                }
                if (!l2State.showExternalFuncs) continue;
                if (Object.prototype.hasOwnProperty.call(nameToFiles, callee)) {
                    const k = `pot:${callee}`;
                    if (!potMap.has(k)) potMap.set(k, { callee, files: nameToFiles[callee], callers: new Set() });
                    potMap.get(k).callers.add(i);
                    continue;
                }
                const targetFile = Object.prototype.hasOwnProperty.call(nameToFile, callee) ? nameToFile[callee] : null;
                if (!targetFile) {
                    const knownCat = knownCats[callee];
                    if (knownCat) {
                        addSys(knownCat, callee, i);
                    }
                    continue;
                }
                addExt(fileToModule[targetFile] || '_root', callee, [targetFile], i);
            }
        }
    } else {
        legacyEdges.forEach((e, idx) => {
            const leStyle = edgeTypeStyle(e.type || 'call');
            els.push({
                data: {
                    id: `le-${idx}`, source: `fn-${e.s}`, target: `fn-${e.t}`,
                    w: EDGE_WIDTH.callInternal, ec: leStyle.color, es: EDGE_STYLE_INTERNAL,
                    el: '', kind: leStyle.kind || 'call', l2kind: 'call_internal', tt: leStyle.label || 'Call'
                }
            });
        });
        internalEdgeCount = legacyEdges.length;
    }

    l2State.externalModules = Array.from(extMap.keys()).sort();

    // First time entering this file → default expand all external modules
    if (!l2State._expandInitialized) {
        l2State.expandedModules = new Set(extMap.keys());
        l2State._expandInitialized = true;
    }

    // ─── External module groups ───────────────────────────────────────────────
    for (const [modName, fnMap] of extMap.entries()) {
        const modSlug = _safeId(modName) + '-' + _hashId(modName);
        const modId = `extmod-${modSlug}`;
        const funcCount = fnMap.size;
        const isExpanded = l2State.expandedModules.has(modName);
        const modColor = moduleColorMap[modName] || '#64748b';
        // Use a representative file path from this module for accurate distance
        const repFile = fnMap.values().next().value?.files?.[0] || modName;
        const distVal = _pathDist(fileRel, repFile);
        const ec = _distColor(distVal);
        const dLabel = _distLabel(distVal);

        if (!isExpanded) {
            // Unexpanded: show the big group node and aggregate edges
            els.push({
                data: {
                    id: modId, label: `${modName}\n${funcCount} funcs`,
                    bg: isSimple ? modColor : '#111827', bc: modColor,
                    w: isSimple ? SIMPLE_NODE_SIZE_MD : 170, h: isSimple ? SIMPLE_NODE_SIZE_MD : 52,
                    sh: isSimple ? 'ellipse' : 'roundrectangle', lvl: 2, simple: isSimple ? 1 : 0,
                    _t: 'ext_group', mod: modName,
                    tt: `${T('externalModule')}: ${modName}\n${T('topbarFunctions')}: ${funcCount}\n\n${T('clickToExpand')}`,
                }
            });

            const callerCounts = new Map();
            fnMap.forEach(info => info.callers.forEach(idx => callerCounts.set(idx, (callerCounts.get(idx) || 0) + 1)));
            for (const [callerIdx, count] of callerCounts.entries()) {
                els.push({
                    data: {
                        id: `exte-${modId}-${callerIdx}`,
                        source: `fn-${callerIdx}`, target: modId,
                        w: Math.min(2.6, EDGE_WIDTH.callExternal + count * 0.3), ec, es: EDGE_STYLE_EXTERNAL, el: 'ext',
                        l2kind: 'call_ext',
                        tt: `${funcs[callerIdx].label} → ${modName} (${count})`,
                    }
                });
            }
        } else {
            // Expanded: do NOT show the group bounding box. Show individual external funcs.
            let extIdx = 0;
            fnMap.forEach((info, funcName) => {
                const fnId = `extfn-${modSlug}-${_hashId(funcName)}`;
                const tf = info.files[0] || null;
                const fnDist = _pathDist(fileRel, tf || modName);
                const fnEc = _distColor(fnDist); // use actual file path for accurate distance
                const fnDLabel = _distLabel(fnDist);
                els.push({
                    data: {
                        id: fnId,
                        label: `${funcName}\n(${modName})`,
                        bg: isSimple ? modColor : '#0f172a', bc: modColor,
                        w: isSimple ? SIMPLE_NODE_SIZE_SM : 160, h: isSimple ? SIMPLE_NODE_SIZE_SM : 42,
                        sh: isSimple ? 'ellipse' : 'roundrectangle', lvl: 2, simple: isSimple ? 1 : 0,
                        _t: 'ext_func', fn: funcName, _f: tf, mod: modName, _drilled: false,
                        tt: `${funcName}\n${tf || T('fileUnknown')}\n${T('modalModule')}: ${modName}\n\n${T('doubleClickDrill')}\n${T('clickToCollapse')}`,
                    }
                });
                info.callers.forEach(callerIdx => {
                    els.push({
                        data: {
                            id: `extc-${modId}-${callerIdx}-${_hashId(funcName)}`,
                            source: `fn-${callerIdx}`, target: fnId,
                            w: EDGE_WIDTH.callExternal, ec: fnEc, es: EDGE_STYLE_EXTERNAL, el: 'ext',
                            l2kind: 'call_ext',
                            tt: `${funcs[callerIdx].label} → ${funcName}`,
                        }
                    });
                });
                extIdx++;
            });
        }
    }

    // ─── Potential / ambiguous nodes ──────────────────────────────────────────
    for (const [, info] of potMap.entries()) {
        const { callee, files, callers } = info;
        const slug = _safeId(callee) + '-' + _hashId(callee);
        const potId = `pot-${slug}`;
        const firstMod = fileToModule[files[0]] || '';
        const dVal = files[0] ? _pathDist(fileRel, files[0]) : 99;
        const ec = files[0] ? _distColor(dVal) : '#a78bfa';
        els.push({
            data: {
                id: potId, label: `${callee}\n(${files.length} paths)`,
                bg: isSimple ? '#a78bfa' : '#1a1040', bc: '#a78bfa',
                w: isSimple ? SIMPLE_NODE_SIZE_SM : 160, h: isSimple ? SIMPLE_NODE_SIZE_SM : 44,
                sh: isSimple ? 'ellipse' : 'roundrectangle', lvl: 2, simple: isSimple ? 1 : 0,
                _t: 'potential_func', fn: callee, _files: files,
                tt: `Ambiguous: ${callee}\n${T('tooltipPossibleFiles')}\n${files.join('\n')}`,
            }
        });
        callers.forEach(callerIdx => {
            els.push({
                data: {
                    id: `pote-${slug}-${callerIdx}`,
                    source: `fn-${callerIdx}`, target: potId,
                    w: EDGE_WIDTH.callExternal, ec, es: EDGE_STYLE_EXTERNAL, el: 'ext',
                    l2kind: 'call_potential',
                    tt: `${funcs[callerIdx].label} → ${callee} (ambiguous)`,
                }
            });
        });
    }

    // ─── Store sysMap on l2State so toggleSysGroup and expand/collapse all can access ─
    l2State._sysMap = sysMap;
    l2State._funcs = funcs;
    l2State.sysCategories = Array.from(sysMap.keys());

    // ─── Known System / UEFI / C-runtime category groups ─────────────────────
    const SYS_CAT_STYLE = {
        'UEFI Boot Services': { color: '#60a5fa', bg: '#0b1e38' },
        'UEFI Runtime Services': { color: '#818cf8', bg: '#110e2e' },
        'EDK2 MemoryLib': { color: '#34d399', bg: '#0a2218' },
        'EDK2 BaseLib': { color: '#dfa745', bg: '#021a22' },
        'EDK2 DebugLib': { color: '#fbbf24', bg: '#1f1500' },
        'EDK2 PrintLib': { color: '#fbbf24', bg: '#1f1500' },
        'EDK2 MemAlloc': { color: '#34d399', bg: '#0a2218' },
        'PEI Services': { color: '#a78bfa', bg: '#180d2e' },
        'EDK2 HobLib': { color: '#a78bfa', bg: '#180d2e' },
        'EDK2 UefiLib': { color: '#60a5fa', bg: '#0b1e38' },
        'EDK2 DevicePath': { color: '#60a5fa', bg: '#0b1e38' },
        'C Runtime': { color: '#fb923c', bg: '#1e0e00' },
        'AMI SDK': { color: '#e879f9', bg: '#1e0820' },
        'CPU/IO Lib': { color: '#f87171', bg: '#200808' },
        'Status Code': { color: '#94a3b8', bg: '#0f1520' },
    };
    const SYS_DEFAULT = { color: '#64748b', bg: '#101820' };

    if (!l2State.expandedSysCategories) l2State.expandedSysCategories = new Set();

    for (const [catName, fnMap] of sysMap.entries()) {
        const catSlug = _safeId(catName) + '-' + _hashId(catName);
        const groupId = `syscat-${catSlug}`;
        const style = SYS_CAT_STYLE[catName] || SYS_DEFAULT;
        const funcCount = fnMap.size;
        const isExpanded = l2State.expandedSysCategories.has(catName);

        const allCallers = new Map();
        fnMap.forEach(callerSet => callerSet.forEach(idx => allCallers.set(idx, (allCallers.get(idx) || 0) + 1)));

        if (!isExpanded) {
            els.push({
                data: {
                    id: groupId,
                    label: `${catName}\n${funcCount} funcs`,
                    bg: isSimple ? style.color : style.bg, bc: style.color,
                    w: isSimple ? SIMPLE_NODE_SIZE_MD : 170, h: isSimple ? SIMPLE_NODE_SIZE_MD : 52,
                    sh: isSimple ? 'ellipse' : 'roundrectangle', lvl: 2, simple: isSimple ? 1 : 0,
                    _t: 'sys_group', syscat: catName,
                    tt: `${catName}\n${funcCount} funcs\n\nClick to expand ↕`,
                }
            });
            allCallers.forEach((count, callerIdx) => {
                els.push({
                    data: {
                        id: `syse-${catSlug}-${callerIdx}`,
                        source: `fn-${callerIdx}`, target: groupId,
                        w: Math.min(3, 1 + count / 3), ec: style.color,
                        es: 'solid', el: '', l2kind: 'call_sys',
                        tt: `→ ${catName} (${count} call${count !== 1 ? 's' : ''})`,
                    }
                });
            });
        } else {
            fnMap.forEach((callerSet, funcName) => {
                const fnId = `sysfn-${catSlug}-${_hashId(funcName)}`;
                els.push({
                    data: {
                        id: fnId,
                        label: `${funcName}\n(${catName})`,
                        bg: isSimple ? style.color : style.bg, bc: style.color,
                        w: isSimple ? SIMPLE_NODE_SIZE_SM : 160, h: isSimple ? SIMPLE_NODE_SIZE_SM : 42,
                        sh: isSimple ? 'ellipse' : 'roundrectangle', lvl: 2, simple: isSimple ? 1 : 0,
                        _t: 'sys_func', fn: funcName, syscat: catName,
                        tt: `${funcName}\nCategory: ${catName}\n\nKnown system API — no source in this codebase.`,
                    }
                });
                callerSet.forEach(callerIdx => {
                    els.push({
                        data: {
                            id: `sysfne-${catSlug}-${callerIdx}-${_hashId(funcName)}`,
                            source: `fn-${callerIdx}`, target: fnId,
                            w: 1.5, ec: style.color, es: 'solid', el: '', l2kind: 'call_sys',
                            tt: `${funcs[callerIdx].label} → ${funcName}`,
                        }
                    });
                });
            });
        }
    }


    l2State._animGen++;

    // ── Yield to browser so the loading spinner can paint before heavy work ──
    const _l2Token = ++_renderToken;
    setTimeout(() => {
        if (_renderToken !== _l2Token) return; // cancelled

        cy.elements().stop(true, false);
        l2State._prevNodeIds = new Set(cy.nodes().map(n => n.id()));

        cy.elements().remove();
        cy.add(els);
        applyCyFont(getSavedFont());
        applyExternalEdgeVisibility();

        const l2LayoutId = _PREFS.get('layoutL2');
        const l2Preset = LAYOUT_PRESETS.find(p => p.id === l2LayoutId);
        const canUseL2 = l2Preset && (!l2Preset.requires || _isLayoutAvailable(l2Preset.requires));
        const l2Config = canUseL2
            ? { ...l2Preset.config(), animate: false }
            : { name: 'dagre', rankDir: 'LR', animate: false, nodeSep: 26, rankSep: 80, padding: 50 };
        const lay = cy.layout(l2Config);
        _syncLayoutIndicator(canUseL2 ? l2LayoutId : 'dagre-lr');
        refreshLayoutSwitcher();  // update visible layout buttons for level 2
        lay.one('layoutstop', () => {
            if (_renderToken !== _l2Token) return;

            updateBreadcrumb();
            showLoading(false);
            buildEdgeFilter();
            buildNodeLegend();
            updateSidebarStats();
            updateL2Toolbar(fileRel, {
                funcs: funcs.length,
                internalEdges: internalEdgeCount,
                extModules: extMap.size,
                extFuncs: Array.from(extMap.values()).reduce((a, m) => a + m.size, 0),
                legacy: !hasCallList,
            });
            updateExternalToggle();
            updateExternalFuncsToggle();
            focusL2Func(fileRel, l2State.activeFuncIdx || 0, { center: false, openCodePanel: false });

            const savedVP = l2State.preserveViewport;
            const originPos = l2State.expandOriginPos;
            const prevIds = l2State._prevNodeIds || new Set();

            if (savedVP && originPos) {
                cy.viewport({ zoom: savedVP.zoom, pan: savedVP.pan });

                const newNodes = cy.nodes('[_t="ext_func"],[_t="sys_func"]').filter(n => !prevIds.has(n.id()));

                if (newNodes.length > 0) {
                    const finalPos = new Map();
                    newNodes.forEach(n => finalPos.set(n.id(), { ...n.position() }));
                    newNodes.forEach(n => n.position({ x: originPos.x, y: originPos.y }));

                    const myGen = l2State._animGen;
                    let idx = 0;
                    newNodes.forEach(n => {
                        const fp = finalPos.get(n.id());
                        const nid = n.id();
                        const delay = idx * 18;
                        setTimeout(() => {
                            if (l2State._animGen !== myGen) return;
                            if (!cy.hasElementWithId(nid)) return;
                            cy.$id(nid).animate({ position: fp }, { duration: 360, easing: 'ease-out-cubic' });
                        }, delay);
                        idx++;
                    });
                } else {
                    cy.animate({ fit: { eles: cy.elements(), padding: 50 }, duration: 400 });
                }
            } else if (savedVP && !focusFuncName) {
                // Exact restore — preserve camera for collapse / prev / next navigation
                cy.viewport({ zoom: savedVP.zoom, pan: savedVP.pan });
            } else if (focusFuncName) {
                const targetNode = cy.$id(`fn-${l2State.activeFuncIdx}`);
                if (targetNode && targetNode.length) {
                    setTimeout(() => {
                        highlightNode(targetNode);
                        cy.animate({
                            center: { eles: targetNode },
                            zoom: Math.max(cy.zoom(), 1.8),
                        }, {
                            duration: 700,
                            easing: 'ease-in-out-cubic',
                            complete: () => {
                                let count = 0;
                                const originalBc = targetNode.data('bc');
                                const flashInterval = setInterval(() => {
                                    count++;
                                    if (!cy.hasElementWithId(targetNode.id())) { clearInterval(flashInterval); return; }
                                    targetNode.style('border-color', count % 2 === 1 ? _tC('#ffffff', '#8c7851') : originalBc);
                                    targetNode.style('border-width', count % 2 === 1 ? 4 : 2);
                                    if (count >= 6) {
                                        clearInterval(flashInterval);
                                        targetNode.style('border-color', originalBc);
                                        targetNode.style('border-width', 2);
                                    }
                                }, 200);
                            }
                        });
                    }, 80);
                } else {
                    cy.animate({ fit: { eles: cy.elements(), padding: 50 }, duration: 400 });
                }
            } else {
                cy.animate({ fit: { eles: cy.elements(), padding: 50 }, duration: 400 });
            }

            l2State.preserveViewport = null;
            l2State.expandOriginPos = null;
            l2State._prevNodeIds = null;

            renderL2Legend();
        });
        lay.run();
    }, 0);
}

// Drill the currently active file (code panel or selected node) to L2 caller/callee
function drillCurrentFileToL2() {
    // Priority: use code panel's current file if open
    const filePath = codeState.currentFile
        || (cy?.nodes(':selected').first().data('_f')?.path)
        || null;

    if (!filePath) {
        // Highlight the button to signal "select a file first"
        const btn = document.getElementById('graph-toggle-btn');
        btn.style.borderColor = '#f87171';
        btn.style.color = '#f87171';
        setTimeout(() => {
            btn.style.borderColor = '';
            btn.style.color = '';
        }, 900);
        return;
    }

    // If we're already at L2 for this file, just bring it into focus
    if (state.level === 2 && state.activeFile === filePath) return;

    // Need to be in L1 context first — find which module this file belongs to
    if (state.level < 1) {
        // Find module
        for (const m of DATA.modules) {
            const files = DATA.files_by_module[m.id] || [];
            if (files.some(f => f.path === filePath)) {
                drillToModule(m.id);
                break;
            }
        }
    }
    drillToFile(filePath);
    document.getElementById('graph-toggle-btn').classList.add('active');
}

// ─── Lazy drill-down on ext_func / potential_func double-click ────────────────
// Expand → wraps callees in a compound box labeled with the source filename.
// Collapse → removes the box + all children (double-click again or click the box).
function drillDownExtFunc(node) {
    const d = node.data();
    const targetFile = d._f || null;
    const funcName = d.fn || null;
    if (!targetFile || !funcName) return;

    const nodeId = node.id();
    const groupId = `dgroup-${_hashId(nodeId)}`;

    // ── Collapse if already drilled ──────────────────────────────────────────
    if (d._drilled) {
        _collapseDrillGroup(node, groupId, funcName);
        return;
    }

    // ── Expand ───────────────────────────────────────────────────────────────
    const funcs = DATA.funcs_by_file[targetFile] || [];
    const callList = DATA.func_calls_by_file?.[targetFile] || null;
    const nameToFile = DATA.func_name_to_file || {};
    const nameToFiles = DATA.func_name_to_files || {};
    const fileToModule = DATA.file_to_module || {};

    const fidIdx = funcs.findIndex(f => f.label === funcName);
    if (fidIdx < 0 || !Array.isArray(callList)) {
        node.data('label', funcName + '\n(leaf)');
        return;
    }

    const callees = new Set(Array.isArray(callList[fidIdx]) ? callList[fidIdx] : []);
    if (callees.size === 0) {
        node.data('label', funcName + '\n(leaf)');
        return;
    }

    // Determine group border color from the source ext_func node
    const groupColor = node.data('bc') || '#64748b';
    const fileLabel = targetFile.split('/').pop();   // filename only

    // Create the compound parent group node FIRST (must exist before children)
    const groupNode = {
        data: {
            id: groupId,
            label: fileLabel,
            _t: 'drill_group',
            _srcNodeId: nodeId,
            bc: groupColor,
            bg: '#0b1929',
        }
    };

    const newEls = [groupNode];

    for (const callee of callees) {
        const childId = `drill-${_hashId(nodeId)}-${_hashId(callee)}`;
        if (cy.$id(childId).length) continue;   // guard against dupes

        let tf = null, modName = '', ec = '#64748b', bc = '#64748b';
        if (Object.prototype.hasOwnProperty.call(nameToFiles, callee)) {
            tf = nameToFiles[callee][0];
            modName = fileToModule[tf] || '';
            ec = bc = '#a78bfa';
        } else if (Object.prototype.hasOwnProperty.call(nameToFile, callee)) {
            tf = nameToFile[callee];
            modName = fileToModule[tf] || '';
            const dVal = _pathDist(targetFile, tf);
            ec = bc = _distColor(dVal);
        }

        newEls.push({
            data: {
                id: childId, label: callee,
                parent: groupId,              // ← inside compound box
                bg: '#0d1f33', bc: bc || '#64748b',
                w: 160, h: 30, sh: 'roundrectangle', lvl: 2,
                _t: 'drilled_func', fn: callee, _f: tf, mod: modName, _drilled: false,
                tt: tf ? `${callee}\n${tf}\n\nDouble-click to drill further` : `${callee}\n(no file found)`,
            }
        });
        // Edge: from the ext_func node to each child
        newEls.push({
            data: {
                id: `drille-${_hashId(nodeId)}-${_hashId(callee)}`,
                source: nodeId, target: childId,
                w: EDGE_WIDTH.drillExternal, ec: ec || '#64748b', es: EDGE_STYLE_EXTERNAL, el: '',
                l2kind: 'call_ext',
                tt: `${funcName} → ${callee}`,
            }
        });
    }

    // Mark source node as drilled
    node.data('_drilled', true);
    node.data('label', funcName + ' ↳');
    node.style('border-style', 'double');

    cy.add(newEls);

    // Re-layout keeping viewport
    const vp = { pan: { ...cy.pan() }, zoom: cy.zoom() };
    cy.layout({
        name: 'dagre', rankDir: 'LR', animate: true, animationDuration: 300,
        nodeSep: 26, rankSep: 80, padding: 50,
    }).one('layoutstop', () => {
        cy.viewport(vp);   // stay where user was looking
    }).run();
}

/** Remove the drill group compound node + all its children, reset the source node. */
function _collapseDrillGroup(srcNode, groupId, funcName) {
    const group = cy.$id(groupId);
    if (group && group.length) {
        // Remove children (and their edges) then the group itself
        group.children().remove();
        group.remove();
    }
    // Reset source ext_func node
    srcNode.data('_drilled', false);
    srcNode.data('label', funcName || srcNode.data('fn'));
    srcNode.style('border-style', 'solid');

    const vp = { pan: { ...cy.pan() }, zoom: cy.zoom() };
    cy.layout({
        name: 'dagre', rankDir: 'LR', animate: true, animationDuration: 250,
        nodeSep: 26, rankSep: 80, padding: 50,
    }).one('layoutstop', () => {
        cy.viewport(vp);
    }).run();
}

// Legend is now in the Filters sidebar tab. These functions remove any leftover
// floating elements and delegate to buildEdgeFilter() + buildNodeLegend().
function renderL2Legend() {
    clearL2Legend();
    buildEdgeFilter();
    buildNodeLegend();
}

function clearL2Legend() {
    // Remove any floating legend elements from older renders
    ['l2-legend', 'graph-legend'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });
}


// ─── Cytoscape ────────────────────────────────────────────────────────────────
function initCy() {
    const savedFont = getSavedFont();

    // Create a dynamic style config that includes the real font string
    const dynamicStyle = withFont(CY_STYLE, savedFont);

    cy = cytoscape({
        container: document.getElementById('cy'),
        style: dynamicStyle,
        elements: [],
        minZoom: GRAPH_ZOOM_SETTINGS.minZoom,
        maxZoom: GRAPH_ZOOM_SETTINGS.maxZoom,
        wheelSensitivity: GRAPH_ZOOM_SETTINGS.wheelSensitivity,
        boxSelectionEnabled: false,
        // ── Performance ───────────────────────────────────────────────────────────
        textureOnViewport: false,                               // avoids black artifacts on dark bg
        motionBlur: false,                                      // avoids dark-frame accumulation
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), // cap HiDPI render cost
    });
    cy.on('zoom', () => {
        if (_bgPointerDown) _bgPointerMoved = true;
        refreshGraphZoomControls();
        _startLabelTracking();    // defer placement to after camera settles
    });
    cy.on('pan', () => {
        if (_bgPointerDown) _bgPointerMoved = true;
        _startLabelTracking();    // defer placement to after camera settles
    });
    cy.on('layoutstop', () => {
        _spatialPlacementNow();
        _startLabelTracking();
    });
    cy.on('mousedown', e => {
        const oe = e.originalEvent;
        if (oe && typeof oe.button === 'number' && oe.button !== 0) return;
        _bgPointerDown = e.target === cy;
        _bgPointerMoved = false;
        _bgPointerDownPos = (_bgPointerDown && e.renderedPosition)
            ? { x: e.renderedPosition.x, y: e.renderedPosition.y }
            : null;
    });
    cy.on('mousemove', e => {
        if (!_bgPointerDown || _bgPointerMoved || !_bgPointerDownPos || !e.renderedPosition) return;
        const dx = e.renderedPosition.x - _bgPointerDownPos.x;
        const dy = e.renderedPosition.y - _bgPointerDownPos.y;
        if ((dx * dx + dy * dy) >= (_BACKGROUND_CLEAR_DRAG_PX * _BACKGROUND_CLEAR_DRAG_PX)) {
            _bgPointerMoved = true;
        }
    });
    cy.on('mouseup', e => {
        const shouldClear = e.target === cy && _bgPointerDown && !_bgPointerMoved;
        _bgPointerDown = false;
        _bgPointerMoved = false;
        _bgPointerDownPos = null;
        if (shouldClear) clearSelection();
    });
    cy.on('tap', 'node', e => onNodeTap(e.target));
    cy.on('tap', 'edge', e => onEdgeTap(e.target));
    cy.on('mouseover', 'edge', e => { 
        e.target.addClass('edge-hovered'); 
        if (state.level !== 2) showTooltip(e); 
    });
    cy.on('mouseout', 'edge', e => { 
        e.target.removeClass('edge-hovered'); 
        if (state.level !== 2) scheduleHideTooltip(); 
    });
    cy.on('cxttap', 'node', e => onNodeRightClick(e, e.target));
    cy.on('mouseover', 'node', e => {
        const node = e.target;
        if (_hoveredNodeClearTimer) { clearTimeout(_hoveredNodeClearTimer); _hoveredNodeClearTimer = null; }
        if (_hlPinned) {
            // Cancel any pending highlightNode call from scheduleHideTooltip —
            // otherwise it runs cy.elements().addClass('faded') and re-fades the hovered node.
            if (tooltipHideTimer) { clearTimeout(tooltipHideTimer); tooltipHideTimer = null; }
            if (_hoveredNode && !_hoveredNode.same(node)) _clearHoveredNodeStyle();
            const isPinnedRelated = node.hasClass('selected-label') || node.hasClass('neighbor-label');
            if (isPinnedRelated) {
                showTooltip(e);
                return;
            }
            node.removeClass('faded');
            node.addClass('node-hovered');
            _hoveredNode = node;
            return;
        }
        showTooltip(e);
        highlightNode(node);
    });
    cy.on('mouseout', 'node', e => {
        scheduleHideTooltip();
        const node = e.target;
        if (_hoveredNode && _hoveredNode.same(node)) {
            _hoveredNodeClearTimer = setTimeout(() => {
                _hoveredNodeClearTimer = null;
                _clearHoveredNodeStyle();
            }, 80);
        }
    });
    // Double-tap ext/drilled/potential func nodes → lazy drill-down (or collapse if drilled)
    cy.on('dbltap', 'node', e => {
        const d = e.target.data();
        if (d._t === 'drill_group') {
            // double-tap on group = collapse
            const srcNode = d._srcNodeId ? cy.$id(d._srcNodeId) : null;
            _collapseDrillGroup(srcNode || e.target, e.target.id(), srcNode?.data('fn') || '');
            return;
        }
        if (d._t === 'ext_func' || d._t === 'drilled_func' || d._t === 'potential_func') {
            drillDownExtFunc(e.target);
        }
    });
    cy.on('zoom', () => {
        if (_labelZoomRaf) return;
        _labelZoomRaf = requestAnimationFrame(() => {
            _labelZoomRaf = null;
            _updateSelectedLabelZoom();
        });
    });
    document.getElementById('cy').addEventListener('contextmenu', e => e.preventDefault());
}

function clearSelection() {
    _graphHideIsolateBtn();
    _hlPinned = false;
    _hlPinnedNode = null;
    _clearHoveredNodeStyle();
    _clearSelectedLabelStyle();
    clearHighlight();
    document.querySelectorAll('.code-line.fn-highlight').forEach(el => el.classList.remove('fn-highlight'));
}

function highlightNode(node) {
    if (tooltipHideTimer) clearTimeout(tooltipHideTimer);
    // Temporarily override any pinned highlight without clearing the pin.
    cy.elements().removeClass('hl hl-edge-out hl-edge-in hl-node-out hl-node-in');
    cy.elements().addClass('faded');
    node.removeClass('faded').addClass('hl');
    const outEdges = node.outgoers('edge');
    outEdges.removeClass('faded').addClass('hl-edge-out');
    outEdges.targets().removeClass('faded').addClass('hl-node-out');
    const inEdges = node.incomers('edge');
    inEdges.removeClass('faded').addClass('hl-edge-in');
    inEdges.sources().removeClass('faded').addClass('hl-node-in');
}

function pinHighlightNode(node) {
    _clearHoveredNodeStyle();
    _clearSelectedLabelStyle();
    _hlPinned = false;
    highlightNode(node);
    _hlPinned = true;
    _hlPinnedNode = node;
    _applySelectedLabelStyle(node);
    _graphShowIsolateBtn();
    _applyGraphIsolateState();
}

let _hlPinned = false;
let _hlPinnedNode = null;
let _lastTappedEdge = null;  // L1: last edge tapped, for code-panel reverse sync
let _hoveredNodeClearTimer = null;
let _labelStyledNodes = null; // Cytoscape collection: pinned node + all neighbors
let _selectedLabelNode = null; // pinned node that keeps zoom-invariant label size
let _neighborLabelNodes = null; // highlighted neighbors that share the label emphasis
let _hoveredNode = null;      // non-highlighted node currently hovered
let _graphIsolateMode = false;
let _graphIsolateBtn = null;
let _bgPointerDown = false;
let _bgPointerMoved = false;
let _bgPointerDownPos = null;
let _labelZoomRaf = null; // RAF handle for throttling _updateSelectedLabelZoom
const _BACKGROUND_CLEAR_DRAG_PX = 6;

// ── Zoom-aware label emphasis for the selected subgraph ─────────────────────
const _SELECTED_LABEL_SIZE = 13;
const _NEIGHBOR_LABEL_SIZE = 12;
const _HOVER_MARGIN_Y = -10; // desired screen-px gap above node
const _DEFAULT_NODE_LABEL_SIZE = 11;
const _L0_NODE_LABEL_SIZE = 12;
const _L1_NODE_LABEL_SIZE = 10;
const _DEFAULT_TEXT_MAX_WIDTH = 160;
const _SIMPLE_TEXT_MAX_WIDTH = 80;

function _getBaseNodeLabelFontSize(node) {
    if (!node || !node.length) return _DEFAULT_NODE_LABEL_SIZE;
    const lvl = Number(node.data('lvl'));
    if (lvl === 0) return _L0_NODE_LABEL_SIZE;
    if (lvl === 1) return _L1_NODE_LABEL_SIZE;
    return _DEFAULT_NODE_LABEL_SIZE;
}

function _getBaseNodeTextMaxWidth(node) {
    if (!node || !node.length) return _DEFAULT_TEXT_MAX_WIDTH;
    return node.data('simple') ? _SIMPLE_TEXT_MAX_WIDTH : _DEFAULT_TEXT_MAX_WIDTH;
}

function _getHighlightedLabelFontSize(node, targetScreenPx, zoom) {
    const safeZoom = Math.max(zoom || 1, 0.0001);
    const baseSize = _getBaseNodeLabelFontSize(node);
    return Math.max(baseSize, Math.round(targetScreenPx / safeZoom));
}

function _getHighlightedTextMaxWidth(node, targetScreenPx, zoom) {
    const safeZoom = Math.max(zoom || 1, 0.0001);
    const baseWidth = _getBaseNodeTextMaxWidth(node);
    return Math.max(baseWidth, Math.round(targetScreenPx / safeZoom));
}

function _updateSelectedLabelZoom() {
    if (!cy) return;
    const z = cy.zoom();
    if (_selectedLabelNode && _selectedLabelNode.length) {
        const fs = _getHighlightedLabelFontSize(_selectedLabelNode, _SELECTED_LABEL_SIZE, z);
        _selectedLabelNode.style('font-size', fs);
        _selectedLabelNode.style('text-max-width', _getHighlightedTextMaxWidth(_selectedLabelNode, _DEFAULT_TEXT_MAX_WIDTH, z));
        _selectedLabelNode.style('text-margin-x', 0);
    }
    if (_neighborLabelNodes && _neighborLabelNodes.length) {
        _neighborLabelNodes.forEach(n => {
            n.style('font-size', _getHighlightedLabelFontSize(n, _NEIGHBOR_LABEL_SIZE, z));
            n.style('text-max-width', _getHighlightedTextMaxWidth(n, _DEFAULT_TEXT_MAX_WIDTH, z));
            n.style('text-margin-x', 0);
        });
    }
}

function _clearHoveredNodeStyle() {
    if (_hoveredNodeClearTimer) { clearTimeout(_hoveredNodeClearTimer); _hoveredNodeClearTimer = null; }
    if (!_hoveredNode || !_hoveredNode.length) return;
    const node = _hoveredNode;
    node.removeClass('node-hovered');
    node.removeStyle('font-size');
    node.removeStyle('text-max-width');
    node.removeStyle('text-margin-x');
    node.removeStyle('text-margin-y');
    node.removeStyle('text-background-padding');
    node.removeStyle('text-border-width');
    if (_hlPinned) node.addClass('faded');
    _hoveredNode = null;
}

function _applySelectedLabelStyle(node) {
    _clearSelectedLabelStyle();
    const neighbors = node.outgoers('node').union(node.incomers('node'));
    _selectedLabelNode = node;
    _neighborLabelNodes = neighbors;
    _labelStyledNodes = node.union(neighbors);
    node.addClass('selected-label');
    neighbors.addClass('neighbor-label');
    _updateSelectedLabelZoom();
}

function _clearSelectedLabelStyle() {
    if (!_labelStyledNodes) return;
    _labelStyledNodes.removeClass('selected-label neighbor-label');
    _labelStyledNodes.removeStyle('font-size');
    _labelStyledNodes.removeStyle('text-max-width');
    _labelStyledNodes.removeStyle('text-margin-x');
    _labelStyledNodes = null;
    _selectedLabelNode = null;
    _neighborLabelNodes = null;
}

function clearHighlight() {
    if (_hlPinned) return;
    cy.elements().removeClass('faded hl hl-edge-out hl-edge-in hl-node-out hl-node-in');
    _applyGraphIsolateState();
}

function _resetGraphHighlightPreservingPin() {
    if (!cy) return;
    if (_hlPinned && _hlPinnedNode && _hlPinnedNode.length) {
        highlightNode(_hlPinnedNode);
        _applySelectedLabelStyle(_hlPinnedNode);
        _applyGraphIsolateState();
        return;
    }
    cy.elements().removeClass('faded hl hl-edge-out hl-edge-in hl-node-out hl-node-in');
    _applyGraphIsolateState();
}

// ── Smart Label Visibility ────────────────────────────────────────────────────
// Runs spatial label placement synchronously with the camera, like Sigma.js's
// labelGridCellSize approach: one label per grid cell, highest-degree wins.
let _labelRaf = null;

function _graphUpdateIsolateBtnState() {
    if (!_graphIsolateBtn) return;
    const active = !!_graphIsolateMode;
    _graphIsolateBtn.classList.toggle('isolate-active', active);
    _graphIsolateBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    _graphIsolateBtn.setAttribute('data-tip', active ? 'Show all nodes' : 'Hide unrelated nodes');
    _graphIsolateBtn.title = active ? 'Show all nodes' : 'Hide unrelated nodes';
}

function _graphShowIsolateBtn() {
    if (_graphIsolateBtn?.isConnected) {
        _graphUpdateIsolateBtnState();
        return;
    }
    const container = document.getElementById('graph-zoom-controls');
    if (!container) return;
    const btn = document.createElement('button');
    btn.id = 'graph-isolate-btn';
    btn.className = 'graph-zoom-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle isolate mode');
    btn.innerHTML = '&#128065;';
    btn.addEventListener('click', () => {
        _graphIsolateMode = !_graphIsolateMode;
        _graphUpdateIsolateBtnState();
        _applyGraphIsolateState();
    });
    container.prepend(btn);
    _graphIsolateBtn = btn;
    _graphUpdateIsolateBtnState();
}

function _graphHideIsolateBtn() {
    _graphIsolateMode = false;
    if (cy) cy.elements().removeClass('isolate-hidden');
    if (_graphIsolateBtn?.parentNode) _graphIsolateBtn.parentNode.removeChild(_graphIsolateBtn);
    _graphIsolateBtn = null;
}

function _graphSyncIsolateBtn(shouldShow) {
    if (shouldShow && _hlPinned && _hlPinnedNode && _hlPinnedNode.length) {
        _graphShowIsolateBtn();
        _applyGraphIsolateState();
        return;
    }
    _graphHideIsolateBtn();
}

function _graphPinnedVisibleElements(node) {
    if (!cy || !node || !node.length) return cy ? cy.collection() : null;

    let visibleNodes = node.closedNeighborhood().nodes();
    let parents = visibleNodes.parents();
    while (parents && parents.length) {
        visibleNodes = visibleNodes.union(parents);
        parents = parents.parents();
    }

    return visibleNodes.union(node.connectedEdges());
}

function _applyGraphIsolateState() {
    if (!cy) return;
    cy.batch(() => {
        cy.elements().removeClass('isolate-hidden');
        if (!_graphIsolateMode || !_hlPinned || !_hlPinnedNode || !_hlPinnedNode.length) return;
        const visible = _graphPinnedVisibleElements(_hlPinnedNode);
        cy.elements().not(visible).addClass('isolate-hidden');
    });
    _startLabelTracking();
}

function _spatialPlacementNow() {
    if (!cy) return;
    const z = cy.zoom();

    if (z >= 0.85) {
        cy.batch(() => cy.nodes().removeClass('label-hidden'));
        return;
    }

    // Effective screen font size; simple nodes clamp at min-zoomed-font-size: 6
    const effFs = Math.max(11 * z, 6);
    const PAD = 4;

    const items = [];
    cy.nodes().forEach(n => {
        if (n.hasClass('isolate-hidden')) return;
        const alwaysShow =
            n.data('lvl') === 0 ||
            n.isParent() ||
            !n.data('simple') ||
            n.hasClass('selected-label') ||
            n.hasClass('neighbor-label') ||
            n.hasClass('node-hovered');

        const pos = n.renderedPosition();
        const firstLine = (n.data('label') || '').split('\n')[0];
        const estW = Math.max(firstLine.length * effFs * 0.62, effFs * 4);
        const nodeR = Math.max((n.width() || 14) * z / 2, 4);
        const labelH = effFs * 1.4;

        items.push({
            node: n,
            degree: n.degree(false),
            alwaysShow,
            bb: { x1: pos.x - estW / 2, y1: pos.y - nodeR,
                  x2: pos.x + estW / 2, y2: pos.y + nodeR + labelH + 6 },
        });
    });

    items.sort((a, b) =>
        a.alwaysShow !== b.alwaysShow ? (a.alwaysShow ? -1 : 1) : b.degree - a.degree);

    const placed = [];
    function overlaps(bb) {
        for (const p of placed) {
            if (bb.x1 - PAD < p.x2 && bb.x2 + PAD > p.x1 &&
                bb.y1 - PAD < p.y2 && bb.y2 + PAD > p.y1) return true;
        }
        return false;
    }

    cy.batch(() => {
        for (const it of items) {
            if (it.alwaysShow || !overlaps(it.bb)) {
                it.node.removeClass('label-hidden');
                placed.push(it.bb);
            } else {
                it.node.addClass('label-hidden');
            }
        }
    });
}

// Start a rAF loop that waits for the camera to settle, then runs placement once.
// During movement: do nothing (textureOnViewport handles smooth bitmap pan/zoom).
// After 3 stable frames: run _spatialPlacementNow() once and stop.
function _startLabelTracking() {
    if (_labelRaf) return; // already running
    let prevZ = null, prevPanX = null, prevPanY = null, stableFrames = 0;

    const tick = () => {
        if (!cy) { _labelRaf = null; return; }
        const z = cy.zoom();
        const pan = cy.pan();
        const moved = z !== prevZ || pan.x !== prevPanX || pan.y !== prevPanY;
        prevZ = z; prevPanX = pan.x; prevPanY = pan.y;

        if (moved) {
            stableFrames = 0;
        } else if (++stableFrames >= 3) {
            _spatialPlacementNow();   // camera settled — update labels once
            _labelRaf = null;
            return;
        }
        _labelRaf = requestAnimationFrame(tick);
    };
    _labelRaf = requestAnimationFrame(tick);
}

const CY_STYLE = [
    {
        selector: 'node', style: {
            'background-color': 'data(bg)',
            'border-width': 2, 'border-color': 'data(bc)',
            'label': 'data(label)',
            'color': '#e2e8f0', 'font-size': 11,
            'text-valign': 'center', 'text-halign': 'center',
            'text-justification': 'center',
            'text-wrap': 'wrap', 'text-max-width': 160,
            'min-zoomed-font-size': 0,
            'width': 'data(w)', 'height': 'data(h)',
            'shape': 'data(sh)',
            'overlay-opacity': 0,
        }
    },
    { selector: 'node[lvl=0]', style: { 'font-size': 12, 'font-weight': 'bold' } },
    { selector: 'node[lvl=1]', style: { 'font-size': 10 } },
    { selector: 'node.label-hidden', style: { 'text-opacity': 0 } },
    // Simple (solid circle) mode — label below, no border
    { selector: 'node[simple=1]', style: {
        'border-width': 0,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-justification': 'center',
        'text-margin-y': 6,
        'text-max-width': 80,
        'min-zoomed-font-size': 6,
    }},
    { selector: 'node[simple=1]:selected', style: { 'border-width': 2.5, 'border-color': '#dfa745' } },
    { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#dfa745', 'overlay-opacity': 0 } },
    { selector: 'node:active', style: { 'overlay-opacity': 0 } },
    { selector: '.isolate-hidden', style: { 'display': 'none' } },
    // Zoom-invariant selected label badge
    { selector: 'node.selected-label', style: {
        'color': '#ffffff',
        'font-weight': 'bold',
        'text-halign': 'center',
        'text-justification': 'center',
        'min-zoomed-font-size': 0,
        'z-index': 999,
    }},
    // Zoom-invariant neighbor label badge (connected nodes)
    { selector: 'node.neighbor-label', style: {
        'color': '#e2e8f0',
        'text-halign': 'center',
        'text-justification': 'center',
        'min-zoomed-font-size': 0,
        'z-index': 998,
    }},
    // Hover badge for non-highlighted nodes when a selection is pinned
    // Label stays at bottom (default valign), just gains a framed box around it
    { selector: 'node.node-hovered', style: {
        'text-background-color': '#091525',
        'text-background-opacity': 0.92,
        'text-background-padding': '4px',
        'text-background-shape': 'roundrectangle',
        'text-border-color': 'data(bc)',
        'text-border-width': 1,
        'text-border-opacity': 1,
        'color': '#ffffff',
        'font-weight': 'bold',
        'min-zoomed-font-size': 0,
        'z-index': 997,
    }},
    // BIOS file type — highlighted border tint
    { selector: 'node[ft="module_inf"]', style: { 'border-width': 2.5 } },
    { selector: 'node[ft="package_dec"]', style: { 'border-width': 2.5 } },
    { selector: 'node[ft="ami_cif"]', style: { 'border-width': 2.5 } },
    { selector: 'node[ft="ami_sdl"]', style: { 'border-width': 2.5 } },
    // Default edge
    {
        selector: 'edge', style: {
            'width': 'data(w)',
            'line-color': 'data(ec)',
            'line-style': 'data(es)',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': 'data(ec)',
            'curve-style': 'bezier',
            'opacity': 0.75,
            'label': 'data(edgeLabel)',
            'font-size': 9,
            'text-rotation': 'autorotate',
            'text-margin-y': -6,
            'color': '#e5e7eb',
            'text-background-color': '#111827',
            'text-background-opacity': 0.82,
            'text-background-shape': 'round-rectangle',
            'text-background-padding': '2px',
            'text-events': 'no',
            'transition-property': 'opacity',
            'transition-duration': '150ms',
            'transition-timing-function': 'ease-in-out',
        }
    },
    // Edge selected state — glowing highlight replaces default grey overlay
    {
        selector: 'edge:selected', style: {
            'overlay-opacity': 0,
            'width': 3.5,
            'opacity': 1,
            'line-color': '#f0b060',
            'target-arrow-color': '#f0b060',
            'source-arrow-color': '#f0b060',
            'shadow-blur': 12,
            'shadow-color': '#f0b060',
            'shadow-opacity': 0.7,
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            'z-index': 20,
        }
    },
    // Edge hover state — thicker width on mouseover (opacity:1 lifts faded edges)
    {
        selector: '.edge-hovered', style: {
            'width': 3.0,
            'opacity': 1,
            'z-index': 5,
            'transition-property': 'width',
            'transition-duration': '80ms',
            'transition-timing-function': 'ease-out',
        }
    },
    { selector: 'edge:active', style: { 'overlay-opacity': 0 } },
    { selector: '.faded', style: { 'opacity': 0.06 } },
    // Other / binary file nodes — visibly distinct: dimmed + dashed border
    {
        selector: 'node[?isExtra]', style: {
            'opacity': 0.50,
            'border-style': 'dashed',
            'border-width': 1.5,
        }
    },
    { selector: '.hl', style: { 'opacity': 1, 'border-width': 2, 'border-color': 'data(bc)', 'outline-color': 'data(bc)', 'outline-width': 1, 'outline-opacity': 1, 'outline-offset': 4 } },
    {
        selector: '.hl-edge-out', style: {
            'opacity': 1, 'width': 3, 'z-index': 10,
        }
    },
    {
        selector: '.hl-edge-in', style: {
            'opacity': 1, 'width': 3, 'z-index': 10,
        }
    },
    { selector: '.hl-node-out', style: { 'border-width': 3, 'opacity': 1 } },
    { selector: '.hl-node-in', style: { 'border-width': 3, 'opacity': 1 } },
    // Highlighted edge hovered — must come after .hl-edge-out/in to win by array order
    {
        selector: 'edge.hl-edge-out.edge-hovered, edge.hl-edge-in.edge-hovered', style: {
            'width': 5.5,
            'z-index': 20,
        }
    },
    // Drill-down group compound container
    {
        selector: 'node[_t="drill_group"]', style: {
            'background-color': '#0b1929',
            'background-opacity': 0.82,
            'border-width': 1.5,
            'border-color': 'data(bc)',
            'border-style': 'dashed',
            'label': 'data(label)',
            'text-valign': 'top',
            'text-halign': 'center',
            'text-margin-y': 4,
            'color': 'data(bc)',
            'font-size': 10,
            'font-weight': 'bold',
            'padding': '18px',
            'shape': 'roundrectangle',
            'compound-sizing-wrt-labels': 'include',
            'min-width': 60,
            'min-height': 40,
            'cursor': 'pointer',
        }
    },
];


function loadLevel0() {
    if (state.galaxyActive && typeof closeGalaxy === 'function') closeGalaxy();
    showLoading(true, T('renderingModules'));
    clearSelection();
    hideFuncView();
    if (window._sv && window._sv.active && window.svHideSvView) window.svHideSvView();
    if (window.svHideStructureBtn) svHideStructureBtn();
    // No file context at L0 — disable and close code panel
    setCodeBtnEnabled(false);
    if (codeState.isOpen) { closeCodePanel(); codeState.userClosed = false; }
    state.level = 0; state.activeModule = null; state.activeFile = null; state.activeSubDir = null;
    buildFtFilter(null, null);
    buildEdgeFilter();
    buildNodeLegend();
    updateBreadcrumb(); setSidebarActive(null);
    setL1ToolbarVisible(false);
    if (window.updateFilterTabEnabled) updateFilterTabEnabled();
    // Reset L1 nav history when returning to module overview
    depMapState.navHistory = [];
    depMapState.navHistoryIdx = -1;
    updateL1NavButtons();

    const els = [];
    const hasRootModule = (DATA.modules || []).some(m => m.id === '_root');
    const rootOther = (DATA.other_files_by_module || {})['_root'] || [];
    const rootFiles = (DATA.files_by_module || {})['_root'] || [];
    if (!hasRootModule && (rootOther.length || rootFiles.length)) {
        const rootPath = (DATA.stats?.root || '').replace(/\\/g, '/').replace(/\/$/, '');
        const rootName = rootPath.split('/').filter(Boolean).pop() || '_root';
        const rootFuncCount = rootFiles.reduce((s, f) => s + (f.func_count || 0), 0);
        const rootColor = '#94a3b8';
        const totalCount = rootFiles.length + rootOther.length;
        const ttExtra = rootOther.length ? `\n${T('otherBinary', { count: rootOther.length })}` : '';
        const rootMod = {
            id: '_root',
            label: rootName,
            color: rootColor,
            file_count: rootFiles.length,
            func_count: rootFuncCount,
            other_count: rootOther.length,
        };
        const isSimpleL0 = _shapeMode === 'simple';
        els.push({
            data: {
                id: rootMod.id,
                label: `${rootName}\n${totalCount} files`,
                bg: isSimpleL0 ? rootColor : rootColor + '18', bc: rootColor, lvl: 0,
                w: isSimpleL0 ? SIMPLE_NODE_SIZE_LG : 190, h: isSimpleL0 ? SIMPLE_NODE_SIZE_LG : 68,
                sh: isSimpleL0 ? 'ellipse' : 'roundrectangle',
                simple: isSimpleL0 ? 1 : 0,
                tt: `${rootName}\nAnalysed: ${rootFiles.length} | Funcs: ${rootFuncCount}${ttExtra}`,
                _t: 'module', _m: rootMod,
            }
        });
    }
    const isSimpleL0 = _shapeMode === 'simple';
    DATA.modules.forEach(m => {
        const otherCount = m.other_count || 0;
        const totalLabel = `${m.id}\n${m.file_count} files`;
        const ttExtra = otherCount ? `\n${T('otherBinary', { count: otherCount })}` : '';
        els.push({
            data: {
                id: m.id, label: totalLabel,
                bg: isSimpleL0 ? m.color : m.color + '18', bc: m.color, lvl: 0,
                w: isSimpleL0 ? SIMPLE_NODE_SIZE_LG : 190, h: isSimpleL0 ? SIMPLE_NODE_SIZE_LG : 68,
                sh: isSimpleL0 ? 'ellipse' : 'roundrectangle',
                simple: isSimpleL0 ? 1 : 0,
                tt: `${m.id}\nAnalysed: ${m.file_count} | Funcs: ${m.func_count}${ttExtra}`,
                _t: 'module', _m: m,
            }
        });
    });
    const edges = [...DATA.module_edges].sort((a, b) => b.weight - a.weight).slice(0, 300);
    edges.forEach((e, i) => {
        els.push({
            data: {
                id: `me${i}`, source: e.s, target: e.t,
                w: Math.max(1, Math.min(6, e.weight / 8)), wt: e.weight,
                ec: '#2a3a55', es: 'solid', el: '',
            }
        });
    });

    cy.elements().remove();
    cy.add(els);
    applyCyFont(getSavedFont());

    const l0LayoutId = _PREFS.get('layoutL0');
    const l0Preset = LAYOUT_PRESETS.find(p => p.id === l0LayoutId);
    _syncLayoutIndicator(l0LayoutId);
    refreshLayoutSwitcher();
    // If the saved preset needs an unloaded CDN extension, fall back to cose
    const l0Config = (l0Preset && (!l0Preset.requires || _isLayoutAvailable(l0Preset.requires)))
        ? { ...l0Preset.config(), animate: false }
        : { name: 'cose', animate: false, randomize: true, nodeRepulsion: 10000, idealEdgeLength: 200, nodeOverlap: 20, padding: 60 };
    if (!l0Preset || (l0Preset.requires && !_isLayoutAvailable(l0Preset.requires))) {
        _syncLayoutIndicator('cose'); // fallback indicator
    }
    const lay = cy.layout(l0Config);
    lay.one('layoutstop', () => showLoading(false));
    lay.run();
}

// ─── L1: Module → show ALL files flat (no folder nodes ever) ─────────────────
function drillToModule(modId, opts) {
    // opts: { focusFile?: string, closeExt?: bool }
    if (window._sv && window._sv.active && window.svHideSvView) window.svHideSvView();
    if (window.svHideStructureBtn) svHideStructureBtn();
    setCodeBtnEnabled(false);

    if (state.level === 0) state.history.push({ level: 0 });
    state.level = 1; state.activeModule = modId; state.activeSubDir = null;
    showLoading(true, T('loadingModule', { module: modId }));
    clearSelection();
    hideFuncView(); setSidebarActive(modId);
    // Clear sub-dir active highlight
    document.querySelectorAll('.subdir-row').forEach(el => el.classList.remove('active'));

    // Reset external-files state for new module
    if (depMapState.currentModId !== modId) {
        depMapState.expandedExtModules = new Set();
        depMapState.currentModId = modId;
    }
    if (opts?.closeExt) {
        depMapState.showExternalFiles = false;
    }
    if (opts?.focusFile) {
        depMapState.pendingFocusFile = opts.focusFile;
    }
    setL1ToolbarVisible(true);
    if (window.updateFilterTabEnabled) updateFilterTabEnabled();
    updateDepMapExtToggle();
    const allFiles = DATA.files_by_module[modId] || [];
    const allOther = (DATA.other_files_by_module || {})[modId] || [];
    if (modId === '_root' && allOther.length && allFiles.length === 0) {
        ftActiveFilter.add('other');
        if (allOther.some(f => f.file_type === 'binary')) ftActiveFilter.add('binary');
    }

    // If a focusFile is given, zoom into its parent subfolder instead of showing all files
    if (opts?.focusFile) {
        const focusPath = opts.focusFile;                // e.g. "AmiCompatibilityPkg/Include/Setup.h"
        const modPrefix = modId + '/';
        const relPath = focusPath.startsWith(modPrefix) ? focusPath.slice(modPrefix.length) : focusPath;
        const parts = relPath.split('/');
        if (parts.length >= 2) {
            // File is in a subfolder — show that subfolder
            const subPath = parts.slice(0, -1).join('/');  // e.g. "Include"
            const prefix = modId + '/' + subPath + '/';
            const filtered = allFiles.filter(f =>
                f.path.startsWith(prefix) || f.path === modId + '/' + subPath
            );

            pushL1History(modId, subPath);
            updateL1Toolbar(`${modId} / ${subPath}`, filtered.length);

            state.activeSubDir = subPath;
            setSubdirActive(modId, subPath);

            // Expand the sidebar tree so the active subdir row is visible
            const modRow = document.getElementById(`mi-${modId}`);
            if (modRow) {
                const children = modRow.nextElementSibling;
                if (children && !children.classList.contains('open')) {
                    children.classList.add('open');
                    modRow.querySelector('.tree-arrow')?.classList.add('open');
                }
            }

            renderFilesFlat(modId, filtered, subPath);
            updateBreadcrumb();
            buildFtFilter(modId, subPath);
                    return;
        }
    }

    pushL1History(modId, null);
    updateL1Toolbar(modId, allFiles.length);
    renderFilesFlat(modId, allFiles);
    buildFtFilter(modId, null);
}

// Render flat file nodes in graph — the only graph view for L1
function renderFilesFlat(modId, files, subPath) {
    // Apply File Type Filter (for fully-analysed files)
    const visible = files.filter(f => ftActiveFilter.has(f.file_type || 'other'));

    // Optionally add other/binary files
    const showOther = ftActiveFilter.has('other');
    const showBinary = ftActiveFilter.has('binary');
    let otherFiles = [];
    if (showOther || showBinary) {
        const allOther = (DATA.other_files_by_module || {})[modId] || [];
        // Filter by subpath if we're in a sub-directory view
        const pathFiltered = subPath
            ? allOther.filter(f => f.path.startsWith(modId + '/' + subPath + '/') || f.path === modId + '/' + subPath)
            : allOther;
        otherFiles = pathFiltered.filter(f =>
            (f.file_type === 'other' && showOther) ||
            (f.file_type === 'binary' && showBinary)
        );
    }

    const capped = visible.slice(0, 250);
    const cappedOther = otherFiles.slice(0, Math.max(0, 400 - capped.length));

    const visIds = new Set(capped.map(f => `f${f.id}`));
    const allEdges = DATA.file_edges_by_module[modId] || [];
    const edges = allEdges
        .filter(e => visIds.has(`f${e.s}`) && visIds.has(`f${e.t}`)).slice(0, 600);

    const els = [];
    capped.forEach(f => {
        els.push({ data: fileNodeData(f) });
    });
    cappedOther.forEach(f => {
        els.push({ data: otherFileNodeData(f) });
    });
    edges.forEach((e, i) => {
        const es = edgeTypeStyle(e.type);
        const isInferred = e.type === 'inferred';
        const edgeData = {
            id: `fe${i}`,
            source: `f${e.s}`, target: `f${e.t}`,
            w: EDGE_WIDTH.fileInternal,
            ec: es.color,
            es: isInferred ? 'dashed' : EDGE_STYLE_INTERNAL,
            el: es.label,
            edgeLabel: depMapState.showEdgeTypeLabels ? es.label : '',
            etype: e.type || 'include',
        };
        if (isInferred) {
            const conf = typeof e.confidence === 'number' ? e.confidence.toFixed(2) : '?';
            const reason = e.reason || '';
            edgeData.tt = `Inferred (AI)\nconfidence: ${conf}` + (reason ? `\nreason: ${reason}` : '');
        }
        els.push({ data: edgeData });
    });

    // ─── External modules (if toggle is ON) ──────────────────────────────────
    const moduleColorMap = {};
    (DATA.modules || []).forEach(m => { moduleColorMap[m.id] = m.color; });

    if (depMapState.showExternalFiles) {
        const extEdges = allEdges.filter(e => visIds.has(`f${e.s}`) && !visIds.has(`f${e.t}`));

        // Group target files by their module
        // extModMap: extModId → Map<fileId, { file, edgeType, sources:Set<srcFileId> }>
        const extModMap = new Map();
        extEdges.forEach(e => {
            const targetMod = _fileIdToModule[e.t] || '_external';
            if (!extModMap.has(targetMod)) extModMap.set(targetMod, new Map());
            const modFiles = extModMap.get(targetMod);
            if (!modFiles.has(e.t)) {
                modFiles.set(e.t, {
                    file: _fileIdToFile[e.t] || null,
                    edgeType: e.type || 'include',
                    sources: new Set(),
                });
            }
            modFiles.get(e.t).sources.add(e.s);
        });

        depMapState.currentExtModules = Array.from(extModMap.keys());

        let extEdgeSeq = 0;
        for (const [extModId, fileMap] of extModMap.entries()) {
            const modSlug = _safeId(extModId) + '-' + _hashId(extModId);
            const groupId = `depext-${modSlug}`;
            const fileCount = fileMap.size;
            const isExpanded = depMapState.expandedExtModules.has(extModId);
            const modColor = moduleColorMap[extModId] || '#64748b';
            const isSimpleExt = _shapeMode === 'simple';

            if (!isExpanded) {
                // ── Collapsed: one group node per external module ─────────────
                els.push({
                    data: {
                        id: groupId,
                        label: `${extModId}\n${fileCount} file${fileCount !== 1 ? 's' : ''}`,
                        bg: isSimpleExt ? modColor : '#111827', bc: modColor,
                        w: isSimpleExt ? SIMPLE_NODE_SIZE_MD : 170, h: isSimpleExt ? SIMPLE_NODE_SIZE_MD : 52,
                        sh: isSimpleExt ? 'ellipse' : 'roundrectangle', lvl: 1,
                        simple: isSimpleExt ? 1 : 0,
                        _t: 'dep_ext_group', mod: extModId,
                        tt: `External Module: ${extModId}\nReferenced files: ${fileCount}\nClick to expand`,
                    }
                });
                // Aggregate edges from each internal source to the group node
                const sourceAgg = new Map();
                fileMap.forEach(info => {
                    info.sources.forEach(srcId => {
                        if (!sourceAgg.has(srcId)) sourceAgg.set(srcId, { count: 0, types: new Map() });
                        const agg = sourceAgg.get(srcId);
                        agg.count++;
                        agg.types.set(info.edgeType, (agg.types.get(info.edgeType) || 0) + 1);
                    });
                });
                for (const [srcId, agg] of sourceAgg.entries()) {
                    const dominantType = [...agg.types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'include';
                    const edgeStyle = edgeTypeStyle(dominantType);
                    els.push({
                        data: {
                            id: `depexte-${modSlug}-${srcId}`,
                            source: `f${srcId}`, target: groupId,
                            w: Math.min(2.4, EDGE_WIDTH.fileExternal + agg.count * 0.25),
                            ec: edgeStyle.color, es: EDGE_STYLE_EXTERNAL, el: edgeStyle.label,
                            edgeLabel: depMapState.showEdgeTypeLabels ? edgeStyle.label : '',
                            tt: `→ ${extModId} (${agg.count} ref${agg.count !== 1 ? 's' : ''})`,
                        }
                    });
                    extEdgeSeq++;
                }
            } else {
                // ── Expanded: individual file nodes for this external module ──
                fileMap.forEach((info, fileId) => {
                    const f = info.file;
                    if (!f) return;
                    const fnId = `depextf-${modSlug}-${fileId}`;
                    const ft = f.file_type || 'other';
                    const shape = FILE_TYPE_SHAPE[ft] || FILE_TYPE_SHAPE['other'];
                    const eff = isSimpleExt ? { sh: 'ellipse', w: SIMPLE_NODE_SIZE_SM, h: SIMPLE_NODE_SIZE_SM } : shape;
                    const fileColor = extColor(f.ext || '');   // 依副檔名決定顏色，與內部節點一致

                    // Extract parent folder for display below filename
                    const pathParts = f.path.split('/');
                    const folderName = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : '';
                    const nodeLabel = folderName ? `${f.label}\n(${folderName})` : f.label;
                    // Adjust node height slightly to accommodate the second line
                    const nodeH = isSimpleExt ? SIMPLE_NODE_SIZE_SM : (folderName ? Math.max(shape.h, 54) : shape.h);

                    els.push({
                        data: {
                            id: fnId, label: nodeLabel,
                            bg: isSimpleExt ? fileColor : '#0a1520', bc: fileColor,
                            w: eff.w, h: nodeH, sh: eff.sh, lvl: 1,
                            simple: isSimpleExt ? 1 : 0,
                            _t: 'dep_ext_file', _f: f, mod: extModId,
                            tt: `${f.path}\nModule: ${extModId}\nType: ${ft}\n(External file)`,
                        }
                    });
                    const es = edgeTypeStyle(info.edgeType);
                    info.sources.forEach(srcId => {
                        els.push({
                            data: {
                                id: `depextfe-${modSlug}-${srcId}-${fileId}`,
                                source: `f${srcId}`, target: fnId,
                                w: EDGE_WIDTH.fileExternal, ec: es.color, es: EDGE_STYLE_EXTERNAL, el: es.label,
                                edgeLabel: depMapState.showEdgeTypeLabels ? es.label : '',
                                tt: `→ ${f.label} (${info.edgeType})`,
                            }
                        });
                        extEdgeSeq++;
                    });
                });
            }
        }

        // Show/hide Expand All / Collapse All buttons based on whether ext nodes exist
        const hasExt = extModMap.size > 0;
        const expandBtn = document.getElementById('l1-expand-all-ext');
        const collapseBtn = document.getElementById('l1-collapse-all-ext');
        if (expandBtn) expandBtn.style.display = hasExt ? '' : 'none';
        if (collapseBtn) collapseBtn.style.display = hasExt ? '' : 'none';

        // Update stats to reflect external count
        const statsEl = document.getElementById('l1-stats');
        if (statsEl) {
            const parts = [`${capped.length} files`];
            if (hasExt) parts.push(`${extModMap.size} ext module${extModMap.size !== 1 ? 's' : ''}`);
            statsEl.textContent = parts.join(' | ');
        }
    } else {
        // External off — hide expand/collapse buttons
        const expandBtn = document.getElementById('l1-expand-all-ext');
        const collapseBtn = document.getElementById('l1-collapse-all-ext');
        if (expandBtn) expandBtn.style.display = 'none';
        if (collapseBtn) collapseBtn.style.display = 'none';
        depMapState.currentExtModules = [];

        // Update stats (files only)
        const statsEl = document.getElementById('l1-stats');
        if (statsEl) statsEl.textContent = `${capped.length} files`;
    }

    // Invalidate any in-flight expand animations from previous render
    depMapState._animGen++;

    // ── Yield to browser so the loading spinner can paint before heavy work ──
    const _l1Token = ++_renderToken;
    setTimeout(() => {
        if (_renderToken !== _l1Token) return; // cancelled

        // Stop any running animations to avoid corrupting cytoscape state
        cy.elements().stop(true, false);   // jumpToEnd=false so we don't flash final positions

        // Snapshot existing node IDs so expand animation knows which are truly new
        const prevNodeIds = new Set(cy.nodes().map(n => n.id()));
        depMapState._prevNodeIds = prevNodeIds;

                cy.elements().remove();
        cy.add(els);
        applyCyFont(getSavedFont());

        // ── Show/hide empty-state overlay ─────────────────────────────────
        const nodeCount = cy.nodes().length;
        let emptyOverlay = document.getElementById('l1-empty-overlay');
        if (nodeCount === 0) {
            if (!emptyOverlay) {
                emptyOverlay = document.createElement('div');
                emptyOverlay.id = 'l1-empty-overlay';
                emptyOverlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:999;background:var(--canvas-bg)';
                emptyOverlay.innerHTML = `<div style="text-align:center;color:var(--muted);padding:80px 20px;max-width:500px">
                    <div style="font-size:56px;margin-bottom:20px;opacity:0.6">📂</div>
                    <div style="font-size:16px;font-weight:500;margin-bottom:12px;color:var(--text)">${T('noVisibleFiles') || 'No visible files'}</div>
                    <div style="font-size:13px;line-height:1.7;opacity:0.8">
                        ${T('noVisibleFilesHint') || 'Try adjusting the File Type filter in the sidebar, or check if this folder contains any source files.'}
                    </div>
                </div>`;
                document.getElementById('cy')?.appendChild(emptyOverlay);
            } else {
                emptyOverlay.style.display = 'flex';
            }
            showLoading(false);
            updateBreadcrumb();
            buildEdgeFilter();
            buildNodeLegend();
            updateSidebarStats();
            return;
        } else if (emptyOverlay) {
            emptyOverlay.style.display = 'none';
        }

        // ── Two-pass layout ──────────────────────────────────────────────────────
        // Pass 1: dagre on ONLY the analysed nodes (no extra nodes yet positioned)
        // Pass 2: grid-wrap the extra nodes below the analysed bounding box

        const mainEls = cy.elements().filter(el => !el.data('isExtra'));
        const extraEls = cy.nodes().filter(n => n.data('isExtra'));

        if (extraEls.length === 0) {
            // Simple path: no extras, just run the user's preferred layout
            const l1LayoutId = _PREFS.get('layoutL1');
            const l1Preset = LAYOUT_PRESETS.find(p => p.id === l1LayoutId);
            const canUse = l1Preset && (!l1Preset.requires || _isLayoutAvailable(l1Preset.requires));
            const effectiveId = canUse ? l1LayoutId : 'dagre-lr';
            const l1Config = canUse
                ? { ...l1Preset.config(), animate: false }
                : { name: 'dagre', rankDir: 'LR', animate: false, nodeSep: 30, rankSep: 90, padding: 40 };
            _syncLayoutIndicator(effectiveId);
            refreshLayoutSwitcher();
            const lay = cy.layout(l1Config);
            lay.one('layoutstop', () => {
                if (_renderToken !== _l1Token) return;
                updateBreadcrumb();
                showLoading(false);
                _postLayoutL1();
            });
            lay.run();
            return;
        }

        // Hide extra nodes while main layout runs so they don't affect positions
        extraEls.style('display', 'none');

        // Use user's preferred layout for the main nodes (extras get grid-placed below)
        const l1LayoutId2 = _PREFS.get('layoutL1');
        const l1Preset2 = LAYOUT_PRESETS.find(p => p.id === l1LayoutId2);
        const canUse2 = l1Preset2 && (!l1Preset2.requires || _isLayoutAvailable(l1Preset2.requires));
        const l1Config2 = canUse2
            ? { ...l1Preset2.config(), animate: false }
            : { name: 'dagre', rankDir: 'LR', animate: false, nodeSep: 30, rankSep: 90, padding: 40 };
        _syncLayoutIndicator(canUse2 ? l1LayoutId2 : 'dagre-lr');

        const layMain = cy.layout(l1Config2);

        layMain.one('layoutstop', () => {
            if (_renderToken !== _l1Token) return;

            // Restore extra nodes
            extraEls.style('display', 'element');

            // Compute bounding box of main graph
            const bb = mainEls.length ? mainEls.boundingBox() : { x1: 40, y1: 40, x2: 400, y2: 200 };
            const graphWidth = Math.max(bb.x2 - bb.x1, 600);

            // Grid parameters
            const NODE_W = 155;   // matches FILE_TYPE_SHAPE 'other'/'binary' width
            const NODE_H = 42;
            const H_GAP = 14;
            const V_GAP = 10;
            const COLS = Math.max(1, Math.floor(graphWidth / (NODE_W + H_GAP)));

            const startX = bb.x1;
            const startY = bb.y2 + 60;   // 60px below main graph

            extraEls.forEach((n, idx) => {
                const col = idx % COLS;
                const row = Math.floor(idx / COLS);
                n.position({
                    x: startX + col * (NODE_W + H_GAP) + NODE_W / 2,
                    y: startY + row * (NODE_H + V_GAP) + NODE_H / 2,
                });
            });

            updateBreadcrumb();
            showLoading(false);
            _postLayoutL1();
        });

        layMain.run();
    }, 0);
}

// ── Post-layout handler: handles expand animation OR focus fly-in ──────────────
function _postLayoutL1() {
    // Refresh legend with only the edge types / node shapes visible in this view
    applyEdgeFilter();
    buildEdgeFilter();
    buildNodeLegend();
    updateSidebarStats();

    const savedVP = depMapState.preserveViewport;
    const originPos = depMapState.expandOriginPos;
    const focusPath = depMapState.pendingFocusFile;
    const prevIds = depMapState._prevNodeIds || new Set();

    // Clear all state immediately to prevent re-entrancy issues
    depMapState.preserveViewport = null;
    depMapState.expandOriginPos = null;
    depMapState.pendingFocusFile = null;
    depMapState._prevNodeIds = null;

    // ── Case 1: Expand animation (group node was just expanded) ──────────────
    if (savedVP && originPos) {
        // Restore viewport so camera stays put
        cy.viewport({ zoom: savedVP.zoom, pan: savedVP.pan });

        // Only animate nodes that are genuinely new (weren't in graph before)
        const newNodes = cy.nodes('[_t="dep_ext_file"]').filter(n => !prevIds.has(n.id()));

        if (newNodes.length > 0) {
            // Record final dagre positions, then teleport to origin
            const finalPos = new Map();
            newNodes.forEach(n => finalPos.set(n.id(), { ...n.position() }));
            newNodes.forEach(n => n.position({ x: originPos.x, y: originPos.y }));

            const myGen = depMapState._animGen;   // capture generation at animation start

            // Stagger the fly-out
            let idx = 0;
            newNodes.forEach(n => {
                const fp = finalPos.get(n.id());
                const nid = n.id();
                const delay = idx * 18;
                setTimeout(() => {
                    // Bail if a newer render has happened
                    if (depMapState._animGen !== myGen) return;
                    if (!cy.hasElementWithId(nid)) return;
                    cy.$id(nid).animate({ position: fp }, { duration: 360, easing: 'ease-out-cubic' });
                }, delay);
                idx++;
            });
        } else {
            cy.fit(cy.elements(), 40);
        }
        return;
    }

    // ── Case 1.5: Exact viewport restore (e.g. returning from L2 call graph) ──
    if (savedVP && !originPos && !focusPath) {
        cy.viewport({ zoom: savedVP.zoom, pan: savedVP.pan });
        return;
    }

    // ── Case 2: Focus fly-in (Open Location was used) ─────────────────────────
    if (focusPath) {
        const target = cy.nodes().filter(n => {
            const f = n.data('_f');
            return f && (f.path === focusPath);
        }).first();

        if (!target || !target.length) { cy.fit(cy.elements(), 40); return; }

        const myGen = depMapState._animGen;
        cy.fit(cy.elements(), 40);
        setTimeout(() => {
            if (depMapState._animGen !== myGen) return;
            if (!cy.hasElementWithId(target.id())) return;
            highlightNode(target);
            cy.animate({
                center: { eles: target },
                zoom: Math.max(cy.zoom(), 1.8),
            }, {
                duration: 700,
                easing: 'ease-in-out-cubic',
                complete: () => {
                    if (depMapState._animGen !== myGen) return;
                    if (!cy.hasElementWithId(target.id())) return;
                    let count = 0;
                    const originalBc = target.data('bc');
                    const flashInterval = setInterval(() => {
                        count++;
                        if (!cy.hasElementWithId(target.id())) { clearInterval(flashInterval); return; }
                        target.style('border-color', count % 2 === 1 ? _tC('#ffffff', '#8c7851') : originalBc);
                        target.style('border-width', count % 2 === 1 ? 4 : 2);
                        if (count >= 6) {
                            clearInterval(flashInterval);
                            target.style('border-color', originalBc);
                            target.style('border-width', 2);
                        }
                    }, 200);
                }
            });
        }, 80);
        return;
    }

    // ── Case 3: Normal navigation — fit to all elements ──────────────────────
    cy.fit(cy.elements(), 40);
}

// ─── Call Graph Button helpers ────────────────────────────────────────────────
// Enable or disable the Code panel toggle button.
// Call with true when a file is loaded into the panel; false when leaving file context.
function setCodeBtnEnabled(enabled) {
    const btn = document.getElementById('code-toggle-btn');
    if (!btn) return;
    btn.disabled = !enabled;
    if (!enabled) btn.classList.remove('active');
}

/**
 * Show or hide the Call Graph button.
 * filePath = null  → hide (no file selected, or leaving L2)
 * filePath = path  → show only if the file has at least one function
 * Called from: onNodeTap (file single-click), drillToFile, hideFuncView
 */
function updateCallGraphBtn(filePath) {
    const btn = document.getElementById('graph-toggle-btn');
    if (!btn) return;
    const isL2 = state.level >= 2;
    const hasFuncs = filePath && ((DATA.funcs_by_file?.[filePath]?.length || 0) > 0);
    const available = isL2 || hasFuncs;

    if (available) {
        btn.disabled = false;
        btn.title = T('graphBtnCallGraphTip');
    } else {
        btn.disabled = true;
        btn.title = T('graphBtnCallGraphTip') + ' (Not available for this file)';
    }

    // Always label as "Call Graph"
    btn.innerHTML = `⬡ ${T('graphBtnCallGraph')}`;

    // Active only when in L2 AND Structure view is not showing (mutual exclusion)
    const structActive = !!(window._sv && window._sv.active);
    btn.classList.toggle('active', isL2 && !structActive);
}

/**
 * Return to L1 from the Call Graph view, restoring the exact viewport and
 * selected node that were active before drillToFile() was called.
 * Does NOT call drillToModule (no full re-render of L1 if cy still has L1 nodes).
 */
function restoreL1FromCallGraph() {
    const snap = l2State._l1Snapshot;
    const prevHistory = [...state.history];   // preserve nav history

    // hideFuncView clears L2 DOM and cy classes, but does NOT reload L1 nodes.
    // We then need to re-render L1 (cy was replaced during L2).
    hideFuncView();
    if (window._sv && window._sv.active && window.svHideSvView) window.svHideSvView();
    if (window.svHideStructureBtn) svHideStructureBtn();
    state.level = 1;
    state.activeFile = null;

    // Restore history so breadcrumb/back-btn stay correct
    state.history = prevHistory.filter(h => h.level < 2);

    setL1ToolbarVisible(true);
    if (window.updateFilterTabEnabled) updateFilterTabEnabled();
    const ftWrap = document.getElementById('ft-filter');
    if (ftWrap) ftWrap.style.display = '';

    // Re-render L1 with viewport preserved
    if (snap && snap.sigma) {
        depMapState.preserveViewport = snap; // Sigma path: contains { sigma:true, camera:{...} }
        depMapState.expandOriginPos = null;
    } else if (snap) {
        depMapState.preserveViewport = { pan: snap.pan, zoom: snap.zoom };
        depMapState.expandOriginPos = null;
    }

    // drillToModule re-renders the L1 graph; _postLayoutL1 will restore viewport
    if (state.activeModule) {
        const savedH = [...state.history];
        drillToModule(state.activeModule);
        state.history = savedH;
    } else {
        loadLevel0();
    }

    // Re-select the node that was selected before entering L2
    if (snap?.selectedNodeId) {
        setTimeout(() => {
            cy?.elements().unselect();
            cy?.$id(snap.selectedNodeId).select();
        }, 50);
    }
    // Button state is already reset by hideFuncView/svHideStructureBtn/drillToModule above.
    // Do NOT re-enable here — the user has not re-selected any file.

    l2State._l1Snapshot = null;
    updateBreadcrumb();
}

// ─── L2: Function View ────────────────────────────────────────────────────────
function drillToFile(fileRel) {
    // Save L1 viewport + selected node so we can restore exactly when toggling back
    if (state.level < 2 && cy) {
        const sel = cy.nodes(':selected').first();
        l2State._l1Snapshot = {
            pan: { ...cy.pan() },
            zoom: cy.zoom(),
            selectedNodeId: sel && sel.length ? sel.id() : null,
        };
    }

    state.history.push({ level: 1, activeModule: state.activeModule });
    state.level = 2; state.activeFile = fileRel;
    clearSelection();
    updateBreadcrumb();
    setL1ToolbarVisible(false);
    if (window.updateFilterTabEnabled) updateFilterTabEnabled();
    const ftWrap = document.getElementById('ft-filter');
    if (ftWrap) ftWrap.style.display = 'none';

    // showFuncView handles code panel sync — do NOT call loadFileInPanel separately
    openL2File(fileRel, { newSession: true, pushHistory: true });
    updateCallGraphBtn(fileRel);
}

// Dedicated code-panel sync — called only from showFuncView to avoid race conditions
async function _syncCodePanel(fileRel, funcName, targetCallText = null, importSearch = null) {
    if (!fileRel) return;

    const fname = fileRel.split('/').pop();
    const ext = fname.includes('.') ? '.' + fname.split('.').pop().toLowerCase() : '';

    // Respect the user's explicit close — don't force panel open
    if (codeState.userClosed && !codeState.isOpen) {
        // Update internal state silently so panel shows correct content when user reopens
        codeState.currentFile = fileRel;
        codeState.currentFunc = funcName;
        // Still enable buttons so user can interact (Code to open, Structure if applicable)
        setCodeBtnEnabled(true);
        if (state.level >= 2 && window.svUpdateStructureBtn) svUpdateStructureBtn(fileRel, ext);
        return;
    }
    openCodePanel();

    document.getElementById('cp-filename').textContent = fname;
    document.getElementById('cp-filename').title = fileRel;
    document.getElementById('cp-ext-badge').textContent = ext.toUpperCase() || 'FILE';
    document.getElementById('cp-ext-badge').style.background = extColor(ext);
    document.getElementById('cp-ext-badge').style.color = '#000';
    hideFuncBar();

    if (!codeState.jobId) {
        showCpError('No job ID — code preview only available via the local server (launch.bat).');
        return;
    }

    if (fileRel === codeState.currentFile) {
        // File already rendered — just jump to target
        if (funcName) requestAnimationFrame(() => jumpToFunc(funcName, targetCallText));
        else if (importSearch) requestAnimationFrame(() => jumpToImport(importSearch));
        if (state.level >= 2 && window.svUpdateStructureBtn) svUpdateStructureBtn(fileRel, ext);
        return;
    }

    // New file — fetch and render
    showCpLoading(true);
    try {
        const url = `/file?job=${encodeURIComponent(codeState.jobId)}&path=${encodeURIComponent(fileRel)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) { showCpError(T('fileLoadError', { error: data.error })); return; }
        codeState.currentFile = fileRel;
        renderFileContent(data, ext, fname);
        showCpLoading(false);
        if (funcName) requestAnimationFrame(() => jumpToFunc(funcName, targetCallText));
        else if (importSearch) requestAnimationFrame(() => jumpToImport(importSearch));
        // Only update Structure button if still at L2 — user may have navigated away during fetch
        if (state.level >= 2 && window.svUpdateStructureBtn) svUpdateStructureBtn(fileRel, ext);
    } catch (e) {
        showCpError(T('fetchError', { error: e.message }));
    }
}

function showFuncView(fileRel, funcs, edges, centerIdx) {
    hideTooltip(); // ensure tooltip is cleared when entering func view
    const center = funcs[centerIdx];
    const callers = dedupeBy(edges.filter(e => e.t === centerIdx).map(e => funcs[e.s]).filter(Boolean), 'label').slice(0, 8);
    const callees = dedupeBy(edges.filter(e => e.s === centerIdx).map(e => funcs[e.t]).filter(Boolean), 'label').slice(0, 8);

    cy.elements().remove();
    document.getElementById('cy').style.display = 'none';

    const fv = document.getElementById('func-view');
    fv.classList.add('active');

    const accessCls = center.is_public ? 'access-public' : 'access-private';
    const accessLbl = center.is_public ? '🔓 PUBLIC' : '🔒 PRIVATE';

    const fileName = fileRel.split('/').pop();   // just the filename, e.g. "Dhcp4Driver.c"

    // Store fileRel on the container to avoid inline-JS quoting issues
    fv.dataset.fileRel = fileRel;

    let pillHtml = '';
    funcs.slice(0, 24).forEach((f, i) => {
        const baseCls = f.is_efiapi ? 'pill-yellow' : f.is_public ? 'pill-blue' : 'pill-gray';
        const activeCls = i === centerIdx ? ' pill-active' : '';
        pillHtml += `<span class="pill ${baseCls}${activeCls}" id="pill-${i}" data-func-idx="${i}">${f.label}</span>`;
    });

    fv.innerHTML = `
    <div class="fv-col">
      <div class="fv-col-label">◀ Callers</div>
      ${callers.map(f => fnCard(f, funcs.indexOf(f))).join('') || '<div class="fv-empty">No callers</div>'}
    </div>
    <div class="fv-center">
      <div class="fv-center-header">${fileName}</div>
      <div class="access-strip ${accessCls}">${accessLbl}</div>
      <div class="fv-center-pills">${pillHtml}</div>
    </div>
    <div class="fv-col">
      <div class="fv-col-label">Callees ▶</div>
      ${callees.map(f => fnCard(f, funcs.indexOf(f))).join('') || '<div class="fv-empty">No callees</div>'}
    </div>`;

    // Re-attach dataset after innerHTML wipe
    fv.dataset.fileRel = fileRel;

    // Sync code: load file and jump to selected function
    _syncCodePanel(fileRel, center.label);
}

function fnCard(f, idx) {
    const cls = f.is_efiapi ? 'pill-yellow' : f.is_public ? 'pill-blue' : 'pill-gray';
    const lbl = f.is_efiapi ? 'EFIAPI' : f.is_public ? 'public' : 'static';
    // Use data-func-idx; fileRel is read from fv.dataset.fileRel in the click handler
    return `<div class="fv-node" data-func-idx="${idx}">
    <div class="fn-name">${f.label}</div>
    <span class="fn-badge ${cls}">${lbl}</span>
  </div>`;
}

function focusFunc(fileRel, idx) {
    const funcs = DATA.funcs_by_file[fileRel] || [];
    const edges = DATA.func_edges_by_file[fileRel] || [];
    if (funcs[idx]) {
        showFuncView(fileRel, funcs, edges, idx);
        // _syncCodePanel is called inside showFuncView
    }
}

// Event delegation for fv-node and pill clicks (avoids inline-JS quoting issues)
document.addEventListener('click', e => {
    const fv = document.getElementById('func-view');
    if (!fv) return;
    const fileRel = fv.dataset.fileRel;
    if (!fileRel) return;

    const target = e.target.closest('[data-func-idx]');
    if (target && fv.contains(target)) {
        const idx = parseInt(target.dataset.funcIdx, 10);
        focusFunc(fileRel, idx);
    }
});

function showFuncViewEmpty(fileRel) {
    cy.elements().remove();
    document.getElementById('cy').style.display = 'none';
    const fv = document.getElementById('func-view');
    fv.classList.add('active');
    fv.innerHTML = `<div style="text-align:center;color:var(--muted);padding:60px">
    <div style="font-size:48px;margin-bottom:16px">📄</div>
    <div style="font-size:14px">${fileRel.split('/').pop()}</div>
    <div style="font-size:12px;margin-top:8px">No functions found</div>
  </div>`;
}

function hideFuncView() {
    clearSelection();
    clearFuncOverlay();
    setL2ToolbarVisible(false);
    clearL2Legend();
    document.getElementById('cy')?.classList.remove('l2-view');
    // Also close sym-view if open
    if (window.symViewClose) {
        const sv = document.getElementById('sym-view');
        if (sv && sv.classList.contains('active')) symViewClose();
    }
    l2State.activeFile = null;
    l2State.activeFuncIdx = 0;
    l2State.expandedModules = new Set();
    l2State.externalModules = [];
    l2State._expandInitialized = false;
    // Hide call-graph button when leaving L2 (updateCallGraphBtn will re-show if needed)
    updateCallGraphBtn(null);
    updateL2NavButtons();
    updateExternalToggle();
}

// ─── Node Tap ─────────────────────────────────────────────────────────────────
function onNodeTap(node) {
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
    addSeg(T('sidebarModules'), () => { state.history = []; loadLevel0(); }, state.level === 0, 'Modules');

    if (state.level >= 1 && state.activeModule) {
        const isModActive = state.level === 1 && !state.activeSubDir;
        addSeg(state.activeModule,
            isModActive ? null : () => {
                if (state.level >= 2) {
                    const h = [...state.history]; drillToModule(state.activeModule); state.history = h;
                } else {
                    drillToModule(state.activeModule);
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

    // Update Back button visibility (now managed via disabled attribute)
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
        if (state.history.length > 0) {
            backBtn.disabled = false;
        } else {
            backBtn.disabled = true;
        }
    }

    // Call-graph button: update text + active state; visibility controlled by updateCallGraphBtn()
    const graphBtn = document.getElementById('graph-toggle-btn');
    if (graphBtn) {
        const isL2 = state.level >= 2;
        const structActive = !!(window._sv && window._sv.active);
        graphBtn.innerHTML = `⬡ ${T('graphBtnCallGraph')}`;
        graphBtn.title = T('graphBtnCallGraphTip');
        graphBtn.classList.toggle('active', isL2 && !structActive);
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
