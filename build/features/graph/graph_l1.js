function loadLevel0() {
  if (typeof pushGlobalNavSnapshot === "function" && !isGlobalNavRestoring() && (state.level !== 0 || _navSelectedNodeId())) {
    pushGlobalNavSnapshot("load-l0");
  }
  if (state.galaxyActive && typeof closeGalaxy === "function") closeGalaxy();
  showLoading(true, T("renderingModules"));
  clearSelection();
  hideFuncView();
  if (window._sv && window._sv.active && window.svHideSvView) window.svHideSvView();
  if (window.svHideStructureBtn) svHideStructureBtn();
  setCodeBtnEnabled(false);
  if (window._lswUpdate) window._lswUpdate({ disabled: false, active: 0, l1Available: false, l2Available: false, l3Available: false });
  if (codeState.isOpen) {
    closeCodePanel();
    codeState.userClosed = false;
  }
  state.level = 0;
  state.activeModule = null;
  state.activeFile = null;
  state.activeSubDir = null;
  buildFtFilter(null, null);
  buildEdgeFilter();
  buildNodeLegend();
  updateBreadcrumb();
  setSidebarActive(null);
  setL1ToolbarVisible(false);
  if (window.updateFilterTabEnabled) updateFilterTabEnabled();
  depMapState.navHistory = [];
  depMapState.navHistoryIdx = -1;
  updateL1NavButtons();
  _clearL1EmptyOverlay();
  const els = [];
  const hasRootModule = (DATA.modules || []).some((m) => m.id === "_root");
  const rootOther = (DATA.other_files_by_module || {})["_root"] || [];
  const rootFiles = (DATA.files_by_module || {})["_root"] || [];
  if (!hasRootModule && (rootOther.length || rootFiles.length)) {
    const rootPath = (DATA.stats?.root || "").replace(/\\/g, "/").replace(/\/$/, "");
    const rootName = rootPath.split("/").filter(Boolean).pop() || "_root";
    const rootFuncCount = rootFiles.reduce((s, f) => s + (f.func_count || 0), 0);
    const rootColor = "#94a3b8";
    const totalCount = rootFiles.length + rootOther.length;
    const ttExtra = rootOther.length ? `
${T("otherBinary", { count: rootOther.length })}` : "";
    const rootMod = {
      id: "_root",
      label: rootName,
      color: rootColor,
      file_count: rootFiles.length,
      func_count: rootFuncCount,
      other_count: rootOther.length
    };
    const isSimpleL02 = _shapeMode === "simple";
    els.push({
      data: {
        id: rootMod.id,
        label: `${rootName}
${totalCount} files`,
        bg: isSimpleL02 ? rootColor : rootColor + "18",
        bc: rootColor,
        lvl: 0,
        w: isSimpleL02 ? SIMPLE_NODE_SIZE_LG : 190,
        h: isSimpleL02 ? SIMPLE_NODE_SIZE_LG : 68,
        sh: isSimpleL02 ? "ellipse" : "roundrectangle",
        simple: isSimpleL02 ? 1 : 0,
        tt: `${rootName}
Analysed: ${rootFiles.length} | Funcs: ${rootFuncCount}${ttExtra}`,
        _t: "module",
        _m: rootMod
      }
    });
  }
  const isSimpleL0 = _shapeMode === "simple";
  DATA.modules.forEach((m) => {
    const otherCount = m.other_count || 0;
    const totalLabel = `${m.id}
${m.file_count} files`;
    const ttExtra = otherCount ? `
${T("otherBinary", { count: otherCount })}` : "";
    els.push({
      data: {
        id: m.id,
        label: totalLabel,
        bg: isSimpleL0 ? m.color : m.color + "18",
        bc: m.color,
        lvl: 0,
        w: isSimpleL0 ? SIMPLE_NODE_SIZE_LG : 190,
        h: isSimpleL0 ? SIMPLE_NODE_SIZE_LG : 68,
        sh: isSimpleL0 ? "ellipse" : "roundrectangle",
        simple: isSimpleL0 ? 1 : 0,
        tt: `${m.id}
Analysed: ${m.file_count} | Funcs: ${m.func_count}${ttExtra}`,
        _t: "module",
        _m: m
      }
    });
  });
  const edges = [...DATA.module_edges].sort((a, b) => b.weight - a.weight).slice(0, 300);
  edges.forEach((e, i) => {
    els.push({
      data: {
        id: `me${i}`,
        source: e.s,
        target: e.t,
        w: Math.max(1, Math.min(6, e.weight / 8)),
        wt: e.weight,
        ec: "#2a3a55",
        es: "solid",
        el: ""
      }
    });
  });
  cy.batch(() => {
    cy.json({ elements: [] });
    cy.add(els);
  });
  applyCyFont(getSavedFont());
  const l0LayoutId = _PREFS.get("layoutL0");
  const l0Preset = LAYOUT_PRESETS.find((p) => p.id === l0LayoutId);
  _syncLayoutIndicator(l0LayoutId);
  refreshLayoutSwitcher();
  const l0Config = l0Preset && (!l0Preset.requires || _isLayoutAvailable(l0Preset.requires)) ? { ...l0Preset.config(), animate: false } : { name: "cose", animate: false, randomize: true, nodeRepulsion: 1e4, idealEdgeLength: 200, nodeOverlap: 20, padding: 60 };
  if (!l0Preset || l0Preset.requires && !_isLayoutAvailable(l0Preset.requires)) {
    _syncLayoutIndicator("cose");
  }
  applyLayoutWithCache("L0", l0Config, () => {
    showLoading(false);
    if (typeof applyPendingGlobalNavRestore !== "function" || !applyPendingGlobalNavRestore("l0")) {
      _fitGraphAfterNavigation();
    }
  });
}
function _fitGraphAfterNavigation(padding = 40) {
  if (!cy || !cy.elements || !cy.elements().length) return;
  requestAnimationFrame(() => {
    if (!cy || !cy.elements || !cy.elements().length) return;
    cy.stop();
    cy.fit(cy.elements(), padding);
  });
}
function _clearL1EmptyOverlay() {
  const ov = document.getElementById("l1-empty-overlay");
  if (ov) ov.remove();
}
const _L1_FORCE_LAYOUTS = /* @__PURE__ */ new Set(["cose", "fcose", "cola"]);
const _L1_FORCE_DOWNGRADE_NODES = 200;
const _L1_DAGRE_LR = { name: "dagre", rankDir: "LR", animate: false, nodeSep: 30, rankSep: 90, padding: 40 };
function _resolveL1Layout(nodeCount) {
  const id = _PREFS.get("layoutL1");
  const preset = LAYOUT_PRESETS.find((p) => p.id === id);
  const available = preset && (!preset.requires || _isLayoutAvailable(preset.requires));
  if (available) {
    const cfg = { ...preset.config(), animate: false };
    const tooBig = _L1_FORCE_LAYOUTS.has(cfg.name) && nodeCount > _L1_FORCE_DOWNGRADE_NODES;
    if (!tooBig) return { effectiveId: id, config: cfg };
    console.log(`[layout] '${cfg.name}' downgraded to dagre (${nodeCount} nodes > ${_L1_FORCE_DOWNGRADE_NODES})`);
  }
  return { effectiveId: "dagre-lr", config: { ..._L1_DAGRE_LR } };
}
function drillToModule(modId, opts) {
  if (typeof pushGlobalNavSnapshot === "function" && !isGlobalNavRestoring()) {
    pushGlobalNavSnapshot("drill-module");
  }
  if (window._sv && window._sv.active && window.svHideSvView) window.svHideSvView();
  if (window.svHideStructureBtn) svHideStructureBtn();
  setCodeBtnEnabled(false);
  if (window._lswUpdate) window._lswUpdate({ disabled: false, active: 1, l1Available: true, l2Available: false, l3Available: false });
  if (state.level === 0 && !isGlobalNavRestoring()) state.history.push({ level: 0 });
  state.level = 1;
  state.activeModule = modId;
  state.activeSubDir = null;
  showLoading(true, T("loadingModule", { module: modId }));
  clearSelection();
  hideFuncView();
  setSidebarActive(modId);
  document.querySelectorAll(".subdir-row").forEach((el) => el.classList.remove("active"));
  if (depMapState.currentModId !== modId) {
    depMapState.expandedExtModules = /* @__PURE__ */ new Set();
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
  if (modId === "_root" && allOther.length && allFiles.length === 0) {
    ftActiveFilter.add("other");
    if (allOther.some((f) => f.file_type === "binary")) ftActiveFilter.add("binary");
  }
  if (opts?.focusFile) {
    const focusPath = opts.focusFile;
    const modPrefix = modId + "/";
    const relPath = focusPath.startsWith(modPrefix) ? focusPath.slice(modPrefix.length) : focusPath;
    const parts = relPath.split("/");
    if (parts.length >= 2) {
      const subPath = parts.slice(0, -1).join("/");
      const prefix = modId + "/" + subPath + "/";
      const filtered = allFiles.filter(
        (f) => f.path.startsWith(prefix) || f.path === modId + "/" + subPath
      );
      pushL1History(modId, subPath);
      updateL1Toolbar(`${modId} / ${subPath}`, filtered.length);
      state.activeSubDir = subPath;
      setSubdirActive(modId, subPath);
      const modRow = document.getElementById(`mi-${modId}`);
      if (modRow) {
        const children = modRow.nextElementSibling;
        if (children && !children.classList.contains("open")) {
          children.classList.add("open");
          const iconEl = modRow.querySelector(".subdir-icon");
          if (iconEl) iconEl.innerHTML = _iconFolderOpen();
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
function renderFilesFlat(modId, files, subPath) {
  _clearL1EmptyOverlay();
  const visible = files.filter((f) => ftActiveFilter.has(f.file_type || "other"));
  const showOther = ftActiveFilter.has("other");
  const showBinary = ftActiveFilter.has("binary");
  let otherFiles = [];
  if (showOther || showBinary) {
    const allOther = (DATA.other_files_by_module || {})[modId] || [];
    const pathFiltered = subPath ? allOther.filter((f) => f.path.startsWith(modId + "/" + subPath + "/") || f.path === modId + "/" + subPath) : allOther;
    otherFiles = pathFiltered.filter(
      (f) => f.file_type === "other" && showOther || f.file_type === "binary" && showBinary
    );
  }
  const capped = visible.slice(0, 250);
  const cappedOther = otherFiles.slice(0, Math.max(0, 400 - capped.length));
  const visIds = new Set(capped.map((f) => `f${f.id}`));
  const allEdges = DATA.file_edges_by_module[modId] || [];
  const edges = allEdges.filter((e) => visIds.has(`f${e.s}`) && visIds.has(`f${e.t}`)).slice(0, 600);
  const els = [];
  capped.forEach((f) => {
    els.push({ data: fileNodeData(f) });
  });
  cappedOther.forEach((f) => {
    els.push({ data: otherFileNodeData(f) });
  });
  edges.forEach((e, i) => {
    const es = edgeTypeStyle(e.type);
    const isInferred = e.type === "inferred";
    const edgeData = {
      id: `fe${i}`,
      source: `f${e.s}`,
      target: `f${e.t}`,
      w: EDGE_WIDTH.fileInternal,
      ec: es.color,
      es: isInferred ? "dashed" : EDGE_STYLE_INTERNAL,
      el: es.label,
      edgeLabel: depMapState.showEdgeTypeLabels ? es.label : "",
      etype: e.type || "include"
    };
    if (e.via) edgeData.via = e.via;
    if (e.subtype) edgeData.subtype = e.subtype;
    if (e.origin) edgeData.origin = e.origin;
    if (e.line) edgeData.line = e.line;
    if (e.subtype || e.origin || e.line) {
      edgeData.tt = [
        `${es.label}${e.subtype ? ` (${e.subtype})` : ""}`,
        e.origin ? `origin: ${e.origin}` : "",
        e.line ? `line: ${e.line}` : "",
        e.via ? `via: ${e.via}` : ""
      ].filter(Boolean).join("\n");
    }
    if (isInferred) {
      const conf = typeof e.confidence === "number" ? e.confidence.toFixed(2) : "?";
      const reason = e.reason || "";
      edgeData.tt = `Inferred (AI)
confidence: ${conf}` + (reason ? `
reason: ${reason}` : "");
    }
    els.push({ data: edgeData });
  });
  const moduleColorMap = {};
  (DATA.modules || []).forEach((m) => {
    moduleColorMap[m.id] = m.color;
  });
  if (depMapState.showExternalFiles) {
    const extEdges = allEdges.filter((e) => visIds.has(`f${e.s}`) && !visIds.has(`f${e.t}`));
    const extModMap = /* @__PURE__ */ new Map();
    extEdges.forEach((e) => {
      const targetMod = _fileIdToModule[e.t] || "_external";
      if (!extModMap.has(targetMod)) extModMap.set(targetMod, /* @__PURE__ */ new Map());
      const modFiles = extModMap.get(targetMod);
      if (!modFiles.has(e.t)) {
        modFiles.set(e.t, {
          file: _fileIdToFile[e.t] || null,
          edgeType: e.type || "include",
          sources: /* @__PURE__ */ new Set()
        });
      }
      modFiles.get(e.t).sources.add(e.s);
    });
    depMapState.currentExtModules = Array.from(extModMap.keys());
    let extEdgeSeq = 0;
    for (const [extModId, fileMap] of extModMap.entries()) {
      const modSlug = _safeId(extModId) + "-" + _hashId(extModId);
      const groupId = `depext-${modSlug}`;
      const fileCount = fileMap.size;
      const isExpanded = depMapState.expandedExtModules.has(extModId);
      const modColor = moduleColorMap[extModId] || "#64748b";
      const isSimpleExt = _shapeMode === "simple";
      if (!isExpanded) {
        els.push({
          data: {
            id: groupId,
            label: `${extModId}
${fileCount} file${fileCount !== 1 ? "s" : ""}`,
            bg: isSimpleExt ? modColor : "#111827",
            bc: modColor,
            w: isSimpleExt ? SIMPLE_NODE_SIZE_MD : 170,
            h: isSimpleExt ? SIMPLE_NODE_SIZE_MD : 52,
            sh: isSimpleExt ? "ellipse" : "roundrectangle",
            lvl: 1,
            simple: isSimpleExt ? 1 : 0,
            _t: "dep_ext_group",
            mod: extModId,
            tt: `External Module: ${extModId}
Referenced files: ${fileCount}
Click to expand`
          }
        });
        const sourceAgg = /* @__PURE__ */ new Map();
        fileMap.forEach((info) => {
          info.sources.forEach((srcId) => {
            if (!sourceAgg.has(srcId)) sourceAgg.set(srcId, { count: 0, types: /* @__PURE__ */ new Map() });
            const agg = sourceAgg.get(srcId);
            agg.count++;
            agg.types.set(info.edgeType, (agg.types.get(info.edgeType) || 0) + 1);
          });
        });
        for (const [srcId, agg] of sourceAgg.entries()) {
          const dominantType = [...agg.types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "include";
          const edgeStyle = edgeTypeStyle(dominantType);
          els.push({
            data: {
              id: `depexte-${modSlug}-${srcId}`,
              source: `f${srcId}`,
              target: groupId,
              w: Math.min(2.4, EDGE_WIDTH.fileExternal + agg.count * 0.25),
              ec: edgeStyle.color,
              es: EDGE_STYLE_EXTERNAL,
              el: edgeStyle.label,
              edgeLabel: depMapState.showEdgeTypeLabels ? edgeStyle.label : "",
              tt: `\u2192 ${extModId} (${agg.count} ref${agg.count !== 1 ? "s" : ""})`
            }
          });
          extEdgeSeq++;
        }
      } else {
        fileMap.forEach((info, fileId) => {
          const f = info.file;
          if (!f) return;
          const fnId = `depextf-${modSlug}-${fileId}`;
          const ft = f.file_type || "other";
          const shape = FILE_TYPE_SHAPE[ft] || FILE_TYPE_SHAPE["other"];
          const eff = isSimpleExt ? { sh: "ellipse", w: SIMPLE_NODE_SIZE_SM, h: SIMPLE_NODE_SIZE_SM } : shape;
          const fileColor = extColor(f.ext || "");
          const pathParts = f.path.split("/");
          const folderName = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : "";
          const nodeLabel = folderName ? `${f.label}
(${folderName})` : f.label;
          const nodeH = isSimpleExt ? SIMPLE_NODE_SIZE_SM : folderName ? Math.max(shape.h, 54) : shape.h;
          els.push({
            data: {
              id: fnId,
              label: nodeLabel,
              bg: isSimpleExt ? fileColor : "#0a1520",
              bc: fileColor,
              w: eff.w,
              h: nodeH,
              sh: eff.sh,
              lvl: 1,
              simple: isSimpleExt ? 1 : 0,
              _t: "dep_ext_file",
              _f: f,
              mod: extModId,
              tt: `${f.path}
Module: ${extModId}
Type: ${ft}
(External file)`
            }
          });
          const es = edgeTypeStyle(info.edgeType);
          info.sources.forEach((srcId) => {
            els.push({
              data: {
                id: `depextfe-${modSlug}-${srcId}-${fileId}`,
                source: `f${srcId}`,
                target: fnId,
                w: EDGE_WIDTH.fileExternal,
                ec: es.color,
                es: EDGE_STYLE_EXTERNAL,
                el: es.label,
                edgeLabel: depMapState.showEdgeTypeLabels ? es.label : "",
                tt: `\u2192 ${f.label} (${info.edgeType})`
              }
            });
            extEdgeSeq++;
          });
        });
      }
    }
    const hasExt = extModMap.size > 0;
    const expandBtn = document.getElementById("l1-expand-all-ext");
    const collapseBtn = document.getElementById("l1-collapse-all-ext");
    if (expandBtn) expandBtn.style.display = hasExt ? "" : "none";
    if (collapseBtn) collapseBtn.style.display = hasExt ? "" : "none";
    const statsEl = document.getElementById("l1-stats");
    if (statsEl) {
      const parts = [`${capped.length} files`];
      if (hasExt) parts.push(`${extModMap.size} ext module${extModMap.size !== 1 ? "s" : ""}`);
      statsEl.textContent = parts.join(" | ");
    }
  } else {
    const expandBtn = document.getElementById("l1-expand-all-ext");
    const collapseBtn = document.getElementById("l1-collapse-all-ext");
    if (expandBtn) expandBtn.style.display = "none";
    if (collapseBtn) collapseBtn.style.display = "none";
    depMapState.currentExtModules = [];
    const statsEl = document.getElementById("l1-stats");
    if (statsEl) statsEl.textContent = `${capped.length} files`;
  }
  depMapState._animGen++;
  const _l1Key = `L1:${modId || ""}:${subPath || ""}|ext=${depMapState.showExternalFiles ? 1 : 0}|exp=${Array.from(depMapState.expandedExtModules || []).sort().join(",")}`;
  const _l1Cached = _layoutCacheGet(_l1Key);
  const _l1IsRevisit = !!(_l1Cached && _l1Cached.positions && _l1Cached.positions.size);
  if (_l1IsRevisit) showLoading(false);
  const _l1Token = ++_renderToken;
  setTimeout(() => {
    if (_renderToken !== _l1Token) return;
    cy.elements().stop(true, false);
    const prevNodeIds = new Set(cy.nodes().map((n) => n.id()));
    depMapState._prevNodeIds = prevNodeIds;
    console.time("[l1] rebuild");
    cy.batch(() => {
      cy.json({ elements: [] });
      cy.add(els);
    });
    console.timeEnd("[l1] rebuild");
    applyCyFont(getSavedFont());
    if (cy.nodes().length === 0) {
      const emptyOverlay = document.createElement("div");
      emptyOverlay.id = "l1-empty-overlay";
      emptyOverlay.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:999;background:var(--canvas-bg)";
      emptyOverlay.innerHTML = `<div style="text-align:center;color:var(--muted);padding:80px 20px;max-width:500px">
                    <div style="font-size:56px;margin-bottom:20px;opacity:0.6">\u{1F4C2}</div>
                    <div style="font-size:16px;font-weight:500;margin-bottom:12px;color:var(--text)">${T("noVisibleFiles") || "No visible files"}</div>
                    <div style="font-size:13px;line-height:1.7;opacity:0.8">
                        ${T("noVisibleFilesHint") || "Try adjusting the File Type filter in the sidebar, or check if this folder contains any source files."}
                    </div>
                </div>`;
      document.getElementById("cy")?.appendChild(emptyOverlay);
      showLoading(false);
      updateBreadcrumb();
      buildEdgeFilter();
      buildNodeLegend();
      updateSidebarStats();
      if (typeof applyPendingGlobalNavRestore === "function") applyPendingGlobalNavRestore("l1");
      return;
    }
    const mainEls = cy.elements().filter((el) => !el.data("isExtra"));
    const extraEls = cy.nodes().filter((n) => n.data("isExtra"));
    if (_l1IsRevisit) {
      console.log(`[layout] cache hit: ${_l1Key}`);
      extraEls.style("display", "element");
      const lay = cy.layout({
        name: "preset",
        positions: (n) => _l1Cached.positions.get(n.id()) || { x: 0, y: 0 },
        animate: false,
        fit: false
      });
      lay.one("layoutstop", () => {
        if (_renderToken !== _l1Token) return;
        updateBreadcrumb();
        showLoading(false);
        _postLayoutL1();
      });
      lay.run();
      return;
    }
    const _snapshotL1Positions = () => {
      const positions = /* @__PURE__ */ new Map();
      cy.nodes().forEach((n) => {
        const p = n.position();
        positions.set(n.id(), { x: p.x, y: p.y });
      });
      _layoutCacheSet(_l1Key, positions);
    };
    if (extraEls.length === 0) {
      const { effectiveId, config: l1Config } = _resolveL1Layout(cy.nodes().length);
      _syncLayoutIndicator(effectiveId);
      refreshLayoutSwitcher();
      const lay = cy.layout(l1Config);
      lay.one("layoutstop", () => {
        if (_renderToken !== _l1Token) return;
        _snapshotL1Positions();
        updateBreadcrumb();
        showLoading(false);
        _postLayoutL1();
      });
      lay.run();
      return;
    }
    extraEls.style("display", "none");
    const { effectiveId: _l1eid2, config: l1Config2 } = _resolveL1Layout(mainEls.length);
    _syncLayoutIndicator(_l1eid2);
    const layMain = cy.layout(l1Config2);
    layMain.one("layoutstop", () => {
      if (_renderToken !== _l1Token) return;
      extraEls.style("display", "element");
      const bb = mainEls.length ? mainEls.boundingBox() : { x1: 40, y1: 40, x2: 400, y2: 200 };
      const graphWidth = Math.max(bb.x2 - bb.x1, 600);
      const NODE_W = 155;
      const NODE_H = 42;
      const H_GAP = 14;
      const V_GAP = 10;
      const COLS = Math.max(1, Math.floor(graphWidth / (NODE_W + H_GAP)));
      const startX = bb.x1;
      const startY = bb.y2 + 60;
      extraEls.forEach((n, idx) => {
        const col = idx % COLS;
        const row = Math.floor(idx / COLS);
        n.position({
          x: startX + col * (NODE_W + H_GAP) + NODE_W / 2,
          y: startY + row * (NODE_H + V_GAP) + NODE_H / 2
        });
      });
      _snapshotL1Positions();
      updateBreadcrumb();
      showLoading(false);
      _postLayoutL1();
    });
    layMain.run();
  }, 0);
}
function _postLayoutL1() {
  applyEdgeFilter();
  buildEdgeFilter();
  buildNodeLegend();
  updateSidebarStats();
  const savedVP = depMapState.preserveViewport;
  const originPos = depMapState.expandOriginPos;
  const focusPath = depMapState.pendingFocusFile;
  const prevIds = depMapState._prevNodeIds || /* @__PURE__ */ new Set();
  if (typeof applyPendingGlobalNavRestore === "function" && applyPendingGlobalNavRestore("l1")) {
    depMapState.preserveViewport = null;
    depMapState.expandOriginPos = null;
    depMapState.pendingFocusFile = null;
    depMapState._prevNodeIds = null;
    return;
  }
  depMapState.preserveViewport = null;
  depMapState.expandOriginPos = null;
  depMapState.pendingFocusFile = null;
  depMapState._prevNodeIds = null;
  if (savedVP && originPos) {
    cy.viewport({ zoom: savedVP.zoom, pan: savedVP.pan });
    const newNodes = cy.nodes('[_t="dep_ext_file"]').filter((n) => !prevIds.has(n.id()));
    if (newNodes.length > 0) {
      const finalPos = /* @__PURE__ */ new Map();
      newNodes.forEach((n) => finalPos.set(n.id(), { ...n.position() }));
      newNodes.forEach((n) => n.position({ x: originPos.x, y: originPos.y }));
      const myGen = depMapState._animGen;
      let idx = 0;
      newNodes.forEach((n) => {
        const fp = finalPos.get(n.id());
        const nid = n.id();
        const delay = idx * 18;
        setTimeout(() => {
          if (depMapState._animGen !== myGen) return;
          if (!cy.hasElementWithId(nid)) return;
          cy.$id(nid).animate({ position: fp }, { duration: 360, easing: "ease-out-cubic" });
        }, delay);
        idx++;
      });
    } else {
      cy.fit(cy.elements(), 40);
    }
    return;
  }
  if (savedVP && !originPos && !focusPath) {
    cy.viewport({ zoom: savedVP.zoom, pan: savedVP.pan });
    return;
  }
  if (focusPath) {
    const target = cy.nodes().filter((n) => {
      const f = n.data("_f");
      return f && f.path === focusPath;
    }).first();
    if (!target || !target.length) {
      cy.fit(cy.elements(), 40);
      return;
    }
    const myGen = depMapState._animGen;
    cy.fit(cy.elements(), 40);
    setTimeout(() => {
      if (depMapState._animGen !== myGen) return;
      if (!cy.hasElementWithId(target.id())) return;
      highlightNode(target);
      cy.animate({
        center: { eles: target },
        zoom: Math.max(cy.zoom(), 1.8)
      }, {
        duration: 700,
        easing: "ease-in-out-cubic",
        complete: () => {
          if (depMapState._animGen !== myGen) return;
          if (!cy.hasElementWithId(target.id())) return;
          let count = 0;
          const originalBc = target.data("bc");
          const flashInterval = setInterval(() => {
            count++;
            if (!cy.hasElementWithId(target.id())) {
              clearInterval(flashInterval);
              return;
            }
            target.style("border-color", count % 2 === 1 ? _tC("#ffffff", "#8c7851") : originalBc);
            target.style("border-width", count % 2 === 1 ? 4 : 2);
            if (count >= 6) {
              clearInterval(flashInterval);
              target.style("border-color", originalBc);
              target.style("border-width", 2);
            }
          }, 200);
        }
      });
    }, 80);
    return;
  }
  cy.fit(cy.elements(), 40);
}
function setCodeBtnEnabled(enabled) {
  const btn = document.getElementById("code-toggle-btn");
  if (!btn) return;
  btn.disabled = !enabled;
  if (!enabled) btn.classList.remove("active");
}
function updateCallGraphBtn(filePath) {
  if (!window._lswUpdate) return;
  const isL2 = state.level >= 2;
  const hasFuncs = filePath && (DATA.funcs_by_file?.[filePath]?.length || 0) > 0;
  const l2Available = isL2 || hasFuncs;
  const structActive = !!(window._sv && window._sv.active);
  const activeIdx = structActive ? 3 : isL2 ? 2 : state.level === 1 ? 1 : 0;
  window._lswUpdate({ l2Available, active: activeIdx });
}
function restoreL1FromCallGraph() {
  const snap = l2State._l1Snapshot;
  const prevHistory = [...state.history];
  const lastFile = state.activeFile;
  hideFuncView();
  if (window._sv && window._sv.active && window.svHideSvView) window.svHideSvView();
  if (window.svHideStructureBtn) svHideStructureBtn();
  state.level = 1;
  state.activeFile = null;
  state.history = prevHistory.filter((h) => h.level < 2);
  setL1ToolbarVisible(true);
  if (window.updateFilterTabEnabled) updateFilterTabEnabled();
  const ftWrap = document.getElementById("ft-filter");
  if (ftWrap) ftWrap.style.display = "";
  if (snap && snap.sigma) {
    depMapState.preserveViewport = snap;
    depMapState.expandOriginPos = null;
  } else if (snap) {
    depMapState.preserveViewport = { pan: snap.pan, zoom: snap.zoom };
    depMapState.expandOriginPos = null;
  }
  if (state.activeModule) {
    const savedH = [...state.history];
    drillToModule(state.activeModule);
    state.history = savedH;
  } else {
    loadLevel0();
  }
  if (snap?.selectedNodeId) {
    setTimeout(() => {
      cy?.elements().unselect();
      cy?.$id(snap.selectedNodeId).select();
    }, 50);
  }
  if (lastFile && window._lswUpdate) {
    const hasFuncs = (DATA.funcs_by_file?.[lastFile]?.length || 0) > 0;
    const hasSymbols = !!(DATA.symbol_index && Object.values(DATA.symbol_index).some((s) => s.file === lastFile));
    window._lswUpdate({ l2Available: hasFuncs, l3Available: hasSymbols });
  }
  l2State._l1Snapshot = null;
  updateBreadcrumb();
}
