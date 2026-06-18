function _syncLayoutIndicator(id) {
  layoutSwitcherState.currentId = id;
  document.querySelectorAll("#layout-switcher .ls-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.layoutId === id);
  });
}
const LAYOUT_PRESETS = [
  // ── Original presets (unchanged) ──────────────────────────────────────────
  {
    id: "dagre-lr",
    icon: "\u2192",
    label: "Hierarchy LR",
    tip: "Hierarchical Left \u2192 Right (DAG)",
    levels: [0, 1, 2],
    config: () => ({
      name: "dagre",
      rankDir: "LR",
      animate: true,
      animationDuration: 500,
      animationEasing: "ease-in-out-cubic",
      nodeSep: 28,
      rankSep: 90,
      padding: 45
    })
  },
  {
    id: "dagre-tb",
    icon: "\u2193",
    label: "Hierarchy TB",
    tip: "Hierarchical Top \u2192 Bottom (DAG)",
    levels: [0, 1, 2],
    config: () => ({
      name: "dagre",
      rankDir: "TB",
      animate: true,
      animationDuration: 500,
      animationEasing: "ease-in-out-cubic",
      nodeSep: 22,
      rankSep: 80,
      padding: 45
    })
  },
  {
    id: "cose",
    icon: "\u26A1",
    label: "Force",
    tip: "Force-Directed (CoSE) \u2014 physics simulation",
    levels: [0, 1, 2],
    config: () => ({
      name: "cose",
      animate: true,
      animationDuration: 650,
      animationEasing: "ease-in-out-cubic",
      randomize: false,
      nodeRepulsion: 9e3,
      idealEdgeLength: 160,
      nodeOverlap: 20,
      padding: 55,
      gravity: 0.25
    })
  },
  // ── Advanced presets ───────────────────────────────────────────────────────
  // ── Smart Cluster (fCoSE) ──────────────────────────────────────────────────
  // Best for: module-level graphs and hairball call graphs.
  // Beats plain CoSE: 2× faster, includes compound-node support, and supports
  // user-defined placement constraints (fixed position, alignment, relative placement).
  // Requires: cytoscape-fcose
  {
    id: "fcose",
    icon: "\u{1F9E9}",
    label: "Smart Cluster",
    tip: "fCoSE \u2014 fastest force-directed, compound-aware, best for modules & hairball graphs (requires fcose CDN)",
    levels: [0, 1, 2],
    requires: "fcose",
    config: () => {
      const nodeCount = cy ? cy.nodes().length : 50;
      const repulsion = Math.max(6e3, Math.min(18e3, nodeCount * 180));
      const edgeLen = Math.max(80, Math.min(220, nodeCount * 2.5));
      return {
        name: "fcose",
        animate: true,
        animationDuration: 700,
        animationEasing: "ease-in-out-cubic",
        randomize: false,
        packComponents: true,
        // Account for label sizes so nodes don't overlap their labels
        nodeDimensionsIncludeLabels: true,
        nodeRepulsion: () => repulsion,
        idealEdgeLength: () => edgeLen,
        edgeElasticity: () => 0.45,
        nestingFactor: 0.1,
        gravityRangeCompound: 1.5,
        gravityCompound: 1,
        gravity: 0.25,
        // Lower iter for big graphs; cache + background precompute fills in the quality gap
        numIter: nodeCount > 1e3 ? 1200 : nodeCount > 200 ? 2e3 : 2500,
        quality: nodeCount > 800 ? "draft" : nodeCount > 150 ? "default" : "proof",
        tile: true,
        tilingPaddingVertical: 12,
        tilingPaddingHorizontal: 12,
        padding: 55
      };
    }
  },
  // ── Smooth Physics (Cola / WebCola) ──────────────────────────────────────────
  // Best for: L1 dependency map and L2 call-flow when graph < ~200 nodes.
  // Unique advantage: constraint-based (can enforce LR flow direction while still
  // being physically simulated), smoothest animation of all force layouts,
  // and almost no jitter in interactive dragging.
  // Requires: webcola + cytoscape-cola
  {
    id: "cola",
    icon: "\u{1F9F2}",
    label: "Smooth Physics",
    tip: "Cola \u2014 constraint physics, smoothest animation, directed-flow aware, best for L1/L2 < 200 nodes (requires cola CDN)",
    levels: [1, 2],
    requires: "cola",
    config: () => {
      const nodeCount = cy ? cy.nodes().length : 50;
      return {
        name: "cola",
        animate: true,
        animationDuration: 500,
        animationEasing: "ease-in-out-cubic",
        refresh: 1,
        maxSimulationTime: Math.min(5e3, nodeCount * 20),
        // Directed left→right flow constraint — mirrors how code is read
        flow: { axis: "x", minSeparation: 90 },
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        nodeSpacing: () => 14,
        edgeLength: () => Math.max(100, Math.min(200, nodeCount * 2)),
        convergenceThreshold: 5e-3,
        padding: 50
      };
    }
  },
  // ELK Flow — ELK's "layered" algorithm for directed call-flow graphs.
  // Best for: L1 dependency map, L2 call-flow (anything with clear direction).
  // Solves: dagre's mediocre crossing-minimisation and loose node placement.
  // Advantages over dagre: orthogonal edge routing, BRANDES_KOEPF placement,
  //   post-compaction, and proper cycle-breaking for circular imports.
  // Requires: cytoscape-elk (loaded via CDN in <head>)
  {
    id: "elk-layered",
    icon: "\u26D3",
    label: "ELK Flow",
    tip: "ELK Layered \u2014 precise directed DAG with orthogonal edges, better than Dagre (requires elk CDN)",
    levels: [1, 2],
    // Call-flow graphs only; L0 module graph has no fixed direction
    requires: "elk",
    config: () => ({
      name: "elk",
      animate: true,
      animationDuration: 600,
      animationEasing: "ease-in-out-cubic",
      elk: {
        algorithm: "layered",
        // Direction: 'RIGHT' mirrors the mental model of reading code left→right.
        // Change to 'DOWN' if you prefer top-down (like a traditional call tree).
        "elk.direction": "RIGHT",
        // Inter-layer (column) and intra-layer (row) spacing
        "elk.layered.spacing.nodeNodeBetweenLayers": 90,
        "elk.spacing.nodeNode": 32,
        // ORTHOGONAL routing: edges become clean right-angle paths instead of
        // diagonal spaghetti. Makes the graph look far more professional.
        "elk.edgeRouting": "ORTHOGONAL",
        // LAYER_SWEEP crossing minimisation — the best general strategy for
        // reducing the number of edge crossings in a layered graph.
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        // BRANDES_KOEPF node placement: produces compact, well-aligned layers.
        // Much tighter than ELK's default LINEAR_SEGMENTS.
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        // Post-layout compaction: shorten edges as much as possible while
        // keeping the orthogonal shape, removing unnecessary whitespace.
        "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
        // GREEDY cycle-breaking: handles Python circular imports and similar
        // patterns by reversing a minimal set of back-edges.
        "elk.layered.cycleBreaking.strategy": "GREEDY",
        // Allow multiple edges between the same pair of nodes to be merged
        // visually, keeping the graph cleaner.
        "elk.mergeEdges": "true"
      }
    })
  },
  // ── ELK Stress ────────────────────────────────────────────────────────────
  // Best for: 300+ node graphs — prevents hairball AND avoids "too tall/wide".
  // Nodes placed so canvas distance ∝ hop distance (MDS/stress majorization).
  // Requires: cytoscape-elk
  {
    id: "elk-stress",
    icon: "\u{1F310}",
    label: "ELK Stress",
    tip: "ELK Stress \u2014 best for 300+ node graphs, distance-proportional placement, no hairball (requires elk CDN)",
    levels: [0, 1, 2],
    requires: "elk",
    config: () => {
      const nodeCount = cy ? cy.nodes().length : 100;
      const iterations = Math.max(200, Math.min(800, nodeCount * 2.5));
      return {
        name: "elk",
        animate: true,
        animationDuration: 750,
        animationEasing: "ease-in-out-cubic",
        elk: {
          algorithm: "stress",
          "elk.stress.desiredEdgeLength": 140,
          "elk.stress.epsilon": 1e-5,
          "elk.stress.iterationLimit": iterations,
          "elk.nodeSize.constraints": "MINIMUM_SIZE",
          "elk.spacing.nodeNode": 40,
          "elk.stress.fixedStartPosition": "false"
        }
      };
    }
  }
];
const layoutSwitcherState = {
  currentId: "dagre-lr",
  // default for L1/L2
  collapsed: false
};
function initLayoutSwitcher() {
  const wrap = document.getElementById("graph-wrap");
  if (!wrap) return;
  const panel = document.createElement("div");
  panel.id = "layout-switcher";
  panel.innerHTML = _buildLayoutSwitcherHTML();
  wrap.appendChild(panel);
  panel.querySelector(".ls-header").addEventListener("click", () => {
    layoutSwitcherState.collapsed = !layoutSwitcherState.collapsed;
    panel.classList.toggle("ls-collapsed", layoutSwitcherState.collapsed);
  });
  panel.querySelector(".ls-btns").addEventListener("click", (e) => {
    const btn = e.target.closest(".ls-btn");
    if (!btn) return;
    const id = btn.dataset.layoutId;
    if (id) applyLayoutPreset(id);
  });
}
function getActiveGraphCy() {
  const symPanel = document.getElementById("sym-view");
  if (symPanel?.classList.contains("active")) {
    return window._sv?.mode === "centric" && window._sv.cy ? window._sv.cy : null;
  }
  return cy;
}
function _symViewIsActive() {
  const p = document.getElementById("sym-view");
  return !!p && p.classList.contains("active");
}
function refreshGraphZoomControls() {
  const controls = document.getElementById("graph-zoom-controls");
  if (!controls) return;
  const zoomInBtn = document.getElementById("graph-zoom-in");
  const zoomOutBtn = document.getElementById("graph-zoom-out");
  if (typeof state !== "undefined" && state.galaxyActive) {
    if (typeof window.syncGraphIsolateBtn === "function") window.syncGraphIsolateBtn(false);
    controls.classList.remove("is-hidden");
    if (typeof window.isOverviewTreemapActive === "function" && window.isOverviewTreemapActive() && typeof window.overviewTreemapZoomState === "function") {
      const zoomState = window.overviewTreemapZoomState();
      const eps2 = 1e-4;
      if (zoomInBtn) zoomInBtn.disabled = zoomState.zoom >= zoomState.maxZoom - eps2;
      if (zoomOutBtn) zoomOutBtn.disabled = zoomState.zoom <= zoomState.minZoom + eps2;
    } else if (typeof window.isOverviewSankeyActive === "function" && window.isOverviewSankeyActive() && typeof window.overviewSankeyZoomState === "function") {
      const zoomState = window.overviewSankeyZoomState();
      const eps2 = 1e-4;
      if (zoomInBtn) zoomInBtn.disabled = zoomState.zoom >= zoomState.maxZoom - eps2;
      if (zoomOutBtn) zoomOutBtn.disabled = zoomState.zoom <= zoomState.minZoom + eps2;
    } else {
      if (zoomInBtn) zoomInBtn.disabled = false;
      if (zoomOutBtn) zoomOutBtn.disabled = false;
    }
    const focusBtn2 = document.getElementById("sv-focus-filter-btn");
    if (focusBtn2) focusBtn2.style.display = "none";
    return;
  }
  if (_symViewIsActive()) {
    if (typeof window.syncGraphIsolateBtn === "function") window.syncGraphIsolateBtn(false);
    controls.classList.remove("is-hidden");
    if (zoomInBtn) zoomInBtn.disabled = false;
    if (zoomOutBtn) zoomOutBtn.disabled = false;
    const focusBtn2 = document.getElementById("sv-focus-filter-btn");
    if (focusBtn2 && typeof window._svState !== "undefined") {
      const hasFocus = !!window._svState.focusId;
      focusBtn2.style.display = hasFocus ? "" : "none";
      focusBtn2.classList.toggle("isolate-active", !!window._svState.hideUnrelated);
    }
    return;
  }
  const targetCy = getActiveGraphCy();
  if (!targetCy) {
    if (typeof window.syncGraphIsolateBtn === "function") window.syncGraphIsolateBtn(false);
    controls.classList.add("is-hidden");
    if (zoomInBtn) zoomInBtn.disabled = true;
    if (zoomOutBtn) zoomOutBtn.disabled = true;
    const focusBtn2 = document.getElementById("sv-focus-filter-btn");
    if (focusBtn2) focusBtn2.style.display = "none";
    return;
  }
  const isMainGraph = targetCy === cy;
  if (typeof window.syncGraphIsolateBtn === "function") window.syncGraphIsolateBtn(isMainGraph);
  const minZoom = typeof targetCy.minZoom === "function" ? targetCy.minZoom() : GRAPH_ZOOM_SETTINGS.minZoom;
  const maxZoom = typeof targetCy.maxZoom === "function" ? targetCy.maxZoom() : GRAPH_ZOOM_SETTINGS.maxZoom;
  const curZoom = typeof targetCy.zoom === "function" ? targetCy.zoom() : GRAPH_ZOOM_SETTINGS.minZoom;
  const eps = 1e-4;
  controls.classList.remove("is-hidden");
  if (zoomInBtn) zoomInBtn.disabled = curZoom >= maxZoom - eps;
  if (zoomOutBtn) zoomOutBtn.disabled = curZoom <= minZoom + eps;
  const focusBtn = document.getElementById("sv-focus-filter-btn");
  if (focusBtn) focusBtn.style.display = "none";
}
function zoomActiveGraphByStep(direction) {
  if (typeof state !== "undefined" && state.galaxyActive) {
    if (typeof window.syncGraphIsolateBtn === "function") window.syncGraphIsolateBtn(false);
    if (typeof window.isOverviewTreemapActive === "function" && window.isOverviewTreemapActive() && typeof window.overviewTreemapZoomByStep === "function") {
      window.overviewTreemapZoomByStep(direction);
      return;
    }
    if (typeof window.zoomGalaxyByStep === "function") {
      window.zoomGalaxyByStep(direction);
    }
    return;
  }
  if (_symViewIsActive() && window._sv) {
    const z = window._sv.zoom;
    if (!z) return;
    const svg = document.getElementById("sv-svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy2 = rect.height / 2;
    const factor2 = direction > 0 ? 1.25 : 0.8;
    const nk = Math.max(0.1, Math.min(4, z.k * factor2));
    z.x = cx - (cx - z.x) * (nk / z.k);
    z.y = cy2 - (cy2 - z.y) * (nk / z.k);
    z.k = nk;
    if (typeof _svApplyZoom === "function") _svApplyZoom();
    return;
  }
  const targetCy = getActiveGraphCy();
  if (!targetCy) return;
  const factor = direction > 0 ? GRAPH_ZOOM_SETTINGS.buttonFactor : 1 / GRAPH_ZOOM_SETTINGS.buttonFactor;
  const oldZoom = targetCy.zoom();
  const minZoom = typeof targetCy.minZoom === "function" ? targetCy.minZoom() : GRAPH_ZOOM_SETTINGS.minZoom;
  const maxZoom = typeof targetCy.maxZoom === "function" ? targetCy.maxZoom() : GRAPH_ZOOM_SETTINGS.maxZoom;
  const nextZoom = Math.max(minZoom, Math.min(maxZoom, oldZoom * factor));
  if (Math.abs(nextZoom - oldZoom) < 1e-4) {
    refreshGraphZoomControls();
    return;
  }
  const container = targetCy.container();
  const center = {
    x: (container?.clientWidth || 0) / 2,
    y: (container?.clientHeight || 0) / 2
  };
  const pan = targetCy.pan();
  const modelCenter = {
    x: (center.x - pan.x) / oldZoom,
    y: (center.y - pan.y) / oldZoom
  };
  const nextPan = {
    x: center.x - modelCenter.x * nextZoom,
    y: center.y - modelCenter.y * nextZoom
  };
  targetCy.stop(true);
  targetCy.animate(
    { zoom: nextZoom, pan: nextPan },
    { duration: GRAPH_ZOOM_SETTINGS.animationMs, easing: "ease-out-cubic" }
  );
  refreshGraphZoomControls();
}
function initGraphZoomControls() {
  const wrap = document.getElementById("graph-wrap");
  if (!wrap || document.getElementById("graph-zoom-controls")) return;
  const controls = document.createElement("div");
  controls.id = "graph-zoom-controls";
  controls.className = "is-hidden";
  controls.innerHTML = `
        <button id="sv-focus-filter-btn" class="graph-zoom-btn" type="button" aria-label="Focus Only" title="Focus Only" style="display:none">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 5v.01M12 18.99v.01M5 12h.01M18.99 12h.01"></path>
          </svg>
        </button>
        <button id="graph-zoom-in" class="graph-zoom-btn" type="button" aria-label="Zoom in" data-tip="Zoom in">+</button>
        <button id="graph-zoom-out" class="graph-zoom-btn" type="button" aria-label="Zoom out" data-tip="Zoom out">\u2212</button>
        <button id="graph-fullscreen" class="graph-zoom-btn" type="button" aria-label="Fullscreen" data-tip="Fullscreen">&#x26F6;</button>
    `;
  wrap.appendChild(controls);
  controls.addEventListener("click", (e) => {
    const btn = e.target.closest(".graph-zoom-btn");
    if (!btn || btn.disabled) return;
    if (btn.id === "graph-fullscreen") {
      toggleGraphFullscreen();
      return;
    }
    if (btn.id === "sv-focus-filter-btn") {
      if (typeof _svToggleHideUnrelated === "function") _svToggleHideUnrelated();
      return;
    }
    zoomActiveGraphByStep(btn.id === "graph-zoom-in" ? 1 : -1);
  });
  refreshGraphZoomControls();
}
window.refreshGraphZoomControls = refreshGraphZoomControls;
function toggleGraphFullscreen() {
  const wrap = document.getElementById("graph-wrap");
  const btn = document.getElementById("graph-fullscreen");
  const isFs = wrap && wrap.classList.contains("graph-fullscreen");
  if (!isFs) {
    wrap.classList.add("graph-fullscreen");
    if (btn) {
      btn.innerHTML = "&#x2715;";
      btn.setAttribute("data-tip", "Exit fullscreen");
    }
  } else {
    wrap.classList.remove("graph-fullscreen");
    if (btn) {
      btn.innerHTML = "&#x26F6;";
      btn.setAttribute("data-tip", "Fullscreen");
    }
  }
  setTimeout(() => {
    if (window.cy && typeof window.cy.resize === "function") window.cy.resize();
    if (window._galaxySigma && typeof window._galaxySigma.refresh === "function") window._galaxySigma.refresh();
  }, 50);
}
function refreshLayoutSwitcher() {
  const panel = document.getElementById("layout-switcher");
  if (!panel) return;
  const collapsed = layoutSwitcherState.collapsed;
  panel.innerHTML = _buildLayoutSwitcherHTML();
  panel.classList.toggle("ls-collapsed", collapsed);
  panel.querySelector(".ls-header").addEventListener("click", () => {
    layoutSwitcherState.collapsed = !layoutSwitcherState.collapsed;
    panel.classList.toggle("ls-collapsed", layoutSwitcherState.collapsed);
  });
  panel.querySelector(".ls-btns").addEventListener("click", (e) => {
    const btn = e.target.closest(".ls-btn");
    if (!btn) return;
    const id = btn.dataset.layoutId;
    if (id) applyLayoutPreset(id);
  });
}
function _buildLayoutSwitcherHTML() {
  const visiblePresets = LAYOUT_PRESETS.filter((p) => !p.levels || p.levels.includes(state.level));
  return `
        <div class="ls-header">
            <span class="ls-header-icon">\u229E</span>
            <span class="ls-header-text">${T("layoutLabel")}</span>
            <span class="ls-chevron">\u25BE</span>
        </div>
        <div class="ls-btns">
            ${visiblePresets.map((p) => {
    const unavailable = p.requires && !_isLayoutAvailable(p.requires);
    const lName = _layoutLabel(p);
    const lTip = _layoutTip(p);
    return `
                <button class="ls-btn${p.id === layoutSwitcherState.currentId ? " active" : ""}${unavailable ? " ls-unavailable" : ""}"
                        data-layout-id="${p.id}"
                        data-tip="${lTip}${unavailable ? "\n\u26A0 CDN \u672A\u8F09\u5165" : ""}">
                    <span class="ls-icon">${p.icon}</span>
                    <span class="ls-name">${lName}</span>
                    ${unavailable ? '<span class="ls-warn">!</span>' : ""}
                </button>`;
  }).join("")}
        </div>
    `;
}
function _setLayoutBadge(label) {
  let badge = document.getElementById("layout-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "layout-badge";
    const wrap = document.getElementById("graph-wrap");
    if (wrap) wrap.appendChild(badge);
  }
  if (!badge) return;
  badge.textContent = label ? `\u2699 ${label}\u2026` : "";
  badge.style.display = label ? "" : "none";
}
function applyLayoutPreset(id) {
  const preset = LAYOUT_PRESETS.find((p) => p.id === id);
  if (!preset || !cy) return;
  if (preset.requires && !_isLayoutAvailable(preset.requires)) {
    showToast(`\u26A0 Layout "${preset.label}" requires cytoscape-${preset.requires} \u2014 CDN script may not have loaded`, "error");
    console.warn(`[layout] "${preset.requires}" extension not registered. Add the CDN script to analyze_viz.py <head>.`);
    return;
  }
  layoutSwitcherState.currentId = id;
  if (state.level === 0) _PREFS.set("layoutL0", id);
  else if (state.level === 1) _PREFS.set("layoutL1", id);
  else if (state.level === 2) _PREFS.set("layoutL2", id);
  const curKey = _currentViewKey();
  if (curKey) _layoutCacheInvalidate(curKey);
  document.querySelectorAll("#layout-switcher .ls-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.layoutId === id);
  });
  const config = preset.config();
  const lay = cy.layout(config);
  _setLayoutBadge(preset.label);
  lay.one("layoutstop", () => {
    _setLayoutBadge(null);
    if (curKey) {
      const positions = /* @__PURE__ */ new Map();
      cy.nodes().forEach((n) => {
        const p = n.position();
        positions.set(n.id(), { x: p.x, y: p.y });
      });
      _layoutCacheSet(curKey, positions);
    }
    cy.animate({ fit: { eles: cy.elements(), padding: 40 }, duration: 400, easing: "ease-in-out-cubic" });
  });
  lay.run();
  showToast(T("layoutApplied", { label: _layoutLabel(preset) }), "info");
}
function _currentViewKey() {
  if (state.level === 0) return _layoutCacheKey(0);
  if (state.level === 1) return _layoutCacheKey(1, state.activeModule, state.activeSubDir);
  if (state.level === 2) return _layoutCacheKey(2, null, null, l2State.activeFile || state.activeFile);
  return null;
}
const _PERF_LITE_EDGE_THRESHOLD = 600;
function _applyAdaptivePerfMode() {
  if (typeof cy === "undefined" || !cy) return;
  const edges = cy.edges();
  const lite = edges.length >= _PERF_LITE_EDGE_THRESHOLD;
  const tagged = edges.filter(".perf-lite").length;
  if (lite && tagged !== edges.length) {
    cy.batch(() => edges.addClass("perf-lite"));
  } else if (!lite && tagged) {
    cy.batch(() => edges.removeClass("perf-lite"));
  }
}
function applyLayoutWithCache(viewKey, config, onStop) {
  _applyAdaptivePerfMode();
  const cached = viewKey ? _layoutCacheGet(viewKey) : null;
  if (cached && cached.positions && cached.positions.size) {
    console.log(`[layout] cache hit: ${viewKey}`);
    const lay2 = cy.layout({
      name: "preset",
      positions: (n) => cached.positions.get(n.id()) || { x: 0, y: 0 },
      animate: false,
      fit: false
    });
    lay2.one("layoutstop", () => {
      cy.animate({ fit: { eles: cy.elements(), padding: 40 }, duration: 350, easing: "ease-in-out-cubic" });
      onStop && onStop(true);
    });
    lay2.run();
    return;
  }
  const lay = cy.layout(config);
  lay.one("layoutstop", () => {
    if (viewKey) {
      const positions = /* @__PURE__ */ new Map();
      cy.nodes().forEach((n) => {
        const p = n.position();
        positions.set(n.id(), { x: p.x, y: p.y });
      });
      _layoutCacheSet(viewKey, positions);
    }
    onStop && onStop(false);
  });
  lay.run();
}
window.applyLayoutWithCache = applyLayoutWithCache;
window._currentViewKey = _currentViewKey;
