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
        const targetName = String(focusFuncName);
        const idx = funcs.findIndex(f => String(f.label || '') === targetName || String((f as any).name || '') === targetName);
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
        'Firmware SDK': { color: '#e879f9', bg: '#1e0820' },
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

        // Reset element collection — json({elements:[]}) releases internal batch buffers
        // more cleanly than .elements().remove(), which leaves dirty lists around.
        // batch() suppresses per-element style/reflow during the bulk rebuild.
        cy.batch(() => { cy.json({ elements: [] }); cy.add(els); });
        applyCyFont(getSavedFont());
        applyExternalEdgeVisibility();

        const l2LayoutId = _PREFS.get('layoutL2');
        const l2Preset = LAYOUT_PRESETS.find(p => p.id === l2LayoutId);
        const canUseL2 = l2Preset && (!l2Preset.requires || _isLayoutAvailable(l2Preset.requires));
        const l2Config = canUseL2
            ? { ...l2Preset.config(), animate: false }
            : { name: 'dagre', rankDir: 'LR', animate: false, nodeSep: 26, rankSep: 80, padding: 50 };
        _syncLayoutIndicator(canUseL2 ? l2LayoutId : 'dagre-lr');
        refreshLayoutSwitcher();  // update visible layout buttons for level 2
        // Cache key: L2 view of this file with current toggle state (ext-funcs/edges affect node set)
        const _l2Key = `L2:${fileRel}|xf=${l2State.showExternalFuncs?1:0}|xe=${l2State.showExternalEdges?1:0}|exp=${Array.from(l2State.expandedModules||[]).sort().join(',')}`;
        applyLayoutWithCache(_l2Key, l2Config, (hit) => {
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

            if (typeof applyPendingGlobalNavRestore === 'function' && applyPendingGlobalNavRestore('l2')) {
                l2State.preserveViewport = null;
                l2State.expandOriginPos = null;
                l2State._prevNodeIds = null;
                renderL2Legend();
                return;
            }

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
                    highlightNode(targetNode);
                    cy.stop();
                    cy.zoom(Math.max(cy.zoom(), 1.8));
                    cy.center(targetNode);
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
    }, 0);
}

// Drill the currently active file (code panel or selected node) to L2 caller/callee
function drillCurrentFileToL2() {
    // Priority: use code panel's current file if open
    const filePath = codeState.currentFile
        || (cy?.nodes(':selected').first().data('_f')?.path)
        || null;

    if (!filePath) {
        // Flash L2 segment to signal "select a file first"
        const seg = document.getElementById('level-switcher')?.querySelectorAll('.lsw-seg')[2];
        if (seg) {
            seg.style.color = '#f87171';
            setTimeout(() => { seg.style.color = ''; }, 900);
        }
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
    if (window._lswUpdate) window._lswUpdate({ active: 2, l1Available: true });
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

    const newEls: any[] = [groupNode];

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



// ─── L2: Function View ────────────────────────────────────────────────────────
function drillToFile(fileRel) {
    if (typeof pushGlobalNavSnapshot === 'function' && !isGlobalNavRestoring()) {
        pushGlobalNavSnapshot('drill-file');
    }
    // Save L1 viewport + selected node so we can restore exactly when toggling back
    if (state.level < 2 && cy) {
        const sel = cy.nodes(':selected').first();
        l2State._l1Snapshot = {
            pan: { ...cy.pan() },
            zoom: cy.zoom(),
            selectedNodeId: sel && sel.length ? sel.id() : null,
        };
    }

    if (!isGlobalNavRestoring()) state.history.push({ level: 1, activeModule: state.activeModule });
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

    if (fileRel === codeState.renderedFile) {
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
        codeState.renderedFile = fileRel;
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
    const accessTone = center.is_public ? 'PUBLIC' : 'PRIVATE';

    const fileName = fileRel.split('/').pop();   // just the filename, e.g. "Dhcp4Driver.c"

    // Store fileRel on the container to avoid inline-JS quoting issues
    fv.dataset.fileRel = fileRel;

    let pillHtml = '';
    funcs.slice(0, 24).forEach((f, i) => {
        const baseCls = f.is_public ? 'pill-public' : 'pill-private';
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
      <div class="access-strip ${accessCls}">${accessTone}</div>
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
    const cls = f.is_public ? 'pill-public' : 'pill-private';
    const lbl = f.is_public ? 'PUBLIC' : 'PRIVATE';
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

    const target = (e.target as HTMLElement).closest('[data-func-idx]');
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

