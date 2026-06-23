function renderL2Flowchart(fileRel, focusFuncName = null) {
  if (!fileRel) return;
  showLoading(true, T("renderingCallFlow"));
  clearFuncOverlay();
  setL2ToolbarVisible(true);
  if (l2State.activeFile !== fileRel) {
    resetL2State(fileRel);
    l2State._expandInitialized = false;
  }
  const funcs = DATA.funcs_by_file[fileRel] || [];
  if (focusFuncName) {
    const targetName = String(focusFuncName);
    const idx = funcs.findIndex((f) => String(f.label || "") === targetName || String(f.name || "") === targetName);
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
  const callList = DATA.func_calls_by_file && DATA.func_calls_by_file[fileRel] || null;
  const hasCallList = Array.isArray(callList) && callList.length > 0;
  const legacyEdges = DATA.func_edges_by_file[fileRel] || [];
  const nameToFile = DATA.func_name_to_file || {};
  const nameToFiles = DATA.func_name_to_files || {};
  const fileToModule = DATA.file_to_module || {};
  const moduleColorMap = {};
  (DATA.modules || []).forEach((m) => {
    moduleColorMap[m.id] = m.color;
  });
  const currentModule = fileToModule[fileRel] || resolveModuleForFile(fileRel) || "";
  const fidMap = /* @__PURE__ */ new Map();
  funcs.forEach((f, i) => fidMap.set(f.label, i));
  const isSimple = _shapeMode === "simple";
  const els = [];
  funcs.forEach((f, i) => {
    const isPublic = !!f.is_public;
    const isEfi = !!f.is_efiapi;
    const bg = isEfi ? "#3d2e00" : isPublic ? "#0b2745" : "#1e2433";
    const bc = isEfi ? "#fbbf24" : isPublic ? "#60a5fa" : "#94a3b8";
    const access = isPublic ? T("public") : T("static");
    els.push({
      data: {
        id: `fn-${i}`,
        label: f.label,
        bg: isSimple ? bc : bg,
        bc,
        w: isSimple ? SIMPLE_NODE_SIZE_SM : 150,
        h: isSimple ? SIMPLE_NODE_SIZE_SM : 38,
        sh: isSimple ? "ellipse" : "roundrectangle",
        lvl: 2,
        _t: "func",
        fn: f.label,
        _f: fileRel,
        idx: i,
        access,
        tt: `${T("function")}: ${f.label}
${access}${isEfi ? " EFIAPI" : ""}${f.doc ? "\n\n" + f.doc : ""}`,
        simple: isSimple ? 1 : 0
      }
    });
  });
  const extMap = /* @__PURE__ */ new Map();
  const potMap = /* @__PURE__ */ new Map();
  const sysMap = /* @__PURE__ */ new Map();
  let internalEdgeCount = 0;
  const knownCats = DATA.func_known_categories || {};
  function addExt(modName, callee, targetFiles, callerIdx) {
    if (!extMap.has(modName)) extMap.set(modName, /* @__PURE__ */ new Map());
    const fm = extMap.get(modName);
    if (!fm.has(callee)) fm.set(callee, { files: targetFiles, callers: /* @__PURE__ */ new Set() });
    fm.get(callee).callers.add(callerIdx);
  }
  function addSys(category, callee, callerIdx) {
    if (!sysMap.has(category)) sysMap.set(category, /* @__PURE__ */ new Map());
    const cm = sysMap.get(category);
    if (!cm.has(callee)) cm.set(callee, /* @__PURE__ */ new Set());
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
              source: `fn-${i}`,
              target: `fn-${calleeIdx}`,
              w: EDGE_WIDTH.callInternal,
              ec: edgeTypeStyle("call").color,
              es: EDGE_STYLE_INTERNAL,
              el: "",
              kind: "call",
              l2kind: "call_internal",
              tt: `${funcs[i].label} \u2192 ${callee}`
            }
          });
          internalEdgeCount++;
          continue;
        }
        if (!l2State.showExternalFuncs) continue;
        if (Object.prototype.hasOwnProperty.call(nameToFiles, callee)) {
          const k = `pot:${callee}`;
          if (!potMap.has(k)) potMap.set(k, { callee, files: nameToFiles[callee], callers: /* @__PURE__ */ new Set() });
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
        addExt(fileToModule[targetFile] || "_root", callee, [targetFile], i);
      }
    }
  } else {
    legacyEdges.forEach((e, idx) => {
      const leStyle = edgeTypeStyle(e.type || "call");
      els.push({
        data: {
          id: `le-${idx}`,
          source: `fn-${e.s}`,
          target: `fn-${e.t}`,
          w: EDGE_WIDTH.callInternal,
          ec: leStyle.color,
          es: EDGE_STYLE_INTERNAL,
          el: "",
          kind: leStyle.kind || "call",
          l2kind: "call_internal",
          tt: leStyle.label || "Call"
        }
      });
    });
    internalEdgeCount = legacyEdges.length;
  }
  l2State.externalModules = Array.from(extMap.keys()).sort();
  if (!l2State._expandInitialized) {
    l2State.expandedModules = new Set(extMap.keys());
    l2State._expandInitialized = true;
  }
  for (const [modName, fnMap] of extMap.entries()) {
    const modSlug = _safeId(modName) + "-" + _hashId(modName);
    const modId = `extmod-${modSlug}`;
    const funcCount = fnMap.size;
    const isExpanded = l2State.expandedModules.has(modName);
    const modColor = moduleColorMap[modName] || "#64748b";
    const repFile = fnMap.values().next().value?.files?.[0] || modName;
    const distVal = _pathDist(fileRel, repFile);
    const ec = _distColor(distVal);
    const dLabel = _distLabel(distVal);
    if (!isExpanded) {
      els.push({
        data: {
          id: modId,
          label: `${modName}
${funcCount} funcs`,
          bg: isSimple ? modColor : "#111827",
          bc: modColor,
          w: isSimple ? SIMPLE_NODE_SIZE_MD : 170,
          h: isSimple ? SIMPLE_NODE_SIZE_MD : 52,
          sh: isSimple ? "ellipse" : "roundrectangle",
          lvl: 2,
          simple: isSimple ? 1 : 0,
          _t: "ext_group",
          mod: modName,
          tt: `${T("externalModule")}: ${modName}
${T("topbarFunctions")}: ${funcCount}

${T("clickToExpand")}`
        }
      });
      const callerCounts = /* @__PURE__ */ new Map();
      fnMap.forEach((info) => info.callers.forEach((idx) => callerCounts.set(idx, (callerCounts.get(idx) || 0) + 1)));
      for (const [callerIdx, count] of callerCounts.entries()) {
        els.push({
          data: {
            id: `exte-${modId}-${callerIdx}`,
            source: `fn-${callerIdx}`,
            target: modId,
            w: Math.min(2.6, EDGE_WIDTH.callExternal + count * 0.3),
            ec,
            es: EDGE_STYLE_EXTERNAL,
            el: "ext",
            l2kind: "call_ext",
            tt: `${funcs[callerIdx].label} \u2192 ${modName} (${count})`
          }
        });
      }
    } else {
      let extIdx = 0;
      fnMap.forEach((info, funcName) => {
        const fnId = `extfn-${modSlug}-${_hashId(funcName)}`;
        const tf = info.files[0] || null;
        const fnDist = _pathDist(fileRel, tf || modName);
        const fnEc = _distColor(fnDist);
        const fnDLabel = _distLabel(fnDist);
        els.push({
          data: {
            id: fnId,
            label: `${funcName}
(${modName})`,
            bg: isSimple ? modColor : "#0f172a",
            bc: modColor,
            w: isSimple ? SIMPLE_NODE_SIZE_SM : 160,
            h: isSimple ? SIMPLE_NODE_SIZE_SM : 42,
            sh: isSimple ? "ellipse" : "roundrectangle",
            lvl: 2,
            simple: isSimple ? 1 : 0,
            _t: "ext_func",
            fn: funcName,
            _f: tf,
            mod: modName,
            _drilled: false,
            tt: `${funcName}
${tf || T("fileUnknown")}
${T("modalModule")}: ${modName}

${T("doubleClickDrill")}
${T("clickToCollapse")}`
          }
        });
        info.callers.forEach((callerIdx) => {
          els.push({
            data: {
              id: `extc-${modId}-${callerIdx}-${_hashId(funcName)}`,
              source: `fn-${callerIdx}`,
              target: fnId,
              w: EDGE_WIDTH.callExternal,
              ec: fnEc,
              es: EDGE_STYLE_EXTERNAL,
              el: "ext",
              l2kind: "call_ext",
              tt: `${funcs[callerIdx].label} \u2192 ${funcName}`
            }
          });
        });
        extIdx++;
      });
    }
  }
  for (const [, info] of potMap.entries()) {
    const { callee, files, callers } = info;
    const slug = _safeId(callee) + "-" + _hashId(callee);
    const potId = `pot-${slug}`;
    const firstMod = fileToModule[files[0]] || "";
    const dVal = files[0] ? _pathDist(fileRel, files[0]) : 99;
    const ec = files[0] ? _distColor(dVal) : "#a78bfa";
    els.push({
      data: {
        id: potId,
        label: `${callee}
(${files.length} paths)`,
        bg: isSimple ? "#a78bfa" : "#1a1040",
        bc: "#a78bfa",
        w: isSimple ? SIMPLE_NODE_SIZE_SM : 160,
        h: isSimple ? SIMPLE_NODE_SIZE_SM : 44,
        sh: isSimple ? "ellipse" : "roundrectangle",
        lvl: 2,
        simple: isSimple ? 1 : 0,
        _t: "potential_func",
        fn: callee,
        _files: files,
        tt: `Ambiguous: ${callee}
${T("tooltipPossibleFiles")}
${files.join("\n")}`
      }
    });
    callers.forEach((callerIdx) => {
      els.push({
        data: {
          id: `pote-${slug}-${callerIdx}`,
          source: `fn-${callerIdx}`,
          target: potId,
          w: EDGE_WIDTH.callExternal,
          ec,
          es: EDGE_STYLE_EXTERNAL,
          el: "ext",
          l2kind: "call_potential",
          tt: `${funcs[callerIdx].label} \u2192 ${callee} (ambiguous)`
        }
      });
    });
  }
  l2State._sysMap = sysMap;
  l2State._funcs = funcs;
  l2State.sysCategories = Array.from(sysMap.keys());
  const SYS_CAT_STYLE = {
    "UEFI Boot Services": { color: "#60a5fa", bg: "#0b1e38" },
    "UEFI Runtime Services": { color: "#818cf8", bg: "#110e2e" },
    "EDK2 MemoryLib": { color: "#34d399", bg: "#0a2218" },
    "EDK2 BaseLib": { color: "#dfa745", bg: "#021a22" },
    "EDK2 DebugLib": { color: "#fbbf24", bg: "#1f1500" },
    "EDK2 PrintLib": { color: "#fbbf24", bg: "#1f1500" },
    "EDK2 MemAlloc": { color: "#34d399", bg: "#0a2218" },
    "PEI Services": { color: "#a78bfa", bg: "#180d2e" },
    "EDK2 HobLib": { color: "#a78bfa", bg: "#180d2e" },
    "EDK2 UefiLib": { color: "#60a5fa", bg: "#0b1e38" },
    "EDK2 DevicePath": { color: "#60a5fa", bg: "#0b1e38" },
    "C Runtime": { color: "#fb923c", bg: "#1e0e00" },
    "Firmware SDK": { color: "#e879f9", bg: "#1e0820" },
    "CPU/IO Lib": { color: "#f87171", bg: "#200808" },
    "Status Code": { color: "#94a3b8", bg: "#0f1520" }
  };
  const SYS_DEFAULT = { color: "#64748b", bg: "#101820" };
  if (!l2State.expandedSysCategories) l2State.expandedSysCategories = /* @__PURE__ */ new Set();
  for (const [catName, fnMap] of sysMap.entries()) {
    const catSlug = _safeId(catName) + "-" + _hashId(catName);
    const groupId = `syscat-${catSlug}`;
    const style = SYS_CAT_STYLE[catName] || SYS_DEFAULT;
    const funcCount = fnMap.size;
    const isExpanded = l2State.expandedSysCategories.has(catName);
    const allCallers = /* @__PURE__ */ new Map();
    fnMap.forEach((callerSet) => callerSet.forEach((idx) => allCallers.set(idx, (allCallers.get(idx) || 0) + 1)));
    if (!isExpanded) {
      els.push({
        data: {
          id: groupId,
          label: `${catName}
${funcCount} funcs`,
          bg: isSimple ? style.color : style.bg,
          bc: style.color,
          w: isSimple ? SIMPLE_NODE_SIZE_MD : 170,
          h: isSimple ? SIMPLE_NODE_SIZE_MD : 52,
          sh: isSimple ? "ellipse" : "roundrectangle",
          lvl: 2,
          simple: isSimple ? 1 : 0,
          _t: "sys_group",
          syscat: catName,
          tt: `${catName}
${funcCount} funcs

Click to expand \u2195`
        }
      });
      allCallers.forEach((count, callerIdx) => {
        els.push({
          data: {
            id: `syse-${catSlug}-${callerIdx}`,
            source: `fn-${callerIdx}`,
            target: groupId,
            w: Math.min(3, 1 + count / 3),
            ec: style.color,
            es: "solid",
            el: "",
            l2kind: "call_sys",
            tt: `\u2192 ${catName} (${count} call${count !== 1 ? "s" : ""})`
          }
        });
      });
    } else {
      fnMap.forEach((callerSet, funcName) => {
        const fnId = `sysfn-${catSlug}-${_hashId(funcName)}`;
        els.push({
          data: {
            id: fnId,
            label: `${funcName}
(${catName})`,
            bg: isSimple ? style.color : style.bg,
            bc: style.color,
            w: isSimple ? SIMPLE_NODE_SIZE_SM : 160,
            h: isSimple ? SIMPLE_NODE_SIZE_SM : 42,
            sh: isSimple ? "ellipse" : "roundrectangle",
            lvl: 2,
            simple: isSimple ? 1 : 0,
            _t: "sys_func",
            fn: funcName,
            syscat: catName,
            tt: `${funcName}
Category: ${catName}

Known system API \u2014 no source in this codebase.`
          }
        });
        callerSet.forEach((callerIdx) => {
          els.push({
            data: {
              id: `sysfne-${catSlug}-${callerIdx}-${_hashId(funcName)}`,
              source: `fn-${callerIdx}`,
              target: fnId,
              w: 1.5,
              ec: style.color,
              es: "solid",
              el: "",
              l2kind: "call_sys",
              tt: `${funcs[callerIdx].label} \u2192 ${funcName}`
            }
          });
        });
      });
    }
  }
  l2State._animGen++;
  const _l2Token = ++_renderToken;
  setTimeout(() => {
    if (_renderToken !== _l2Token) return;
    cy.elements().stop(true, false);
    l2State._prevNodeIds = new Set(cy.nodes().map((n) => n.id()));
    cy.batch(() => {
      cy.json({ elements: [] });
      cy.add(els);
    });
    applyCyFont(getSavedFont());
    applyExternalEdgeVisibility();
    const l2LayoutId = _PREFS.get("layoutL2");
    const l2Preset = LAYOUT_PRESETS.find((p) => p.id === l2LayoutId);
    const canUseL2 = l2Preset && (!l2Preset.requires || _isLayoutAvailable(l2Preset.requires));
    const l2Config = canUseL2 ? { ...l2Preset.config(), animate: false } : { name: "dagre", rankDir: "LR", animate: false, nodeSep: 26, rankSep: 80, padding: 50 };
    _syncLayoutIndicator(canUseL2 ? l2LayoutId : "dagre-lr");
    refreshLayoutSwitcher();
    const _l2Key = `L2:${fileRel}|xf=${l2State.showExternalFuncs ? 1 : 0}|xe=${l2State.showExternalEdges ? 1 : 0}|exp=${Array.from(l2State.expandedModules || []).sort().join(",")}`;
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
        legacy: !hasCallList
      });
      updateExternalToggle();
      updateExternalFuncsToggle();
      focusL2Func(fileRel, l2State.activeFuncIdx || 0, { center: false, openCodePanel: false });
      if (typeof applyPendingGlobalNavRestore === "function" && applyPendingGlobalNavRestore("l2")) {
        l2State.preserveViewport = null;
        l2State.expandOriginPos = null;
        l2State._prevNodeIds = null;
        renderL2Legend();
        return;
      }
      const savedVP = l2State.preserveViewport;
      const originPos = l2State.expandOriginPos;
      const prevIds = l2State._prevNodeIds || /* @__PURE__ */ new Set();
      if (savedVP && originPos) {
        cy.viewport({ zoom: savedVP.zoom, pan: savedVP.pan });
        const newNodes = cy.nodes('[_t="ext_func"],[_t="sys_func"]').filter((n) => !prevIds.has(n.id()));
        if (newNodes.length > 0) {
          const finalPos = /* @__PURE__ */ new Map();
          newNodes.forEach((n) => finalPos.set(n.id(), { ...n.position() }));
          newNodes.forEach((n) => n.position({ x: originPos.x, y: originPos.y }));
          const myGen = l2State._animGen;
          let idx = 0;
          newNodes.forEach((n) => {
            const fp = finalPos.get(n.id());
            const nid = n.id();
            const delay = idx * 18;
            setTimeout(() => {
              if (l2State._animGen !== myGen) return;
              if (!cy.hasElementWithId(nid)) return;
              cy.$id(nid).animate({ position: fp }, { duration: 360, easing: "ease-out-cubic" });
            }, delay);
            idx++;
          });
        } else {
          cy.animate({ fit: { eles: cy.elements(), padding: 50 }, duration: 400 });
        }
      } else if (savedVP && !focusFuncName) {
        cy.viewport({ zoom: savedVP.zoom, pan: savedVP.pan });
      } else if (focusFuncName) {
        const targetNode = cy.$id(`fn-${l2State.activeFuncIdx}`);
        if (targetNode && targetNode.length) {
          highlightNode(targetNode);
          cy.stop();
          cy.zoom(Math.max(cy.zoom(), 1.8));
          cy.center(targetNode);
          let count = 0;
          const originalBc = targetNode.data("bc");
          const flashInterval = setInterval(() => {
            count++;
            if (!cy.hasElementWithId(targetNode.id())) {
              clearInterval(flashInterval);
              return;
            }
            targetNode.style("border-color", count % 2 === 1 ? _tC("#ffffff", "#8c7851") : originalBc);
            targetNode.style("border-width", count % 2 === 1 ? 4 : 2);
            if (count >= 6) {
              clearInterval(flashInterval);
              targetNode.style("border-color", originalBc);
              targetNode.style("border-width", 2);
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
function drillCurrentFileToL2() {
  const filePath = codeState.currentFile || cy?.nodes(":selected").first().data("_f")?.path || null;
  if (!filePath) {
    const seg = document.getElementById("level-switcher")?.querySelectorAll(".lsw-seg")[2];
    if (seg) {
      seg.style.color = "#f87171";
      setTimeout(() => {
        seg.style.color = "";
      }, 900);
    }
    return;
  }
  if (state.level === 2 && state.activeFile === filePath) return;
  if (state.level < 1) {
    for (const m of DATA.modules) {
      const files = DATA.files_by_module[m.id] || [];
      if (files.some((f) => f.path === filePath)) {
        drillToModule(m.id);
        break;
      }
    }
  }
  drillToFile(filePath);
  if (window._lswUpdate) window._lswUpdate({ active: 2, l1Available: true });
}
function drillDownExtFunc(node) {
  const d = node.data();
  const targetFile = d._f || null;
  const funcName = d.fn || null;
  if (!targetFile || !funcName) return;
  const nodeId = node.id();
  const groupId = `dgroup-${_hashId(nodeId)}`;
  if (d._drilled) {
    _collapseDrillGroup(node, groupId, funcName);
    return;
  }
  const funcs = DATA.funcs_by_file[targetFile] || [];
  const callList = DATA.func_calls_by_file?.[targetFile] || null;
  const nameToFile = DATA.func_name_to_file || {};
  const nameToFiles = DATA.func_name_to_files || {};
  const fileToModule = DATA.file_to_module || {};
  const fidIdx = funcs.findIndex((f) => f.label === funcName);
  if (fidIdx < 0 || !Array.isArray(callList)) {
    node.data("label", funcName + "\n(leaf)");
    return;
  }
  const callees = new Set(Array.isArray(callList[fidIdx]) ? callList[fidIdx] : []);
  if (callees.size === 0) {
    node.data("label", funcName + "\n(leaf)");
    return;
  }
  const groupColor = node.data("bc") || "#64748b";
  const fileLabel = targetFile.split("/").pop();
  const groupNode = {
    data: {
      id: groupId,
      label: fileLabel,
      _t: "drill_group",
      _srcNodeId: nodeId,
      bc: groupColor,
      bg: "#0b1929"
    }
  };
  const newEls = [groupNode];
  for (const callee of callees) {
    const childId = `drill-${_hashId(nodeId)}-${_hashId(callee)}`;
    if (cy.$id(childId).length) continue;
    let tf = null, modName = "", ec = "#64748b", bc = "#64748b";
    if (Object.prototype.hasOwnProperty.call(nameToFiles, callee)) {
      tf = nameToFiles[callee][0];
      modName = fileToModule[tf] || "";
      ec = bc = "#a78bfa";
    } else if (Object.prototype.hasOwnProperty.call(nameToFile, callee)) {
      tf = nameToFile[callee];
      modName = fileToModule[tf] || "";
      const dVal = _pathDist(targetFile, tf);
      ec = bc = _distColor(dVal);
    }
    newEls.push({
      data: {
        id: childId,
        label: callee,
        parent: groupId,
        // ← inside compound box
        bg: "#0d1f33",
        bc: bc || "#64748b",
        w: 160,
        h: 30,
        sh: "roundrectangle",
        lvl: 2,
        _t: "drilled_func",
        fn: callee,
        _f: tf,
        mod: modName,
        _drilled: false,
        tt: tf ? `${callee}
${tf}

Double-click to drill further` : `${callee}
(no file found)`
      }
    });
    newEls.push({
      data: {
        id: `drille-${_hashId(nodeId)}-${_hashId(callee)}`,
        source: nodeId,
        target: childId,
        w: EDGE_WIDTH.drillExternal,
        ec: ec || "#64748b",
        es: EDGE_STYLE_EXTERNAL,
        el: "",
        l2kind: "call_ext",
        tt: `${funcName} \u2192 ${callee}`
      }
    });
  }
  node.data("_drilled", true);
  node.data("label", funcName + " \u21B3");
  node.style("border-style", "double");
  cy.add(newEls);
  const vp = { pan: { ...cy.pan() }, zoom: cy.zoom() };
  cy.layout({
    name: "dagre",
    rankDir: "LR",
    animate: true,
    animationDuration: 300,
    nodeSep: 26,
    rankSep: 80,
    padding: 50
  }).one("layoutstop", () => {
    cy.viewport(vp);
  }).run();
}
function _collapseDrillGroup(srcNode, groupId, funcName) {
  const group = cy.$id(groupId);
  if (group && group.length) {
    group.children().remove();
    group.remove();
  }
  srcNode.data("_drilled", false);
  srcNode.data("label", funcName || srcNode.data("fn"));
  srcNode.style("border-style", "solid");
  const vp = { pan: { ...cy.pan() }, zoom: cy.zoom() };
  cy.layout({
    name: "dagre",
    rankDir: "LR",
    animate: true,
    animationDuration: 250,
    nodeSep: 26,
    rankSep: 80,
    padding: 50
  }).one("layoutstop", () => {
    cy.viewport(vp);
  }).run();
}
function renderL2Legend() {
  clearL2Legend();
  buildEdgeFilter();
  buildNodeLegend();
}
function clearL2Legend() {
  ["l2-legend", "graph-legend"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}
function drillToFile(fileRel) {
  if (typeof pushGlobalNavSnapshot === "function" && !isGlobalNavRestoring()) {
    pushGlobalNavSnapshot("drill-file");
  }
  if (state.level < 2 && cy) {
    const sel = cy.nodes(":selected").first();
    l2State._l1Snapshot = {
      pan: { ...cy.pan() },
      zoom: cy.zoom(),
      selectedNodeId: sel && sel.length ? sel.id() : null
    };
  }
  if (!isGlobalNavRestoring()) state.history.push({ level: 1, activeModule: state.activeModule });
  state.level = 2;
  state.activeFile = fileRel;
  clearSelection();
  updateBreadcrumb();
  setL1ToolbarVisible(false);
  if (window.updateFilterTabEnabled) updateFilterTabEnabled();
  const ftWrap = document.getElementById("ft-filter");
  if (ftWrap) ftWrap.style.display = "none";
  openL2File(fileRel, { newSession: true, pushHistory: true });
  updateCallGraphBtn(fileRel);
}
async function _syncCodePanel(fileRel, funcName, targetCallText = null, importSearch = null) {
  if (!fileRel) return;
  const fname = fileRel.split("/").pop();
  const ext = fname.includes(".") ? "." + fname.split(".").pop().toLowerCase() : "";
  if (codeState.userClosed && !codeState.isOpen) {
    codeState.currentFile = fileRel;
    codeState.currentFunc = funcName;
    setCodeBtnEnabled(true);
    if (state.level >= 2 && window.svUpdateStructureBtn) svUpdateStructureBtn(fileRel, ext);
    return;
  }
  openCodePanel();
  document.getElementById("cp-filename").textContent = fname;
  document.getElementById("cp-filename").title = fileRel;
  document.getElementById("cp-ext-badge").textContent = ext.toUpperCase() || "FILE";
  document.getElementById("cp-ext-badge").style.background = extColor(ext);
  document.getElementById("cp-ext-badge").style.color = "#000";
  hideFuncBar();
  if (!codeState.jobId) {
    showCpError("No job ID \u2014 code preview only available via the local server (launch.bat).");
    return;
  }
  if (fileRel === codeState.currentFile) {
    if (funcName) requestAnimationFrame(() => jumpToFunc(funcName, targetCallText));
    else if (importSearch) requestAnimationFrame(() => jumpToImport(importSearch));
    if (state.level >= 2 && window.svUpdateStructureBtn) svUpdateStructureBtn(fileRel, ext);
    return;
  }
  showCpLoading(true);
  try {
    const url = `/file?job=${encodeURIComponent(codeState.jobId)}&path=${encodeURIComponent(fileRel)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) {
      showCpError(T("fileLoadError", { error: data.error }));
      return;
    }
    codeState.currentFile = fileRel;
    renderFileContent(data, ext, fname);
    showCpLoading(false);
    if (funcName) requestAnimationFrame(() => jumpToFunc(funcName, targetCallText));
    else if (importSearch) requestAnimationFrame(() => jumpToImport(importSearch));
    if (state.level >= 2 && window.svUpdateStructureBtn) svUpdateStructureBtn(fileRel, ext);
  } catch (e) {
    showCpError(T("fetchError", { error: e.message }));
  }
}
function showFuncView(fileRel, funcs, edges, centerIdx) {
  hideTooltip();
  const center = funcs[centerIdx];
  const callers = dedupeBy(edges.filter((e) => e.t === centerIdx).map((e) => funcs[e.s]).filter(Boolean), "label").slice(0, 8);
  const callees = dedupeBy(edges.filter((e) => e.s === centerIdx).map((e) => funcs[e.t]).filter(Boolean), "label").slice(0, 8);
  cy.elements().remove();
  document.getElementById("cy").style.display = "none";
  const fv = document.getElementById("func-view");
  fv.classList.add("active");
  const accessCls = center.is_public ? "access-public" : "access-private";
  const accessTone = center.is_public ? "PUBLIC" : "PRIVATE";
  const fileName = fileRel.split("/").pop();
  fv.dataset.fileRel = fileRel;
  let pillHtml = "";
  funcs.slice(0, 24).forEach((f, i) => {
    const baseCls = f.is_public ? "pill-public" : "pill-private";
    const activeCls = i === centerIdx ? " pill-active" : "";
    pillHtml += `<span class="pill ${baseCls}${activeCls}" id="pill-${i}" data-func-idx="${i}">${f.label}</span>`;
  });
  fv.innerHTML = `
    <div class="fv-col">
      <div class="fv-col-label">\u25C0 Callers</div>
      ${callers.map((f) => fnCard(f, funcs.indexOf(f))).join("") || '<div class="fv-empty">No callers</div>'}
    </div>
    <div class="fv-center">
      <div class="fv-center-header">${fileName}</div>
      <div class="access-strip ${accessCls}">${accessTone}</div>
      <div class="fv-center-pills">${pillHtml}</div>
    </div>
    <div class="fv-col">
      <div class="fv-col-label">Callees \u25B6</div>
      ${callees.map((f) => fnCard(f, funcs.indexOf(f))).join("") || '<div class="fv-empty">No callees</div>'}
    </div>`;
  fv.dataset.fileRel = fileRel;
  _syncCodePanel(fileRel, center.label);
}
function fnCard(f, idx) {
  const cls = f.is_public ? "pill-public" : "pill-private";
  const lbl = f.is_public ? "PUBLIC" : "PRIVATE";
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
  }
}
document.addEventListener("click", (e) => {
  const fv = document.getElementById("func-view");
  if (!fv) return;
  const fileRel = fv.dataset.fileRel;
  if (!fileRel) return;
  const target = e.target.closest("[data-func-idx]");
  if (target && fv.contains(target)) {
    const idx = parseInt(target.dataset.funcIdx, 10);
    focusFunc(fileRel, idx);
  }
});
function showFuncViewEmpty(fileRel) {
  cy.elements().remove();
  document.getElementById("cy").style.display = "none";
  const fv = document.getElementById("func-view");
  fv.classList.add("active");
  fv.innerHTML = `<div style="text-align:center;color:var(--muted);padding:60px">
    <div style="font-size:48px;margin-bottom:16px">\u{1F4C4}</div>
    <div style="font-size:14px">${fileRel.split("/").pop()}</div>
    <div style="font-size:12px;margin-top:8px">No functions found</div>
  </div>`;
}
function hideFuncView() {
  clearSelection();
  clearFuncOverlay();
  setL2ToolbarVisible(false);
  clearL2Legend();
  document.getElementById("cy")?.classList.remove("l2-view");
  if (window.symViewClose) {
    const sv = document.getElementById("sym-view");
    if (sv && sv.classList.contains("active")) symViewClose();
  }
  l2State.activeFile = null;
  l2State.activeFuncIdx = 0;
  l2State.expandedModules = /* @__PURE__ */ new Set();
  l2State.externalModules = [];
  l2State._expandInitialized = false;
  updateCallGraphBtn(null);
  updateL2NavButtons();
  updateExternalToggle();
}
