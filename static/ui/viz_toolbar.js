// @module viz_toolbar — L1 & L2 toolbar, navigation history, toggles, node modal
// Owns: initL1Toolbar, initL2Toolbar, initTooltipActions, showNodeModal,
//       hideNodeModal, goL1/L2Prev/Next, pushL1History, toggleDepMapExtGroup,
//       rerenderCurrentL1, toggleExternalGroup, toggleSysGroup, etc.

// ─── L1 Toolbar (Dependency Map) ─────────────────────────────────────────────
function initL1Toolbar() {
    const prevBtn = document.getElementById('l1-prev');
    const nextBtn = document.getElementById('l1-next');
    const toggleBtn = document.getElementById('l1-toggle-ext');
    const expandBtn = document.getElementById('l1-expand-all-ext');
    const collapseBtn = document.getElementById('l1-collapse-all-ext');

    if (prevBtn) prevBtn.addEventListener('click', goL1Prev);
    if (nextBtn) nextBtn.addEventListener('click', goL1Next);

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            depMapState.showExternalFiles = !depMapState.showExternalFiles;
            updateDepMapExtToggle();
            rerenderCurrentL1();
        });
    }
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            depMapState.expandedExtModules = new Set(depMapState.currentExtModules);
            rerenderCurrentL1();
        });
    }
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            depMapState.expandedExtModules = new Set();
            rerenderCurrentL1();
        });
    }

    updateDepMapExtToggle();
    updateL1NavButtons();
    window.addEventListener('mouseup', onL1MouseNav);
}

function setL1ToolbarVisible(v) {
    const bar = document.getElementById('l1-toolbar');
    if (!bar) return;
    bar.classList.toggle('hidden', !v);
}

function updateDepMapExtToggle() {
    const btn = document.getElementById('l1-toggle-ext');
    if (!btn) return;
    btn.textContent = depMapState.showExternalFiles ? T('extFilesOn') : T('extFilesOff');
    btn.classList.toggle('active', depMapState.showExternalFiles);
}

function updateL1Toolbar(modId, fileCount) {
    const labelEl = document.getElementById('l1-mod-label');
    if (labelEl) { labelEl.textContent = modId || T('noModule'); labelEl.title = modId || ''; }
    const statsEl = document.getElementById('l1-stats');
    if (statsEl) { statsEl.dataset.count = String(fileCount || 0); statsEl.textContent = T('countFiles', { count: fileCount || 0 }); }
}

function pushL1History(modId, subDir) {
    if (depMapState._navigating) return;
    const entry = { modId, subDir: subDir || null };
    // Truncate forward history when navigating fresh
    depMapState.navHistory = depMapState.navHistory.slice(0, depMapState.navHistoryIdx + 1);
    // Avoid duplicate consecutive entries
    const last = depMapState.navHistory[depMapState.navHistoryIdx];
    if (last && last.modId === entry.modId && last.subDir === entry.subDir) return;
    depMapState.navHistory.push(entry);
    // Cap at _HISTORY_CAP to prevent unbounded growth on long sessions
    while (depMapState.navHistory.length > 50) depMapState.navHistory.shift();
    depMapState.navHistoryIdx = depMapState.navHistory.length - 1;
    updateL1NavButtons();
}

function updateL1NavButtons() {
    const prevBtn = document.getElementById('l1-prev');
    const nextBtn = document.getElementById('l1-next');
    if (prevBtn) prevBtn.disabled = depMapState.navHistoryIdx <= 0;
    if (nextBtn) nextBtn.disabled = depMapState.navHistoryIdx >= depMapState.navHistory.length - 1;
}

function goL1Prev() {
    if (depMapState.navHistoryIdx <= 0) return;
    depMapState.navHistoryIdx--;
    _jumpL1History();
}

function goL1Next() {
    if (depMapState.navHistoryIdx >= depMapState.navHistory.length - 1) return;
    depMapState.navHistoryIdx++;
    _jumpL1History();
}

function _jumpL1History() {
    const entry = depMapState.navHistory[depMapState.navHistoryIdx];
    if (!entry) return;
    depMapState._navigating = true;
    if (entry.subDir) {
        // Navigate to module first (no push), then filter to subdir
        if (state.activeModule !== entry.modId) {
            drillToModule(entry.modId);
        }
        filterGraphToSubPath(entry.modId, entry.subDir);
    } else {
        drillToModule(entry.modId);
    }
    depMapState._navigating = false;
    updateL1NavButtons();
}

function onL1MouseNav(e) {
    if (state.level !== 1) return;
    if (e.button === 3) {
        e.preventDefault();
        goL1Prev();
    } else if (e.button === 4) {
        e.preventDefault();
        goL1Next();
    }
}

function toggleDepMapExtGroup(extModId) {
    // Save the clicked group node's graph position + current viewport for expand animation
    const modSlug = _safeId(extModId) + '-' + _hashId(extModId);
    {
        const groupNode = cy.$id(`depext-${modSlug}`);
        if (groupNode && groupNode.length) {
            depMapState.expandOriginPos = { ...groupNode.position() };
        } else {
            depMapState.expandOriginPos = null;
        }
        depMapState.preserveViewport = { pan: { ...cy.pan() }, zoom: cy.zoom() };
    }

    if (depMapState.expandedExtModules.has(extModId)) {
        depMapState.expandedExtModules.delete(extModId);
        depMapState.expandOriginPos = null; // collapsing — no spawn animation
    } else {
        depMapState.expandedExtModules.add(extModId);
    }
    rerenderCurrentL1();
}

function rerenderCurrentL1() {
    if (state.level !== 1 || !state.activeModule) return;
    const allFiles = DATA.files_by_module[state.activeModule] || [];
    const filtered = state.activeSubDir
        ? allFiles.filter(f => f.path.startsWith(state.activeModule + '/' + state.activeSubDir + '/'))
        : allFiles;
    renderFilesFlat(state.activeModule, filtered, state.activeSubDir || undefined);
}

function initL2Toolbar() {
    const prevBtn = document.getElementById('l2-prev');
    const nextBtn = document.getElementById('l2-next');
    const toggleExtLinesBtn = document.getElementById('l2-toggle-ext-lines');
    const toggleExtFuncsBtn = document.getElementById('l2-toggle-ext-funcs');
    const expandBtn = document.getElementById('l2-expand-all');
    const collapseBtn = document.getElementById('l2-collapse-all');

    if (prevBtn) prevBtn.addEventListener('click', goL2Prev);
    if (nextBtn) nextBtn.addEventListener('click', goL2Next);
    if (toggleExtLinesBtn) {
        toggleExtLinesBtn.addEventListener('click', () => {
            l2State.showExternalEdges = !l2State.showExternalEdges;
            updateExternalToggle();
            applyExternalEdgeVisibility();
        });
    }
    if (toggleExtFuncsBtn) {
        toggleExtFuncsBtn.addEventListener('click', () => {
            l2State.showExternalFuncs = !l2State.showExternalFuncs;
            if (l2State.showExternalFuncs) {
                l2State.showExternalEdges = true;
            }
            updateExternalFuncsToggle();
            renderL2Flowchart(l2State.activeFile);
        });
    }

    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            if (!l2State.activeFile) return;
            l2State.preserveViewport = cy ? { pan: { ...cy.pan() }, zoom: cy.zoom() } : null;
            l2State.expandOriginPos = null;
            l2State.expandedModules = new Set(l2State.externalModules || []);
            if (!l2State.expandedSysCategories) l2State.expandedSysCategories = new Set();
            (l2State.sysCategories || []).forEach(c => l2State.expandedSysCategories.add(c));
            renderL2Flowchart(l2State.activeFile);
        });
    }

    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            if (!l2State.activeFile) return;
            l2State.preserveViewport = cy ? { pan: { ...cy.pan() }, zoom: cy.zoom() } : null;
            l2State.expandOriginPos = null;
            l2State.expandedModules = new Set();
            if (l2State.expandedSysCategories) l2State.expandedSysCategories.clear();
            renderL2Flowchart(l2State.activeFile);
        });
    }

    updateExternalToggle();
    updateL2NavButtons();
    window.addEventListener('mouseup', onL2MouseNav);
}

function initTooltipActions() {
    const tip = document.getElementById('tooltip');
    if (!tip) return;

    tip.addEventListener('mouseenter', () => {
        tooltipPinned = true;
        if (tooltipHideTimer) clearTimeout(tooltipHideTimer);
    });
    tip.addEventListener('mouseleave', () => {
        tooltipPinned = false;
        hideTooltip();
        clearHighlight();
    });
    tip.addEventListener('click', (e) => {
        if (window.getSelection()?.toString()) return; // avoid toggling when selecting text
        const btn = e.target.closest('[data-action]');
        if (!btn) {
            showNodeModal(window._currentHoverNode);
            return;
        }
        const action = btn.dataset.action;
        const file = decodeURIComponent(btn.dataset.file || '');
        const func = decodeURIComponent(btn.dataset.func || '');
        if (action === 'open') {
            const nodeType = btn.dataset.nodeType || '';
            const node = window._currentHoverNode;

            if (isAlreadyAtLocation(node)) {
                showToast(T('alreadyAtLocation'));
                return;
            }

            if (nodeType === 'dep_ext_file' || nodeType === 'dep_ext_group') {
                const extMod = decodeURIComponent(btn.dataset.mod || '');
                const extFile = decodeURIComponent(btn.dataset.file || '');
                hideTooltip();
                if (extMod) drillToModule(extMod, { focusFile: extFile || null, closeExt: true });
            } else {
                openL2File(file, { pushHistory: true, focusFunc: func || null });
                hideNodeModal();
            }
        } else if (action === 'view') {
            if (codeState?.isOpen || !file) {
                showSelectFileFirstToast();
                return;
            }
            _syncCodePanel(file, func || null);
            hideNodeModal();
        }
    });
}

function showNodeModal(node) {
    if (!node) return;

    let backdrop = document.getElementById('node-modal-backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'node-modal-backdrop';
        backdrop.innerHTML = `
            <div id="node-modal">
                <button id="node-modal-close">&times;</button>
                <div id="node-modal-content"></div>
            </div>
        `;
        document.body.appendChild(backdrop);

        document.getElementById('node-modal-close').addEventListener('click', hideNodeModal);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) hideNodeModal();
        });

        // Delegate tip-btn clicks inside modal
        document.getElementById('node-modal-content').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            let file = decodeURIComponent(btn.dataset.file || '');
            const func = decodeURIComponent(btn.dataset.func || '');

            if (action === 'view-ambiguous' && (codeState?.isOpen || !document.querySelector('input[name="ambiguous-file-select"]:checked'))) {
                showSelectFileFirstToast();
                return;
            }

            if (action === 'open-ambiguous' || action === 'view-ambiguous') {
                const selected = document.querySelector('input[name="ambiguous-file-select"]:checked');
                if (!selected) {
                    showSelectFileFirstToast();
                    return;
                }
                file = selected.value;
                if (action === 'open-ambiguous') {
                    openL2File(file, { pushHistory: true, focusFunc: func || null });
                    hideNodeModal();
                } else {
                    _syncCodePanel(file, func || null);
                    hideNodeModal();
                }
                return;
            }

            if (action === 'open') {
                const nodeType = btn.dataset.nodeType || '';
                // Check guardrail
                if (isAlreadyAtLocation(window._currentHoverNode)) {
                    showToast(T('alreadyAtLocation'));
                    return;
                }

                // dep_ext_file / dep_ext_group → navigate to that module's Dependency Map (L1)
                if (nodeType === 'dep_ext_file' || nodeType === 'dep_ext_group') {
                    const extMod = decodeURIComponent(btn.dataset.mod || '');
                    const extFile = decodeURIComponent(btn.dataset.file || '');
                    hideNodeModal();
                    if (extMod) drillToModule(extMod, { focusFile: extFile || null, closeExt: true });
                } else {
                    openL2File(file, { pushHistory: true, focusFunc: func || null });
                    hideNodeModal();
                }
            } else if (action === 'view') {
                if (codeState?.isOpen || !file) {
                    showSelectFileFirstToast();
                    return;
                }
                _syncCodePanel(file, func || null);
                hideNodeModal();
            }
        });
    }

    const d = node.data();
    let html = '';

    // Subtitle inline formatting
    const lines = (d.tt || '').split('\n');
    let title = '';
    let subtitle = '';

    if (d._t === 'ext_func') {
        title = d.fn || '';
        subtitle = escapeHtml(d._f || T('tooltipUnknownTarget'));
    } else if (d._t === 'potential_func') {
        title = d.fn ? `Ambiguous: ${d.fn}` : lines[0] || '';
    } else {
        title = lines[0] || '';
        subtitle = lines.slice(1).map(escapeHtml).join('<br>').trim();
    }

    // Header
    html += `<div class="modal-header">`;
    html += `<div class="tip-title" style="line-height: 1.4; font-family: monospace; white-space: normal; word-break: break-all;" title="${escapeHtml(title)}">${escapeHtml(title)}</div>`;

    if (d._t === 'file') {
        // 結構化 file header：路徑 + key-value rows
        const pathLine = lines[1] && lines[1].startsWith('§') ? lines[1].slice(1, -1) : null;
        const metaLines = lines.slice(pathLine !== null ? 2 : 1).filter(l => l.trim());
        if (pathLine) {
            html += `<div class="tip-path">${escapeHtml(pathLine)}</div>`;
        }
        if (metaLines.length) {
            html += `<div class="tip-body">`;
            for (const line of metaLines) {
                const colon = line.indexOf(':');
                if (colon > 0) {
                    const key = escapeHtml(line.slice(0, colon).trim());
                    const val = escapeHtml(line.slice(colon + 1).trim());
                    html += `<div class="tip-row"><span class="tip-row-key">${key}</span><span class="tip-row-val">${val}</span></div>`;
                } else {
                    html += `<div class="tip-row">${escapeHtml(line)}</div>`;
                }
            }
            html += `</div>`;
        }
    } else if (d._t === 'potential_func') {
        html += `<div class="tip-body" style="font-size: 12px; margin-top: 12px; font-family: monospace;">`;
        html += `<div style="margin-bottom: 8px; font-weight: bold; color: #a78bfa;">${escapeHtml(T('tooltipPossibleFiles'))}</div>`;
        html += `<div class="ambiguous-file-list" style="max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 4px; padding: 4px;">`;
        if (d._files && d._files.length) {
            d._files.forEach((f) => {
                html += `<label style="display: block; padding: 6px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); user-select: none;">
                    <input type="radio" name="ambiguous-file-select" value="${escapeHtml(f)}" style="margin-right: 8px;">
                    <span style="word-break: break-all;">${escapeHtml(f)}</span>
                </label>`;
            });
        }
        html += `</div></div>`;
    } else if (d._t === 'dep_ext_file' || d._t === 'dep_ext_group' || d._t === 'ext_func' || d._t === 'ext_group' || d._t === 'drilled_func' || d._t === 'drill_group') {
        const srcPath = state.level === 2 ? (l2State.activeFile || '') : (state.activeModule || '');
        const tgtPath = (typeof d._f === 'object' ? d._f?.path : d._f) || d.mod || '';
        const dist = _pathDist(srcPath, tgtPath);
        const distColor = _distColor(dist);
        const distLabel = dist === 0 ? (state.level === 2 ? T('distSame') : T('distSame')) : T('distAway', { count: dist });

        let displaySubtitle = subtitle;
        const typeStr = (d._t === 'ext_group' || d._t === 'dep_ext_group') ? T('externalModule') : T('externalFile');

        // Clean up redundant (EXTERNAL FILE) strings from subtitle across L1/L2
        displaySubtitle = displaySubtitle
            .replace(/\(External file\)/gi, '')
            .replace(/\(EXTERNAL FILE\)/gi, '')
            .replace(/\(EXTERNAL MODULE\)/gi, '')
            .replace(/<br><br>$/, '')
            .trim();

        html += `<div class="tip-body" style="font-size: 11px; margin-top: 8px; font-family: monospace; line-height: 1.6; color: ${_tC('rgba(255,255,255,0.85)', 'var(--text)')}">`;
        if (displaySubtitle) html += displaySubtitle + '<br>';
        html += `<span style="
            display: inline-block;
            margin-top: 6px;
            font-size: 11px;
            color: ${distColor};
            background: ${distColor}22;
            border: 1px solid ${distColor}66;
            border-radius: 4px;
            padding: 2px 8px;
            font-weight: 700;
            letter-spacing: 0.05em;
        ">⬡ ${typeStr} · ${distLabel}</span>`;
        html += `</div>`;
    } else if (subtitle) {
        html += `<div class="tip-body" style="font-size: 11px; margin-top: 8px; font-family: monospace; line-height: 1.4; color: ${_tC('rgba(255,255,255,0.85)', 'var(--text)')};">${subtitle}</div>`;
    }

    // Actions
    html += `<div class="tip-actions" style="margin-top: 16px;">`;
    if (d._t === 'potential_func') {
        html += `<button class="tip-btn" data-action="open-ambiguous" data-func="${encodeURIComponent(d.fn || '')}">${escapeHtml(T('tooltipOpenLocation'))}</button>` +
            `<button class="tip-btn" data-action="view-ambiguous" data-func="${encodeURIComponent(d.fn || '')}">${escapeHtml(T('tooltipViewFile'))}</button>`;
    } else {
        html += `<button class="tip-btn" data-action="open" data-file="${encodeURIComponent(d._f?.path || d._f || '')}" data-func="${encodeURIComponent(d.fn || '')}" data-node-type="${d._t || ''}" data-mod="${encodeURIComponent(d.mod || '')}">${escapeHtml(T('tooltipOpenLocation'))}</button>` +
            `<button class="tip-btn" data-action="view" data-file="${encodeURIComponent(d._f?.path || d._f || '')}" data-func="${encodeURIComponent(d.fn || '')}">${escapeHtml(T('tooltipViewFile'))}</button>`;
    }
    html += `</div>`;
    html += `</div>`;

    // Dependencies
    const outEdges = node.outgoers('edge');
    const inEdges = node.incomers('edge');

    if (outEdges.length > 0 || inEdges.length > 0) {
        html += `<div class="modal-deps">`;
        html += `<div style="font-weight:bold; margin: 20px 0 12px; padding-top:16px; border-top: 1px solid var(--border); font-size: 14px;">${T('dependencies')}:</div>`;

        const OUT_MAP = {
            'Inc': T('relInclude'), 'owns': T('relOwns'), 'Src': T('relSources'), 'Pkg': T('relPackage'), 'Lib': T('relLibrary'),
            'ELINK': T('relElink'), 'Comp': T('relComponent'), 'GUID': T('relGuidRef'),
            'Strings': T('relStrings'), 'ASL': T('relAslInclude'), 'Callback': T('relCallback'),
            'HII-Pkg': T('relHiiPkg'), 'Depex': T('relDepex'),
            'Import': T('relImports'),
            'ext': T('relExternalCalls'), 'group': T('relGroup'),
            '': state.level === 2 ? T('relCalls') : T('relIncludes')
        };
        const IN_MAP = {
            'Inc': T('relIncludedBy'), 'owns': T('relOwnedBy'), 'Src': T('relSourceOf'), 'Pkg': T('relPackagedIn'), 'Lib': T('relUsedAsLibBy'),
            'ELINK': T('relElinkParentOf'), 'Comp': T('relUsedAsCompBy'), 'GUID': T('relReferencedGuidBy'),
            'Strings': T('relReferencedAsStringBy'), 'ASL': T('relIncludedByAsl'), 'Callback': T('relTriggeredBy'),
            'HII-Pkg': T('relPackagedInHii'), 'Depex': T('relDependedBy'),
            'Import': T('relImportedBy'),
            'ext': T('relExternalCallers'), 'group': T('relGroup'),
            '': state.level === 2 ? T('relCalledBy') : T('relIncludedBy')
        };

        const outGroups = {};
        outEdges.forEach(edge => {
            const lbl = edge.data('el') || '';
            const col = edge.data('ec') || '#f59e0b';
            const outTxt = T(OUT_MAP[lbl]) || lbl || T('outgoing');
            const key = outTxt + '|' + col;
            if (!outGroups[key]) outGroups[key] = [];
            outGroups[key].push(edge.target());
        });

        const inGroups = {};
        inEdges.forEach(edge => {
            const lbl = edge.data('el') || '';
            const col = edge.data('ec') || '#10b981';
            const inTxt = T(IN_MAP[lbl]) || lbl || T('incoming');
            const key = inTxt + '|' + col;
            if (!inGroups[key]) inGroups[key] = [];
            inGroups[key].push(edge.source());
        });

        const renderList = (groups) => {
            for (const [key, nodes] of Object.entries(groups)) {
                const [lbl, col] = key.split('|');
                html += `<div style="margin-bottom: 12px;">`;
                html += `<div style="color:${col}; font-weight: 600; font-size: 13px; margin-bottom: 6px; font-family: monospace;">• ${lbl}: ${nodes.length}</div>`;
                html += `<div style="padding-left: 14px; display: flex; flex-direction: column; gap: 4px;">`;
                nodes.forEach(n => {
                    const nd = n.data();
                    let nTitle = nd.fn || nd.label || nd.id;
                    let nSub = nd._f?.path || nd._f || '';
                    if (nTitle.includes('\n')) nTitle = nTitle.split('\n')[0];
                    if (nd._t === 'file') {
                        nSub = nd._f?.ext ? nd._f.ext.toUpperCase() : T('file');
                    }

                    // ── Distance badge for external dep-map nodes ─────────────
                    let distBadge = '';
                    const isExtNode = nd._t === 'dep_ext_file' || nd._t === 'dep_ext_group';
                    if (isExtNode) {
                        const tgtPath = (typeof nd._f === 'object' ? nd._f?.path : nd._f) || nd.mod || '';
                        const dist = _pathDist(state.activeModule || '', tgtPath);
                        const distColor = _distColor(dist);
                        const distLabel = dist === 0 ? T('distSame') : `d=${dist}`;
                        distBadge = `<span style="
                            margin-left: auto;
                            font-size: 10px;
                            font-family: monospace;
                            color: ${distColor};
                            background: ${distColor}22;
                            border: 1px solid ${distColor}66;
                            border-radius: 4px;
                            padding: 1px 6px;
                            white-space: nowrap;
                            flex-shrink: 0;
                        ">${distLabel}</span>`;
                    }

                    html += `<div class="modal-dep-item" style="font-size: 12px; background: ${_tC('rgba(255,255,255,0.03)', 'rgba(2,8,38,0.04)')}; padding: 6px 10px; border-radius: 6px; cursor: pointer; display: flex; align-items: baseline; gap: 8px; transition: background 0.15s;" data-nav-node="${n.id()}">`;
                    html += `<span style="color: ${_tC('#e2e8f0', 'var(--text)')}; font-weight: 500; font-family: monospace;">${escapeHtml(nTitle)}</span>`;
                    if (nSub && nSub !== nTitle) {
                        html += `<span style="color: var(--muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace;">${escapeHtml(nSub)}</span>`;
                    }
                    if (distBadge) html += distBadge;
                    html += `</div>`;
                });
                html += `</div></div>`;
            }
        };

        renderList(outGroups);
        renderList(inGroups);
        html += `</div>`;
    }

    const modalTitle = document.getElementById('node-modal-title') || document.querySelector('.modal-header-title');
    if (modalTitle) modalTitle.textContent = T('details');

    const content = document.getElementById('node-modal-content');
    content.innerHTML = html;
    hideTooltip();

    // Bind click events to graph nav rows
    content.querySelectorAll('.modal-dep-item').forEach(el => {
        el.addEventListener('mouseover', () => el.style.background = _tC('rgba(255,255,255,0.08)', 'rgba(2,8,38,0.08)'));
        el.addEventListener('mouseout', () => el.style.background = _tC('rgba(255,255,255,0.03)', 'rgba(2,8,38,0.04)'));
        el.addEventListener('click', () => {
            const targetId = el.dataset.navNode;
            const targetNode = cy.getElementById(targetId);
            if (targetNode && targetNode.length) {
                hideNodeModal();
                const d = targetNode.data();
                if (d._t === 'module') drillToModule(d._m.id);
                else {
                    highlightNode(targetNode);
                    setTimeout(() => {
                        cy.animate({
                            center: { eles: targetNode },
                            zoom: Math.max(cy.zoom(), 1.0)
                        }, {
                            duration: 500,
                            easing: 'ease-in-out-cubic'
                        });
                    }, 0);
                }
            }
        });
    });

    requestAnimationFrame(() => {
        backdrop.classList.add('show');
    });
}

function hideNodeModal() {
    const backdrop = document.getElementById('node-modal-backdrop');
    if (backdrop) backdrop.classList.remove('show');
}

function onL2MouseNav(e) {
    if (state.level !== 2) return;
    if (e.button === 3) {
        e.preventDefault();
        goL2Prev();
    } else if (e.button === 4) {
        e.preventDefault();
        goL2Next();
    }
}

function updateExternalToggle() {
    // External lines always follow external funcs — no separate toggle
    l2State.showExternalEdges = l2State.showExternalFuncs;
    applyExternalEdgeVisibility();
}

function updateExternalFuncsToggle() {
    const btn = document.getElementById('l2-toggle-ext-funcs');
    if (!btn) return;
    btn.textContent = l2State.showExternalFuncs ? T('extFuncsOn') : T('extFuncsOff');
    btn.classList.toggle('active', l2State.showExternalFuncs);
    setL2ToolbarVisible(state.level === 2);
}

function applyExternalEdgeVisibility() {
    if (!cy) return;
    const edges = cy.edges('[el="ext"]');
    edges.style('display', l2State.showExternalEdges ? 'element' : 'none');
}

function updateL2NavButtons() {
    const prevBtn = document.getElementById('l2-prev');
    const nextBtn = document.getElementById('l2-next');
    const canPrev = l2State.fileHistoryIdx > 0;
    const canNext = l2State.fileHistoryIdx >= 0 && l2State.fileHistoryIdx < l2State.fileHistory.length - 1;
    if (prevBtn) prevBtn.disabled = !canPrev;
    if (nextBtn) nextBtn.disabled = !canNext;
}

function _saveL2Snapshot() {
    if (!cy) return;
    const idx = l2State.fileHistoryIdx;
    if (idx < 0) return;
    if (!l2State.fileHistorySnapshots) l2State.fileHistorySnapshots = [];
    l2State.fileHistorySnapshots[idx] = {
        pan: { ...cy.pan() },
        zoom: cy.zoom(),
        expandedModules: new Set(l2State.expandedModules),
        expandedSysCategories: new Set(l2State.expandedSysCategories || []),
        activeFuncIdx: l2State.activeFuncIdx || 0,
    };
}

function _applyL2Snapshot(idx) {
    const snap = l2State.fileHistorySnapshots && l2State.fileHistorySnapshots[idx];
    if (!snap) return;
    l2State.expandedModules = new Set(snap.expandedModules);
    l2State.expandedSysCategories = new Set(snap.expandedSysCategories);
    l2State.activeFuncIdx = snap.activeFuncIdx;
    // Schedule viewport restore after layout (preserveViewport, no originPos → exact restore)
    l2State.preserveViewport = { pan: snap.pan, zoom: snap.zoom };
    l2State.expandOriginPos = null;
}

function goL2Prev() {
    if (l2State.fileHistoryIdx <= 0) return;
    _saveL2Snapshot();
    l2State.fileHistoryIdx -= 1;
    const fileRel = l2State.fileHistory[l2State.fileHistoryIdx];
    if (!fileRel) return;
    _applyL2Snapshot(l2State.fileHistoryIdx);
    openL2File(fileRel, { pushHistory: false });
}

function goL2Next() {
    if (l2State.fileHistoryIdx < 0 || l2State.fileHistoryIdx >= l2State.fileHistory.length - 1) return;
    _saveL2Snapshot();
    l2State.fileHistoryIdx += 1;
    const fileRel = l2State.fileHistory[l2State.fileHistoryIdx];
    if (!fileRel) return;
    _applyL2Snapshot(l2State.fileHistoryIdx);
    openL2File(fileRel, { pushHistory: false });
}

function setL2ToolbarVisible(v) {
    const bar = document.getElementById('l2-toolbar');
    if (bar) bar.classList.toggle('hidden', !v);

    const extLinesBtn = document.getElementById('l2-toggle-ext-lines');
    if (extLinesBtn) extLinesBtn.style.display = (v && l2State.showExternalFuncs) ? 'block' : 'none';
}

function updateL2Toolbar(fileRel, stats) {
    const label = document.getElementById('l2-file-label');
    const statsEl = document.getElementById('l2-stats');
    if (label) {
        label.textContent = fileRel || T('noFile');
        label.title = fileRel || '';
    }
    if (statsEl && stats) {
        statsEl.dataset.stats = JSON.stringify(stats);
        statsEl.textContent = _formatL2Stats(stats);
    }
}

function clearFuncOverlay() {
    const fv = document.getElementById('func-view');
    if (!fv) return;
    fv.classList.remove('active');
    fv.innerHTML = '';
    document.getElementById('cy').style.display = '';
}

function openFileInVsCode(fileRel) {
    if (!fileRel) return;
    const root = DATA.stats.root;
    const abs = root.replace(/\//g, '\\') + '\\' + fileRel.replace(/\//g, '\\');
    window.open(`vscode://file/${abs}`);
}

function resetL2State(fileRel) {
    l2State.activeFile = fileRel;
    l2State.activeFuncIdx = 0;
    l2State.expandedModules = new Set();
    l2State.expandedSysCategories = new Set();
    l2State.externalModules = [];
    // Release large derived maps so old per-file caches don't pin memory via closure refs.
    l2State._sysMap = null;
    l2State._funcs = null;
    l2State._fidMap = null;
    l2State._extMap = null;
    l2State._potMap = null;
    l2State._prevNodeIds = null;
    if (window.resetL2Filters) resetL2Filters();
}

function resetL2History() {
    l2State.fileHistory = [];
    l2State.fileHistoryIdx = -1;
    l2State.fileHistorySnapshots = [];
}

function resolveModuleForFile(fileRel) {
    if (!fileRel || !DATA) return null;
    if (!fileRel.includes('/')) return '_root';
    const map = DATA.file_to_module || {};
    let mod = map[fileRel] || null;
    if (!mod) {
        const first = fileRel.split('/')[0];
        if (first && Array.isArray(DATA.modules) && DATA.modules.some(m => m.id === first)) {
            mod = first;
        }
    }
    return mod;
}

function syncBreadcrumbForFile(fileRel) {
    if (!fileRel) return;
    state.level = 2;
    state.activeFile = fileRel;
    const mod = resolveModuleForFile(fileRel);
    state.activeModule = mod || null;
    state.activeSubDir = null;
    const last = state.history[state.history.length - 1];
    if (mod && last && last.level === 1) {
        last.activeModule = mod;
    }
    updateBreadcrumb();
}

function focusL2Func(fileRel, idx, opts = {}) {
    const { center = false, openCodePanel = true } = opts;
    const funcs = DATA.funcs_by_file[fileRel] || [];
    if (!funcs[idx]) return;
    l2State.activeFuncIdx = idx;
    const node = cy.$id(`fn-${idx}`);
    if (node && node.length) {
        cy.elements().unselect();
        node.select();
        if (center) {
            cy.animate({ center: { eles: node }, duration: 200 });
        }
    }
    if (openCodePanel) {
        _syncCodePanel(fileRel, funcs[idx].label);
    }
    updateL2NavButtons();
}

function focusL2External(entry, opts = {}) {
    const { center = false } = opts;
    if (!entry) return;
    let node = entry.nodeId ? cy.$id(entry.nodeId) : null;
    if (!node || !node.length) {
        node = cy.nodes().filter(n => n.data('_t') === 'ext_func'
            && n.data('fn') === entry.func
            && n.data('mod') === entry.mod);
    }
    if (node && node.length) {
        cy.elements().unselect();
        node.select();
        highlightNode(node);
        if (center) cy.animate({ center: { eles: node }, duration: 200 });
    }
    if (entry.file) _syncCodePanel(entry.file, entry.func);
    updateL2NavButtons();
}

function syncActiveL2FuncCode(targetCallText = null) {
    const fileRel = l2State.activeFile;
    if (!fileRel) return;
    const funcs = DATA.funcs_by_file[fileRel] || [];
    let idx = l2State.activeFuncIdx || 0;
    if (idx < 0 || idx >= funcs.length) idx = 0;
    const funcName = funcs[idx]?.label || null;
    _syncCodePanel(fileRel, funcName || null, targetCallText);
}

function pickCallerIdxForExternal(node) {
    if (!node || !cy) return null;
    const callers = node.incomers('edge').sources().filter(n => n.data('_t') === 'func');
    if (!callers.length) return null;
    const activeIdx = l2State.activeFuncIdx;
    if (activeIdx != null) {
        const activeNode = cy.$id(`fn-${activeIdx}`);
        if (activeNode && activeNode.length) {
            const isCaller = callers.some(n => n.id() === activeNode.id());
            if (isCaller) return activeIdx;
        }
    }
    return callers[0]?.data('idx') ?? null;
}

function pushL2FileHistory(fileRel) {
    const current = l2State.fileHistory[l2State.fileHistoryIdx];
    if (current === fileRel) return;
    if (l2State.fileHistoryIdx < l2State.fileHistory.length - 1) {
        l2State.fileHistory = l2State.fileHistory.slice(0, l2State.fileHistoryIdx + 1);
    }
    l2State.fileHistory.push(fileRel);
    // Cap to prevent unbounded snapshot/history growth on long sessions
    while (l2State.fileHistory.length > 50) {
        l2State.fileHistory.shift();
        if (Array.isArray(l2State.fileHistorySnapshots) && l2State.fileHistorySnapshots.length)
            l2State.fileHistorySnapshots.shift();
    }
    l2State.fileHistoryIdx = l2State.fileHistory.length - 1;
}

function toggleExternalGroup(modName) {
    if (!modName) return;
    const modSlug = _safeId(modName) + '-' + _hashId(modName);
    const groupNode = cy.$id(`extmod-${modSlug}`);

    if (l2State.expandedModules.has(modName)) {
        l2State.expandedModules.delete(modName);
        l2State.expandOriginPos = null; // collapse 不做展開動畫
    } else {
        l2State.expandedModules.add(modName);
        if (groupNode && groupNode.length) {
            l2State.expandOriginPos = { ...groupNode.position() };
        } else {
            l2State.expandOriginPos = null;
        }
    }
    l2State.preserveViewport = { pan: { ...cy.pan() }, zoom: cy.zoom() };

    renderL2Flowchart(l2State.activeFile);
}

// ─── Toggle sys_group (known system APIs + unresolved) ────────────────────────
// Mirrors toggleExternalGroup: saves origin + viewport, re-runs renderL2Flowchart
// so dagre handles layout (no overlaps) and spawn animation fires normally.
function toggleSysGroup(catName) {
    if (!l2State.expandedSysCategories) l2State.expandedSysCategories = new Set();

    const isUnk = catName === '__unk__';
    const catSlug = isUnk ? null : _safeId(catName) + '-' + _hashId(catName);
    const groupId = isUnk ? 'extmod-unknown' : `syscat-${catSlug}`;

    if (l2State.expandedSysCategories.has(catName)) {
        l2State.expandedSysCategories.delete(catName);
        l2State.expandOriginPos = null;
    } else {
        l2State.expandedSysCategories.add(catName);
        const groupNode = cy.$id(groupId);
        l2State.expandOriginPos = (groupNode && groupNode.length)
            ? { ...groupNode.position() }
            : null;
    }

    l2State.preserveViewport = { pan: { ...cy.pan() }, zoom: cy.zoom() };
    renderL2Flowchart(l2State.activeFile);
}

// ─── (dead code below — kept so git diff is readable, never called) ──────────
function _toggleSysGroup_old(catName) {
    if (!l2State.expandedSysCategories) l2State.expandedSysCategories = new Set();
    const isUnk = catName === '__unk__';
    const catSlug = isUnk ? null : _safeId(catName) + '-' + _hashId(catName);
    const groupId = isUnk ? 'extmod-unknown' : `syscat-${catSlug}`;
    const isExpanded = l2State.expandedSysCategories.has(catName);

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
    const style = isUnk ? { color: '#475569', bg: '#1a1218' } : (SYS_CAT_STYLE[catName] || SYS_DEFAULT);

    const sysMap = l2State._sysMap || new Map();
    const unkMap = l2State._unkMap || new Map();
    const funcs = l2State._funcs || [];

    if (isExpanded) {
        // ── Collapse: remove individual func nodes, restore group node ─────────
        l2State.expandedSysCategories.delete(catName);

        // Find position centroid of expanded nodes to place group at
        const fnPrefix = isUnk ? 'unkfn-' : `sysfn-${catSlug}-`;
        const expandedNodes = cy.nodes().filter(n => n.id().startsWith(fnPrefix));
        let cx = 0, cy2 = 0;
        expandedNodes.forEach(n => { cx += n.position('x'); cy2 += n.position('y'); });
        if (expandedNodes.length) { cx /= expandedNodes.length; cy2 /= expandedNodes.length; }

        // Remove expanded nodes and their edges
        expandedNodes.connectedEdges().remove();
        expandedNodes.remove();

        // Count for collapsed label
        const fnMap = isUnk ? unkMap : sysMap.get(catName);
        const funcCount = fnMap ? fnMap.size : 0;

        // Add group node back at centroid
        cy.add({
            data: {
                id: groupId,
                label: isUnk ? `Unresolved\n${funcCount} funcs` : `${catName}\n${funcCount} funcs`,
                bg: style.bg, bc: style.color,
                w: isUnk ? 160 : 170, h: 52, sh: 'roundrectangle', lvl: 2,
                _t: 'sys_group', syscat: catName,
                tt: isUnk
                    ? `Unresolved symbols (${funcCount})\nClick to expand ↕`
                    : `${catName}\n${funcCount} funcs\n\nClick to expand ↕`,
            },
            position: { x: cx || 0, y: cy2 || 0 }
        });

        // Re-add edges from caller func nodes to this group
        const callerSet = new Map();
        if (isUnk) {
            unkMap.forEach(callers => callers.forEach(idx => callerSet.set(idx, (callerSet.get(idx) || 0) + 1)));
        } else {
            (sysMap.get(catName) || new Map()).forEach(callerSetI => callerSetI.forEach(idx => callerSet.set(idx, (callerSet.get(idx) || 0) + 1)));
        }
        callerSet.forEach((count, callerIdx) => {
            const edgeId = isUnk ? `unke-${callerIdx}` : `syse-${catSlug}-${callerIdx}`;
            if (!cy.$id(edgeId).length && cy.$id(`fn-${callerIdx}`).length) {
                cy.add({
                    data: {
                        id: edgeId,
                        source: `fn-${callerIdx}`, target: groupId,
                        w: Math.min(3, 1 + count / 3), ec: style.color,
                        es: isUnk ? 'dotted' : 'solid', el: '',
                        tt: isUnk ? `→ unresolved (${count})` : `→ ${catName} (${count} call${count !== 1 ? 's' : ''})`,
                    }
                });
            }
        });

    } else {
        // ── Expand: remove group node, scatter individual func nodes around it ──
        l2State.expandedSysCategories.add(catName);

        const groupNode = cy.$id(groupId);
        const origin = groupNode.length ? { ...groupNode.position() } : { x: 0, y: 0 };

        // Remove collapsed group node + its edges
        groupNode.connectedEdges().remove();
        groupNode.remove();

        const fnMap = isUnk ? unkMap : (sysMap.get(catName) || new Map());
        const NODE_W = 160, NODE_H = 42, GAP = 10;
        const COLS = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(fnMap.size))));
        let fnIdx = 0;

        fnMap.forEach((callerSet, funcName) => {
            const fnId = isUnk ? `unkfn-${_hashId(funcName)}` : `sysfn-${catSlug}-${_hashId(funcName)}`;
            const col = fnIdx % COLS;
            const row = Math.floor(fnIdx / COLS);
            const nx = origin.x + (col - (COLS - 1) / 2) * (NODE_W + GAP);
            const ny = origin.y + (row + 1) * (NODE_H + GAP + 10);

            cy.add({
                data: {
                    id: fnId,
                    label: `${funcName}\n(${catName})`,
                    bg: style.bg, bc: style.color,
                    w: NODE_W, h: NODE_H, sh: 'roundrectangle', lvl: 2,
                    _t: 'sys_func', fn: funcName, syscat: catName,
                    tt: isUnk
                        ? `${funcName}\nUnresolved — not found in scanned files.`
                        : `${funcName}\n${catName}\n\nKnown system API.`,
                },
                position: { x: nx, y: ny }
            });

            const callers = isUnk ? callerSet : callerSet; // both are Sets
            callers.forEach(callerIdx => {
                const edgeId = isUnk
                    ? `unkfne-${_hashId(funcName)}-${callerIdx}`
                    : `sysfne-${catSlug}-${callerIdx}-${_hashId(funcName)}`;
                if (!cy.$id(edgeId).length && cy.$id(`fn-${callerIdx}`).length) {
                    cy.add({
                        data: {
                            id: edgeId,
                            source: `fn-${callerIdx}`, target: fnId,
                            w: isUnk ? 1.2 : 1.5, ec: style.color,
                            es: isUnk ? 'dotted' : 'solid', el: '',
                            tt: `${(funcs[callerIdx] || {}).label || callerIdx} → ${funcName}`,
                        }
                    });
                }
            });
            fnIdx++;
        });
    }
}

function openL2File(fileRel, opts = {}) {
    const { pushHistory = true, newSession = false, focusFunc = null } = opts;
    if (!fileRel) return;
    document.getElementById('cy')?.classList.add('l2-view');
    if (newSession) resetL2History();
    pushHistory && pushL2FileHistory(fileRel);
    syncBreadcrumbForFile(fileRel);
    renderL2Flowchart(fileRel, focusFunc);
    updateL2NavButtons();
}


