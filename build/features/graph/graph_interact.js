function onNodeTap(node) {
  hideTooltip();
  clearHighlight();
  const d = node.data();
  if (state.level === 2) {
    if (d._t === "func") {
      pushGlobalNavSnapshot("l2-func");
      pinHighlightNode(node);
      focusL2Func(d._f, d.idx, { center: true });
      return;
    }
    if (d._t === "ext_group") {
      toggleExternalGroup(d.mod);
      return;
    }
    if (d._t === "sys_group") {
      toggleSysGroup(d.syscat);
      return;
    }
    if (d._t === "sys_func") {
      pushGlobalNavSnapshot("l2-sys-func");
      pinHighlightNode(node);
      const callerIdx = pickCallerIdxForExternal(node);
      if (callerIdx != null) l2State.activeFuncIdx = callerIdx;
      syncActiveL2FuncCode(d.fn);
      return;
    }
    if (d._t === "drill_group") {
      const srcNodeId = d._srcNodeId;
      const srcNode = srcNodeId ? cy.$id(srcNodeId) : null;
      const fn = srcNode?.data("fn") || "";
      _collapseDrillGroup(srcNode || node, node.id(), fn);
      return;
    }
    if (d._t === "ext_func") {
      pushGlobalNavSnapshot("l2-ext-func");
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
    if (d._t === "potential_func") {
      pushGlobalNavSnapshot("l2-potential-func");
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
  if (state.level === 0 && d._t === "module") {
    pinHighlightNode(node);
    pushGlobalNavSnapshot("l0-module");
    drillToModule(d._m.id);
    return;
  }
  if (state.level === 1 && d._t === "dep_ext_group") {
    toggleDepMapExtGroup(d.mod);
    return;
  }
  if (state.level === 1 && d._t === "dep_ext_file") {
    pushGlobalNavSnapshot("l1-ext-file");
    pinHighlightNode(node);
    if (d._f?.path) loadFileInPanel(d._f.path);
    return;
  }
  if (d._t === "file") {
    const now = performance.now();
    const sameNode = extClickLastId === node.id();
    const isDouble = sameNode && now - extClickLastTime < EXT_DOUBLE_CLICK_MS;
    extClickLastId = node.id();
    extClickLastTime = now;
    pushGlobalNavSnapshot(isDouble ? "l1-file-drill" : "l1-file");
    pinHighlightNode(node);
    if (isDouble) {
      if (d._f?.path) {
        const hasFuncs = window.DATA?.funcs_by_file?.[d._f.path]?.length > 0;
        if (hasFuncs) drillToFile(d._f.path);
      }
    } else {
      if (d._f?.path) {
        loadFileInPanel(d._f.path);
        updateCallGraphBtn(d._f.path);
        window.revealSidebarExplorerPath?.(d._f.path, "file");
      }
    }
    return;
  }
  pinHighlightNode(node);
}
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
    if (srcData._t === "func") {
      pushGlobalNavSnapshot("l2-edge");
      const fileRel = srcData._f;
      if (fileRel) _syncCodePanel(fileRel, srcData.fn, tgtData.fn);
    }
    return;
  }
  if (state.level === 1) {
    const srcNode = cy.$id(d.source);
    const tgtNode = cy.$id(d.target);
    const srcFile = srcNode.data("_f");
    const tgtLabel = tgtNode.data("label") || tgtNode.data("_f")?.label || "";
    if (srcFile?.path) {
      pushGlobalNavSnapshot("l1-edge");
      _lastTappedEdge = edge;
      updateCallGraphBtn(srcFile.path);
      if (d.line && typeof jumpToLine === "function") {
        loadFileInPanel(srcFile.path);
        setTimeout(() => jumpToLine(d.line), 150);
      } else {
        _syncCodePanel(srcFile.path, null, null, d.via || tgtLabel);
      }
    }
    return;
  }
}
window.cpSyncToGraph = function cpSyncToGraph(lineIdx, word) {
  if (!cy) return;
  if (state.level === 2 && l2State.activeFile) {
    const fileRel = l2State.activeFile;
    const funcs = DATA.funcs_by_file[fileRel] || [];
    if (!funcs.length) return;
    let callerIdx = -1;
    if (lineIdx >= 0 && codeState.funcList?.length) {
      const sorted = codeState.funcList.slice().sort((a, b) => a.line - b.line);
      let best = null;
      for (const entry of sorted) {
        if (entry.line <= lineIdx) best = entry;
        else break;
      }
      if (best) callerIdx = funcs.findIndex((f) => f.label === best.name);
    }
    if (callerIdx >= 0 && lineIdx >= 0 && codeState.rawLines?.[lineIdx] !== void 0) {
      const lineText = codeState.rawLines[lineIdx];
      const srcId = `fn-${callerIdx}`;
      const outEdges = cy.edges().filter((e) => e.data("source") === srcId);
      let bestEdge = null;
      outEdges.forEach((e) => {
        if (bestEdge) return;
        const tgt = cy.$id(e.data("target"));
        const tgtFn = e.data("tt")?.split("\u2192")[1]?.trim().split(" ")[0] || "";
        const tgtLabel = tgtFn || tgt.data("fn") || tgt.data("label") || "";
        if (!tgtLabel) return;
        const matches = word ? tgtLabel === word : new RegExp(`\\b${tgtLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lineText);
        if (matches) bestEdge = e;
      });
      if (bestEdge) {
        cy.elements().unselect();
        bestEdge.select();
        cy.animate({ center: { eles: bestEdge }, duration: 200 });
        return;
      }
    }
    let targetIdx = -1;
    if (word) targetIdx = funcs.findIndex((f) => f.label === word);
    if (targetIdx < 0) targetIdx = callerIdx;
    if (targetIdx < 0) return;
    if (l2State.activeFuncIdx === targetIdx) return;
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
  if (state.level === 1) {
    if (lineIdx >= 0 && codeState.currentFile) {
      let srcNode = null;
      cy.nodes().each((n) => {
        if (srcNode) return;
        const f = n.data("_f");
        if (f && f.path === codeState.currentFile) srcNode = n;
      });
      if (srcNode) {
        const exactLineEdges = cy.edges().filter((e) => {
          const d = e.data();
          return d.source === srcNode.id() && Number(d.line) === lineIdx + 1;
        });
        if (exactLineEdges.length) {
          cy.elements().unselect();
          exactLineEdges.select();
          _lastTappedEdge = exactLineEdges[0];
          cy.animate({ center: { eles: exactLineEdges }, duration: 200 });
          return;
        }
      }
    }
    if (!word && _lastTappedEdge && lineIdx >= 0 && codeState.rawLines?.[lineIdx] !== void 0) {
      const lineText = codeState.rawLines[lineIdx];
      const tgtNode = cy.$id(_lastTappedEdge.data("target"));
      const tgtLabel = tgtNode.data("label") || tgtNode.data("_f")?.label || "";
      const matchStr = tgtLabel.replace(/\.[^.]*$/, "").split("/").pop();
      if (tgtLabel && lineText.includes(matchStr)) {
        cy.elements().unselect();
        _lastTappedEdge.select();
        cy.animate({ center: { eles: _lastTappedEdge }, duration: 200 });
        const lineEl = document.getElementById(`cl-${lineIdx}`);
        if (lineEl) {
          document.querySelectorAll(".code-line.fn-highlight").forEach((el) => el.classList.remove("fn-highlight"));
          lineEl.classList.add("fn-highlight");
        }
        return;
      }
    }
    if (word) {
      const currentFile = codeState.currentFile;
      if (!currentFile) return;
      let srcNode = null, targetNode = null;
      cy.nodes().each((n) => {
        if (srcNode) return;
        const f = n.data("_f");
        if (f && f.path === currentFile) srcNode = n;
      });
      cy.nodes().each((n) => {
        if (targetNode) return;
        const f = n.data("_f");
        if (!f) return;
        const base = (f.path || "").replace(/\\/g, "/").split("/").pop().replace(/\.[^.]*$/, "");
        const lbl = (n.data("label") || "").toLowerCase();
        if (base.toLowerCase() === word.toLowerCase() || lbl === word.toLowerCase()) targetNode = n;
      });
      if (srcNode && targetNode) {
        const edgeCandidates = cy.edges().filter((e) => {
          const d = e.data();
          return d.source === srcNode.id() && d.target === targetNode.id() || d.source === targetNode.id() && d.target === srcNode.id();
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
function goBack() {
  goGlobalBack();
}
window.goLevel = function(n) {
  if (n === 0) {
    state.history = [];
    loadLevel0();
  } else if (n === 1 && state.activeModule) {
    hideFuncView();
    state.history = [{ level: 0 }];
    drillToModule(state.activeModule);
  }
};
window.switchTab = function(tab) {
  state.tab = tab;
  document.getElementById("tab-files").classList.toggle("active", tab === "files");
  document.getElementById("tab-calls").classList.toggle("active", tab === "calls");
  state.history = [];
  loadLevel0();
};
window.goBack = goBack;
function _clearGraphNavigationViewport() {
  if (typeof depMapState === "undefined") return;
  depMapState.preserveViewport = null;
  depMapState.expandOriginPos = null;
  depMapState.pendingFocusFile = null;
}
function updateBreadcrumb() {
  const container = document.getElementById("bc-items");
  container.innerHTML = "";
  function addSeg(label, clickFn, isCurrent, title) {
    if (container.children.length > 0) {
      const sep = document.createElement("span");
      sep.className = "bc-sep";
      sep.textContent = "\u203A";
      container.appendChild(sep);
    }
    const seg = document.createElement("span");
    seg.className = "bc-item" + (isCurrent ? " bc-current" : "");
    seg.textContent = label;
    seg.title = title || label || "";
    if (clickFn) seg.onclick = clickFn;
    container.appendChild(seg);
  }
  addSeg(T("sidebarModules"), () => {
    _clearGraphNavigationViewport();
    state.history = [];
    loadLevel0();
  }, state.level === 0, "Modules");
  if (state.level >= 1 && state.activeModule) {
    const isModActive = state.level === 1 && !state.activeSubDir;
    addSeg(
      state.activeModule,
      isModActive ? null : () => {
        if (state.level >= 2) {
          const h = [...state.history];
          _clearGraphNavigationViewport();
          drillToModule(state.activeModule);
          state.history = h;
        } else {
          _clearGraphNavigationViewport();
          drillToModule(state.activeModule);
        }
      },
      isModActive,
      state.activeModule
    );
  }
  if (state.level === 1 && state.activeSubDir) {
    const parts = state.activeSubDir.split("/");
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      const subPath = parts.slice(0, i + 1).join("/");
      const fullPath = (state.activeModule ? state.activeModule + "/" : "") + subPath;
      addSeg(
        part,
        isLast ? null : () => {
          filterGraphToSubPath(state.activeModule, subPath);
          setSubdirActive(state.activeModule, subPath);
        },
        isLast,
        fullPath
      );
    });
  }
  if (state.level >= 2 && state.level < 3 && state.activeFile) {
    const modId = state.activeModule || "";
    const full = state.activeFile;
    const prefix = modId ? modId + "/" : "";
    const rel = full.startsWith(prefix) ? full.slice(prefix.length) : full;
    const parts = rel.split("/");
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      const subPath = parts.slice(0, i + 1).join("/");
      const fullPath = (modId ? modId + "/" : "") + subPath;
      addSeg(
        part,
        isLast ? null : () => {
          pushGlobalNavSnapshot("breadcrumb-l2-subpath");
          state.level = 1;
          hideFuncView();
          if (window._sv && window._sv.active && window.svHideSvView) window.svHideSvView();
          if (window.svHideStructureBtn) svHideStructureBtn();
          setCodeBtnEnabled(false);
          filterGraphToSubPath(state.activeModule, subPath);
          setSubdirActive(state.activeModule, subPath);
        },
        isLast,
        fullPath
      );
    });
  }
  _updateBannerBreadcrumbs();
  if (typeof syncGlobalNavButtons === "function") syncGlobalNavButtons();
  if (window._lswUpdate) {
    const isL2 = state.level >= 2;
    const structActive = !!(window._sv && window._sv.active);
    window._lswUpdate({ active: structActive ? 3 : isL2 ? 2 : state.level === 1 ? 1 : 0 });
  }
}
function _updateBannerBreadcrumbs() {
  const containers = [
    document.getElementById("l1-breadcrumb-items"),
    document.getElementById("l2-breadcrumb-items"),
    document.getElementById("sv-breadcrumb")
  ].filter(Boolean);
  if (!containers.length) return;
  const structActive = !!(window._sv && window._sv.active);
  containers.forEach((container) => {
    container.innerHTML = "";
  });
  function addSeg(label, clickFn, isCurrent, title) {
    containers.forEach((container) => {
      if (container.children.length > 0) {
        const sep = document.createElement("span");
        sep.className = "bc-sep";
        sep.textContent = ">";
        container.appendChild(sep);
      }
      const seg = document.createElement("span");
      seg.className = "bc-item" + (isCurrent ? " bc-current" : "");
      seg.textContent = label;
      seg.title = title || label || "";
      if (clickFn) seg.addEventListener("click", clickFn);
      container.appendChild(seg);
    });
  }
  addSeg(T("sidebarModules"), () => {
    _clearGraphNavigationViewport();
    state.history = [];
    loadLevel0();
  }, state.level === 0, "Modules");
  if (state.level >= 1 && state.activeModule) {
    const isModActive = state.level === 1 && !state.activeSubDir;
    addSeg(
      state.activeModule,
      isModActive ? null : () => {
        if (state.level >= 2) {
          const h = [...state.history];
          _clearGraphNavigationViewport();
          drillToModule(state.activeModule);
          state.history = h;
        } else {
          _clearGraphNavigationViewport();
          drillToModule(state.activeModule);
        }
      },
      isModActive,
      state.activeModule
    );
  }
  if (state.level === 1 && state.activeSubDir) {
    const parts = state.activeSubDir.split("/");
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      const subPath = parts.slice(0, i + 1).join("/");
      const fullPath = (state.activeModule ? state.activeModule + "/" : "") + subPath;
      addSeg(
        part,
        isLast ? null : () => {
          filterGraphToSubPath(state.activeModule, subPath);
          setSubdirActive(state.activeModule, subPath);
        },
        isLast,
        fullPath
      );
    });
  }
  if (state.level >= 2 && state.level < 3 && state.activeFile) {
    const modId = state.activeModule || "";
    const full = state.activeFile;
    const prefix = modId ? modId + "/" : "";
    const rel = full.startsWith(prefix) ? full.slice(prefix.length) : full;
    const parts = rel.split("/");
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      const subPath = parts.slice(0, i + 1).join("/");
      const fullPath = (modId ? modId + "/" : "") + subPath;
      addSeg(
        part,
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
        fullPath
      );
    });
  }
}
function setSidebarActive(modId) {
  document.querySelectorAll(".mod-row").forEach((el) => el.classList.remove("active"));
  if (modId) {
    const el = document.getElementById(`mi-${modId}`);
    if (el) el.classList.add("active");
  }
}
window.hideGraphIsolateBtn = _graphHideIsolateBtn;
window.syncGraphIsolateBtn = _graphSyncIsolateBtn;
