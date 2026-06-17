function initSidebarTabs() {
  const collapseBtn = document.getElementById("sb-collapse-btn");
  document.querySelectorAll(".sb-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (_sbCollapsed) {
        _sbCollapsed = false;
        _applySidebarCollapsed();
      }
      _sbActiveTab = tab.dataset.tab;
      _applySidebarTab();
    });
  });
  if (collapseBtn) {
    collapseBtn.addEventListener("click", () => {
      _sbCollapsed = !_sbCollapsed;
      _applySidebarCollapsed();
    });
  }
}
const _RAIL_TRANSITION_MS = 220;
function initIconRail() {
  const toggleBtn = document.getElementById("rail-toggle-btn");
  if (!toggleBtn) return;
  const applyRailState = (expanded) => {
    document.body.classList.toggle("rail-expanded", expanded);
    toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    const labelKey = expanded ? "railCollapse" : "railExpand";
    const label = typeof T === "function" ? T(labelKey) : expanded ? "Collapse rail" : "Expand rail";
    toggleBtn.setAttribute("data-i18n", labelKey);
    toggleBtn.setAttribute("data-tip", label);
    toggleBtn.title = label;
  };
  applyRailState(false);
  toggleBtn.addEventListener("click", () => {
    const expanded = !document.body.classList.contains("rail-expanded");
    applyRailState(expanded);
    _startPanelResizeLoop(_RAIL_TRANSITION_MS);
  });
}
function _applySidebarTab() {
  if (_sbActiveTab === "filters" && typeof window.isOverviewTreemapActive === "function" && window.isOverviewTreemapActive()) {
    _sbActiveTab = "explorer";
  }
  document.querySelectorAll(".sb-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === _sbActiveTab));
  const expl = document.getElementById("sb-body-explorer");
  const filt = document.getElementById("sb-body-filters");
  if (expl) expl.style.display = _sbActiveTab === "explorer" ? "" : "none";
  if (filt) filt.style.display = _sbActiveTab === "filters" ? "" : "none";
  _syncRailPanelButtons();
}
function _syncRailPanelButtons() {
  const explorerBtn = document.getElementById("rail-explorer-btn");
  const filterBtn = document.getElementById("rail-filter-btn");
  const panelOpen = !_sbCollapsed;
  if (explorerBtn) {
    const active = panelOpen && _sbActiveTab === "explorer";
    explorerBtn.classList.toggle("active", active);
    explorerBtn.setAttribute("aria-pressed", active ? "true" : "false");
  }
  if (filterBtn) {
    const active = panelOpen && _sbActiveTab === "filters";
    filterBtn.classList.toggle("active", active);
    filterBtn.setAttribute("aria-pressed", active ? "true" : "false");
  }
}
function updateFilterTabEnabled() {
  const filterTab = document.querySelector('.sb-tab[data-tab="filters"]');
  const railFilterBtn = document.getElementById("rail-filter-btn");
  if (!filterTab) return;
  const isL0 = typeof state !== "undefined" && state.level === 0;
  const isGalaxy = typeof state !== "undefined" && !!state.galaxyActive;
  const isTreemap = typeof window.isOverviewTreemapActive === "function" && window.isOverviewTreemapActive();
  const shouldHide = isL0 && !isGalaxy || isTreemap;
  filterTab.style.display = shouldHide ? "none" : "";
  filterTab.disabled = shouldHide;
  if (railFilterBtn) railFilterBtn.style.display = shouldHide ? "none" : "";
  if (shouldHide && _sbActiveTab === "filters") {
    _sbActiveTab = "explorer";
    _applySidebarTab();
  }
}
const _SB_ICON_CLOSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>';
const _SB_ICON_OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15 3-3-3-3"/></svg>';
function _applySidebarCollapsed() {
  const sidebar = document.getElementById("sidebar");
  const collapseBtn = document.getElementById("sb-collapse-btn");
  const resizer = document.getElementById("sidebar-resizer");
  if (!sidebar) return;
  if (_sbCollapsed) {
    sidebar._expandedWidth = sidebar.offsetWidth;
    sidebar.classList.add("sb-collapsed");
    document.documentElement.style.setProperty("--sidebar", "40px");
    if (collapseBtn) {
      collapseBtn.innerHTML = _SB_ICON_OPEN;
      collapseBtn.title = "Expand sidebar";
    }
    if (resizer) resizer.style.pointerEvents = "none";
  } else {
    sidebar.classList.remove("sb-collapsed");
    const w = sidebar._expandedWidth || 220;
    document.documentElement.style.setProperty("--sidebar", w + "px");
    if (collapseBtn) {
      collapseBtn.innerHTML = _SB_ICON_CLOSE;
      collapseBtn.title = "Collapse sidebar";
    }
    if (resizer) resizer.style.pointerEvents = "";
    _applySidebarTab();
  }
  _syncRailPanelButtons();
  if (cy) cy.resize();
}
let _panelRafId = null;
function _startPanelResizeLoop(durationMs) {
  if (_panelRafId) cancelAnimationFrame(_panelRafId);
  const end = performance.now() + durationMs + 32;
  function tick() {
    if (typeof cy !== "undefined" && cy) cy.resize();
    if (window._galaxySigma && typeof window._galaxySigma.refresh === "function") window._galaxySigma.refresh();
    if (performance.now() < end) _panelRafId = requestAnimationFrame(tick);
    else _panelRafId = null;
  }
  _panelRafId = requestAnimationFrame(tick);
}
const _PANEL_TRANSITION_MS = 200;
const FT_GROUPS = [
  // ── BIOS / C ──────────────────────────────────────────────────────────────
  { key: "c_source", label: ".c/.cpp", exts: [".c", ".cpp", ".cc"], group: "bios" },
  { key: "header", label: ".h/.hpp", exts: [".h", ".hpp"], group: "bios" },
  { key: "assembly", label: ".asm/.s", exts: [".asm", ".s", ".S", ".nasm"], group: "bios" },
  { key: "module_inf", label: ".inf", exts: [".inf"], group: "bios" },
  { key: "package_dec", label: ".dec", exts: [".dec"], group: "bios" },
  { key: "platform_dsc", label: ".dsc", exts: [".dsc"], group: "bios" },
  { key: "flash_desc", label: ".fdf", exts: [".fdf"], group: "bios" },
  { key: "common_file", label: "Common", exts: [".sdl", ".sd", ".cif", ".hfr", ".mak"], group: "bios" },
  { key: "hii_vfr", label: ".vfr", exts: [".vfr"], group: "bios" },
  { key: "hii_string", label: ".uni", exts: [".uni"], group: "bios" },
  { key: "acpi_asl", label: ".asl", exts: [".asl"], group: "bios" },
  // ── Python ────────────────────────────────────────────────────────────────
  { key: "py_source", label: ".py", exts: [".py"], group: "python" },
  // ── JavaScript / TypeScript ───────────────────────────────────────────────
  { key: "js_source", label: ".js/.mjs", exts: [".js", ".mjs", ".cjs"], group: "js" },
  { key: "jsx_source", label: ".jsx", exts: [".jsx"], group: "js" },
  { key: "ts_source", label: ".ts", exts: [".ts"], group: "ts" },
  { key: "tsx_source", label: ".tsx", exts: [".tsx"], group: "ts" },
  // ── Go ────────────────────────────────────────────────────────────────────
  { key: "go_source", label: ".go", exts: [".go"], group: "go" },
  // ── JVM / Mobile ──────────────────────────────────────────────────────────
  { key: "java_source", label: ".java", exts: [".java"], group: "jvm" },
  { key: "kotlin_source", label: ".kt", exts: [".kt", ".kts"], group: "jvm" },
  { key: "scala_source", label: ".scala", exts: [".scala"], group: "jvm" },
  { key: "groovy_source", label: ".groovy", exts: [".groovy"], group: "jvm" },
  { key: "dart_source", label: ".dart", exts: [".dart"], group: "mobile" },
  { key: "swift_source", label: ".swift", exts: [".swift"], group: "mobile" },
  { key: "objc_source", label: ".m/.mm", exts: [".m", ".mm"], group: "mobile" },
  // ── .NET ──────────────────────────────────────────────────────────────────
  { key: "csharp_source", label: ".cs", exts: [".cs"], group: "dotnet" },
  { key: "vb_source", label: ".vb", exts: [".vb"], group: "dotnet" },
  { key: "fsharp_source", label: ".fs", exts: [".fs", ".fsx"], group: "dotnet" },
  // ── Scripting ─────────────────────────────────────────────────────────────
  { key: "ruby_source", label: ".rb", exts: [".rb"], group: "script" },
  { key: "php_source", label: ".php", exts: [".php"], group: "script" },
  { key: "perl_source", label: ".pl/.pm", exts: [".pl", ".pm"], group: "script" },
  { key: "lua_source", label: ".lua", exts: [".lua"], group: "script" },
  { key: "shell_source", label: ".sh/.bash", exts: [".sh", ".bash", ".zsh"], group: "script" },
  { key: "powershell_source", label: ".ps1", exts: [".ps1", ".psm1", ".psd1"], group: "script" },
  { key: "r_source", label: ".r/.R", exts: [".r", ".R"], group: "script" },
  { key: "julia_source", label: ".jl", exts: [".jl"], group: "script" },
  // ── Systems ───────────────────────────────────────────────────────────────
  { key: "rust_source", label: ".rs", exts: [".rs"], group: "systems" },
  { key: "zig_source", label: ".zig", exts: [".zig"], group: "systems" },
  { key: "d_source", label: ".d", exts: [".d"], group: "systems" },
  { key: "nim_source", label: ".nim", exts: [".nim"], group: "systems" },
  { key: "crystal_source", label: ".cr", exts: [".cr"], group: "systems" },
  // ── Functional ────────────────────────────────────────────────────────────
  { key: "elixir_source", label: ".ex/.exs", exts: [".ex", ".exs"], group: "functional" },
  { key: "erlang_source", label: ".erl/.hrl", exts: [".erl", ".hrl"], group: "functional" },
  { key: "clojure_source", label: ".clj/.cljs", exts: [".clj", ".cljs"], group: "functional" },
  { key: "haskell_source", label: ".hs", exts: [".hs"], group: "functional" },
  { key: "ocaml_source", label: ".ml/.mli", exts: [".ml", ".mli"], group: "functional" },
  { key: "elm_source", label: ".elm", exts: [".elm"], group: "functional" },
  // ── Data / Schema ─────────────────────────────────────────────────────────
  { key: "sql_source", label: ".sql", exts: [".sql"], group: "data" },
  { key: "graphql_source", label: ".graphql", exts: [".graphql", ".gql"], group: "data" },
  { key: "proto_source", label: ".proto", exts: [".proto"], group: "data" },
  // ── Web / Styles ──────────────────────────────────────────────────────────
  { key: "css_source", label: ".css", exts: [".css"], group: "web" },
  { key: "scss_source", label: ".scss/.sass", exts: [".scss", ".sass"], group: "web" },
  { key: "less_source", label: ".less", exts: [".less"], group: "web" },
  { key: "stylus_source", label: ".styl", exts: [".styl"], group: "web" },
  { key: "html_source", label: ".html", exts: [".html", ".htm", ".xhtml"], group: "web" },
  // ── Config / Data ────────────────────────────────────────────────────────
  { key: "json_config", label: ".json", exts: [".json"], group: "config" },
  { key: "yaml_source", label: ".yaml/.yml", exts: [".yaml", ".yml"], group: "config" },
  { key: "toml_source", label: ".toml", exts: [".toml"], group: "config" },
  // ── Unanalysed ────────────────────────────────────────────────────────────
  { key: "other", label: "Other", exts: [], isExtra: true },
  { key: "binary", label: "Binary", exts: [], isExtra: true }
];
const ftActiveFilter = new Set(
  FT_GROUPS.filter((g) => !g.isExtra).map((g) => g.key)
);
let ftFilterCollapsed = false;
let efFilterCollapsed = false;
let nlFilterCollapsed = false;
let _sbCollapsed = false;
let _sbActiveTab = "explorer";
const edgeActiveFilter = new Set(Object.keys(EDGE_TYPE_STYLE));
const L2_NODE_FILTER_DEFS = [
  { key: "func", label: "Current File", color: "#60a5fa", types: ["func"] },
  { key: "external", label: "External", color: "#64748b", types: ["ext_group", "ext_func", "drill_group", "drilled_func"] },
  { key: "ambiguous", label: "Ambiguous", color: "#a78bfa", types: ["potential_func"] },
  { key: "system", label: "System API", color: "#34d399", types: ["sys_group", "sys_func"] }
];
const L2_EDGE_FILTER_DEFS = [
  { key: "call_internal", label: "Internal Calls", color: "#38bdf8", style: "solid" },
  { key: "call_ext", label: "External Calls", color: "#94a3b8", style: "dashed" },
  { key: "call_potential", label: "Ambiguous", color: "#a78bfa", style: "dashed" },
  { key: "call_sys", label: "System API", color: "#34d399", style: "solid" }
];
const l2NodeFilter = new Set(L2_NODE_FILTER_DEFS.map((d) => d.key));
const l2EdgeFilter = new Set(L2_EDGE_FILTER_DEFS.map((d) => d.key));
let l2NodeFilterCollapsed = false;
let l2EdgeFilterCollapsed = false;
let svEdgeFilterCollapsed = false;
let svKindFilterCollapsed = false;
function resetL2Filters() {
  l2NodeFilter.clear();
  L2_NODE_FILTER_DEFS.forEach((d) => l2NodeFilter.add(d.key));
  l2EdgeFilter.clear();
  L2_EDGE_FILTER_DEFS.forEach((d) => l2EdgeFilter.add(d.key));
}
function _filterSectionHdr(label, collapsed, actions = "") {
  const rot = collapsed ? "rotate(-90deg)" : "";
  return `<div class="flt-section-hdr" style="cursor:pointer"><span class="flt-chevron" style="transform:${rot}">\u25BE</span><span class="flt-section-label">${label}</span>` + (actions ? `<span class="flt-actions">${actions}</span>` : "") + `</div>`;
}
function buildFtFilter(modId = null, subDir = null) {
  const wrap = document.getElementById("ft-filter");
  if (!wrap) return;
  if (window._sv && window._sv.active) {
    buildSvKindFilter(wrap);
    return;
  }
  if (state.level !== 1 || !modId) {
    wrap.innerHTML = '<div class="ft-filter-placeholder">Navigate to a module to filter file types.</div>';
    wrap.style.display = "block";
    return;
  }
  const presentTypes = /* @__PURE__ */ new Set();
  let otherTotal = 0;
  let binaryTotal = 0;
  function addFiles(files) {
    files.forEach((f) => presentTypes.add(f.file_type || "other"));
  }
  if (modId) {
    let files = DATA.files_by_module[modId] || [];
    let others = (DATA.other_files_by_module || {})[modId] || [];
    if (subDir) {
      const prefix = modId + "/" + subDir + "/";
      const exc = modId + "/" + subDir;
      files = files.filter((f) => f.path.startsWith(prefix) || f.path === exc);
      others = others.filter((f) => f.path.startsWith(prefix) || f.path === exc);
    }
    addFiles(files);
    addFiles(others);
    others.forEach((f) => {
      if (f.file_type === "other") otherTotal++;
      if (f.file_type === "binary") binaryTotal++;
    });
  } else {
    Object.values(DATA.files_by_module).forEach(addFiles);
    const otherByMod = DATA.other_files_by_module || {};
    Object.values(otherByMod).forEach(addFiles);
    otherTotal = (DATA.stats?.other_files || 0) - (DATA.stats?.binary_files || 0);
    binaryTotal = DATA.stats?.binary_files || 0;
  }
  const groups = FT_GROUPS.filter((g) => {
    if (g.isExtra) {
      if (g.key === "other") return otherTotal > 0;
      if (g.key === "binary") return binaryTotal > 0;
    }
    return presentTypes.has(g.key);
  });
  if (!groups.length) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "block";
  const analysed = groups.filter((g) => !g.isExtra);
  const extra = groups.filter((g) => g.isExtra);
  function chipHtml(g) {
    const col = g.isExtra ? "#4b5563" : extColor(g.exts[0] || "");
    const checked = ftActiveFilter.has(g.key) ? "checked" : "";
    const count = g.key === "other" ? otherTotal : g.key === "binary" ? binaryTotal : "";
    const countBadge = count !== "" ? `<span class="ft-count">${count}</span>` : "";
    return `<label class="ft-chip${g.isExtra ? " ft-chip-extra" : ""}" style="--ft-col:${col}">
  <input type="checkbox" data-ft="${g.key}" ${checked}>
  <div class="ft-icon-bg"><span class="ft-dot" style="background:${col}"></span></div>
  <span class="ft-label">${g.label}</span>${countBadge}
</label>`;
  }
  const bodyDisplay = ftFilterCollapsed ? "none" : "flex";
  const actionsHtml = `<button class="flt-action is-add" data-ft-action="all" title="${T("selectAll")}">+</button><button class="flt-action is-rm" data-ft-action="none" title="${T("selectNone")}">\u2212</button>`;
  wrap.innerHTML = _filterSectionHdr(T("fileTypes"), ftFilterCollapsed, actionsHtml) + `<div id="ft-filter-body" style="display:${bodyDisplay}; flex-direction:column; padding:4px 0 2px;">` + analysed.map(chipHtml).join("") + (extra.length ? `<div class="ft-separator">\u2014 unanalysed \u2014</div>` + extra.map(chipHtml).join("") : "") + `</div>`;
  const titleEl = wrap.querySelector(".flt-section-hdr");
  const rerender = () => {
    if (state.level === 1 && state.activeModule) {
      const allFiles = DATA.files_by_module[state.activeModule] || [];
      const filtered = state.activeSubDir ? allFiles.filter((f) => f.path.startsWith(state.activeModule + "/" + state.activeSubDir + "/")) : allFiles;
      renderFilesFlat(state.activeModule, filtered, state.activeSubDir);
    }
    applyFtFilterToExplorer();
    updateSidebarStats();
  };
  titleEl.addEventListener("click", () => {
    ftFilterCollapsed = !ftFilterCollapsed;
    const body = document.getElementById("ft-filter-body");
    const chev = titleEl.querySelector(".flt-chevron");
    body.style.display = ftFilterCollapsed ? "none" : "flex";
    chev.style.transform = ftFilterCollapsed ? "rotate(-90deg)" : "";
  });
  wrap.querySelectorAll(".flt-action").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.ftAction;
      if (action === "all") {
        ftActiveFilter.clear();
        groups.forEach((g) => ftActiveFilter.add(g.key));
        wrap.querySelectorAll("input[type=checkbox]").forEach((cb) => {
          cb.checked = true;
        });
      } else if (action === "none") {
        ftActiveFilter.clear();
        wrap.querySelectorAll("input[type=checkbox]").forEach((cb) => {
          cb.checked = false;
        });
      }
      rerender();
    });
  });
  wrap.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) ftActiveFilter.add(cb.dataset.ft);
      else ftActiveFilter.delete(cb.dataset.ft);
      rerender();
    });
  });
}
function applyFtFilterToExplorer() {
  document.querySelectorAll("#module-list .file-row").forEach((row) => {
    row.style.display = "";
  });
  requestAnimationFrame(_updateAllGuideHeights);
}
function buildEdgeFilter() {
  const wrap = document.getElementById("edge-filter");
  if (!wrap) return;
  if (window._sv && window._sv.active) {
    buildSvEdgeFilter(wrap);
    return;
  }
  if (state.level === 2) {
    const presentKinds = /* @__PURE__ */ new Set();
    if (cy) cy.edges().forEach((e) => {
      const k = e.data("l2kind");
      if (k) presentKinds.add(k);
    });
    const visible = L2_EDGE_FILTER_DEFS.filter((d) => presentKinds.has(d.key));
    if (!visible.length) {
      wrap.innerHTML = "";
      return;
    }
    const actionsHtml2 = `<button class="flt-action is-add" data-l2e-action="all" title="${typeof T === "function" ? T("selectAll") : "All"}">+</button><button class="flt-action is-rm" data-l2e-action="none" title="${typeof T === "function" ? T("selectNone") : "None"}">\u2212</button>`;
    const bodyDisplay2 = l2EdgeFilterCollapsed ? "none" : "block";
    let rowsHtml2 = "";
    visible.forEach((d) => {
      const isActive = l2EdgeFilter.has(d.key);
      rowsHtml2 += `<div class="ef-row${isActive ? " active" : ""}" data-l2e="${d.key}" style="--ef-col:${d.color}"><div class="ef-icon-bg"><span class="ef-indicator">` + _edgeLine(d.color, d.style) + `</span></div><span class="ef-label">${d.label}</span></div>`;
    });
    wrap.innerHTML = _filterSectionHdr("Edge Types", l2EdgeFilterCollapsed, actionsHtml2) + `<div class="l2e-filter-body" style="display:${bodyDisplay2}; padding:4px 0 2px;">` + rowsHtml2 + `</div>`;
    wrap.querySelector(".flt-section-hdr").addEventListener("click", () => {
      l2EdgeFilterCollapsed = !l2EdgeFilterCollapsed;
      wrap.querySelector(".l2e-filter-body").style.display = l2EdgeFilterCollapsed ? "none" : "block";
      wrap.querySelector(".flt-chevron").style.transform = l2EdgeFilterCollapsed ? "rotate(-90deg)" : "";
    });
    wrap.querySelectorAll("[data-l2e]").forEach((row) => {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const k = row.dataset.l2e;
        if (l2EdgeFilter.has(k)) l2EdgeFilter.delete(k);
        else l2EdgeFilter.add(k);
        row.classList.toggle("active", l2EdgeFilter.has(k));
        applyL2Filter();
      });
    });
    wrap.querySelectorAll("[data-l2e-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.dataset.l2eAction === "all") {
          visible.forEach((d) => l2EdgeFilter.add(d.key));
          wrap.querySelectorAll("[data-l2e]").forEach((r) => r.classList.add("active"));
        } else {
          l2EdgeFilter.clear();
          wrap.querySelectorAll("[data-l2e]").forEach((r) => r.classList.remove("active"));
        }
        applyL2Filter();
      });
    });
    return;
  }
  if (state.level === 0) {
    wrap.innerHTML = "";
    return;
  }
  const presentTypes = /* @__PURE__ */ new Set();
  if (cy) {
    cy.edges().forEach((edge) => {
      const t = edge.data("etype");
      if (t) presentTypes.add(t);
    });
  }
  if (presentTypes.size === 0) {
    wrap.innerHTML = '<div class="ft-filter-placeholder">No edges in current view.</div>';
    return;
  }
  let rowsHtml = "";
  Object.entries(EDGE_TYPE_STYLE).forEach(([type, info]) => {
    if (!presentTypes.has(type)) return;
    const isActive = edgeActiveFilter.has(type);
    rowsHtml += `<div class="ef-row${isActive ? " active" : ""}" data-etype="${type}" style="--ef-col:${info.color}"><div class="ef-icon-bg"><span class="ef-indicator">` + _edgeLine(info.color, info.style) + `</span></div><span class="ef-label">${info.label || type}</span></div>`;
  });
  const bodyDisplay = efFilterCollapsed ? "none" : "block";
  const actionsHtml = `<button class="flt-action is-add" data-ef-action="all" title="${typeof T === "function" ? T("selectAll") : "All"}">+</button><button class="flt-action is-rm" data-ef-action="none" title="${typeof T === "function" ? T("selectNone") : "None"}">\u2212</button>`;
  wrap.innerHTML = _filterSectionHdr("Edge Types", efFilterCollapsed, actionsHtml) + `<div class="ef-filter-body" style="display:${bodyDisplay}; padding:4px 0 2px;">` + rowsHtml + `</div>`;
  wrap.querySelector(".flt-section-hdr").addEventListener("click", () => {
    efFilterCollapsed = !efFilterCollapsed;
    const body = wrap.querySelector(".ef-filter-body");
    const chev = wrap.querySelector(".flt-chevron");
    body.style.display = efFilterCollapsed ? "none" : "block";
    chev.style.transform = efFilterCollapsed ? "rotate(-90deg)" : "";
  });
  wrap.querySelectorAll(".ef-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = row.dataset.etype;
      if (edgeActiveFilter.has(t)) edgeActiveFilter.delete(t);
      else edgeActiveFilter.add(t);
      row.classList.toggle("active", edgeActiveFilter.has(t));
      applyEdgeFilter();
      updateSidebarStats();
    });
  });
  wrap.querySelectorAll(".flt-action").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.efAction;
      if (action === "all") {
        edgeActiveFilter.clear();
        Object.keys(EDGE_TYPE_STYLE).forEach((t) => edgeActiveFilter.add(t));
        wrap.querySelectorAll(".ef-row").forEach((row) => row.classList.add("active"));
      } else if (action === "none") {
        edgeActiveFilter.clear();
        wrap.querySelectorAll(".ef-row").forEach((row) => row.classList.remove("active"));
      }
      applyEdgeFilter();
      updateSidebarStats();
    });
  });
}
function applyEdgeFilter() {
  if (!cy) return;
  cy.batch(() => {
    cy.edges().forEach((edge) => {
      const etype = edge.data("etype") || "include";
      edge.style("display", edgeActiveFilter.has(etype) ? "element" : "none");
    });
  });
}
function buildSvEdgeFilter(wrap) {
  const defs = typeof window._svPresentEdgeTypeDefs === "function" ? window._svPresentEdgeTypeDefs() : [];
  if (!defs.length) {
    wrap.innerHTML = '<div class="ft-filter-placeholder">No edges in current view.</div>';
    return;
  }
  const hidden = window._svState && window._svState.hiddenEdgeTypes || /* @__PURE__ */ new Set();
  const actionsHtml = `<button class="flt-action is-add" data-sve-action="all" title="${typeof T === "function" ? T("selectAll") : "All"}">+</button><button class="flt-action is-rm" data-sve-action="none" title="${typeof T === "function" ? T("selectNone") : "None"}">\u2212</button>`;
  const bodyDisplay = svEdgeFilterCollapsed ? "none" : "block";
  let rowsHtml = "";
  defs.forEach((d) => {
    const isActive = !hidden.has(d.key);
    rowsHtml += `<div class="ef-row${isActive ? " active" : ""}" data-sve="${d.key}" style="--ef-col:${d.color}"><div class="ef-icon-bg"><span class="ef-indicator">` + _edgeLine(d.color, "solid") + `</span></div><span class="ef-label">${d.label}</span></div>`;
  });
  wrap.innerHTML = _filterSectionHdr("Edge Types", svEdgeFilterCollapsed, actionsHtml) + `<div class="sve-filter-body" style="display:${bodyDisplay}; padding:4px 0 2px;">` + rowsHtml + `</div>`;
  const applySv = () => {
    if (typeof window._svApplyEdgeTypeFilter === "function") window._svApplyEdgeTypeFilter();
  };
  wrap.querySelector(".flt-section-hdr").addEventListener("click", () => {
    svEdgeFilterCollapsed = !svEdgeFilterCollapsed;
    wrap.querySelector(".sve-filter-body").style.display = svEdgeFilterCollapsed ? "none" : "block";
    wrap.querySelector(".flt-chevron").style.transform = svEdgeFilterCollapsed ? "rotate(-90deg)" : "";
  });
  wrap.querySelectorAll("[data-sve]").forEach((row) => {
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      const h = window._svState && window._svState.hiddenEdgeTypes;
      if (!h) return;
      const k = row.dataset.sve;
      if (h.has(k)) h.delete(k);
      else h.add(k);
      row.classList.toggle("active", !h.has(k));
      applySv();
    });
  });
  wrap.querySelectorAll("[data-sve-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const h = window._svState && window._svState.hiddenEdgeTypes;
      if (!h) return;
      if (btn.dataset.sveAction === "all") {
        h.clear();
        wrap.querySelectorAll("[data-sve]").forEach((r) => r.classList.add("active"));
      } else {
        defs.forEach((d) => h.add(d.key));
        wrap.querySelectorAll("[data-sve]").forEach((r) => r.classList.remove("active"));
      }
      applySv();
    });
  });
}
function buildSvKindFilter(wrap) {
  const defs = typeof window._svPresentKindDefs === "function" ? window._svPresentKindDefs() : [];
  if (!defs.length) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "block";
  const hidden = window._svState && window._svState.hiddenKinds || /* @__PURE__ */ new Set();
  const label = (typeof T === "function" ? T("symbolTypes") : "") || "Symbol Types";
  const actionsHtml = `<button class="flt-action is-add" data-svk-action="all" title="${typeof T === "function" ? T("selectAll") : "All"}">+</button><button class="flt-action is-rm" data-svk-action="none" title="${typeof T === "function" ? T("selectNone") : "None"}">\u2212</button>`;
  const bodyDisplay = svKindFilterCollapsed ? "none" : "block";
  let rowsHtml = "";
  defs.forEach((d) => {
    const isActive = !hidden.has(d.key);
    rowsHtml += `<div class="ef-row${isActive ? " active" : ""}" data-svk="${d.key}" style="--ef-col:${d.color}"><div class="ef-icon-bg"><span class="nl-shape" style="color:${d.color}">\u25CF</span></div><span class="ef-label">${d.label}</span></div>`;
  });
  wrap.innerHTML = _filterSectionHdr(label, svKindFilterCollapsed, actionsHtml) + `<div class="svk-filter-body" style="display:${bodyDisplay}; padding:4px 0 2px;">` + rowsHtml + `</div>`;
  const applySvk = () => {
    if (typeof window._svApplyKindFilter === "function") window._svApplyKindFilter();
  };
  wrap.querySelector(".flt-section-hdr").addEventListener("click", () => {
    svKindFilterCollapsed = !svKindFilterCollapsed;
    wrap.querySelector(".svk-filter-body").style.display = svKindFilterCollapsed ? "none" : "block";
    wrap.querySelector(".flt-chevron").style.transform = svKindFilterCollapsed ? "rotate(-90deg)" : "";
  });
  wrap.querySelectorAll("[data-svk]").forEach((row) => {
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      const h = window._svState && window._svState.hiddenKinds;
      if (!h) return;
      const k = row.dataset.svk;
      if (h.has(k)) h.delete(k);
      else h.add(k);
      row.classList.toggle("active", !h.has(k));
      applySvk();
    });
  });
  wrap.querySelectorAll("[data-svk-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const h = window._svState && window._svState.hiddenKinds;
      if (!h) return;
      if (btn.dataset.svkAction === "all") {
        h.clear();
        wrap.querySelectorAll("[data-svk]").forEach((r) => r.classList.add("active"));
      } else {
        defs.forEach((d) => h.add(d.key));
        wrap.querySelectorAll("[data-svk]").forEach((r) => r.classList.remove("active"));
      }
      applySvk();
    });
  });
}
function applyL2Filter() {
  if (!cy || state.level !== 2) return;
  const hiddenTypes = /* @__PURE__ */ new Set();
  L2_NODE_FILTER_DEFS.forEach((d) => {
    if (!l2NodeFilter.has(d.key)) d.types.forEach((t) => hiddenTypes.add(t));
  });
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const t = node.data("_t");
      node.style("display", hiddenTypes.has(t) ? "none" : "element");
    });
    cy.edges().forEach((edge) => {
      const k = edge.data("l2kind");
      const edgeOk = !k || l2EdgeFilter.has(k);
      const srcHidden = hiddenTypes.has(edge.source().data("_t"));
      const tgtHidden = hiddenTypes.has(edge.target().data("_t"));
      edge.style("display", edgeOk && !srcHidden && !tgtHidden ? "element" : "none");
    });
  });
}
const _L2_NODE_TYPES = [
  { shape: "\u25A3", color: "#60a5fa", label: "Current file" },
  { shape: "\u25A3", color: "#64748b", label: "External func" },
  { shape: "\u25A3", color: "#a78bfa", label: "Ambiguous func" },
  { shape: "\u25A3", color: "#34d399", label: "System API group" },
  { shape: "\u25A3", color: "#475569", label: "Unresolved" }
];
function buildNodeLegend() {
  const wrap = document.getElementById("node-legend");
  if (!wrap) return;
  if (window._sv && window._sv.active) {
    wrap.innerHTML = "";
    return;
  }
  if (state.level === 2) {
    const presentTypes = /* @__PURE__ */ new Set();
    if (cy) cy.nodes().forEach((n) => {
      const t = n.data("_t");
      if (t) presentTypes.add(t);
    });
    const visible = L2_NODE_FILTER_DEFS.filter((d) => d.types.some((t) => presentTypes.has(t)));
    if (!visible.length) {
      wrap.innerHTML = "";
      return;
    }
    const actionsHtml = `<button class="flt-action is-add" data-l2n-action="all" title="${typeof T === "function" ? T("selectAll") : "All"}">+</button><button class="flt-action is-rm" data-l2n-action="none" title="${typeof T === "function" ? T("selectNone") : "None"}">\u2212</button>`;
    const bodyDisplay = l2NodeFilterCollapsed ? "none" : "block";
    let rowsHtml = "";
    visible.forEach((d) => {
      const isActive = l2NodeFilter.has(d.key);
      rowsHtml += `<div class="ef-row${isActive ? " active" : ""}" data-l2n="${d.key}" style="--ef-col:${d.color}"><div class="ef-icon-bg"><span class="nl-shape" style="color:${d.color}">\u25A3</span></div><span class="ef-label">${d.label}</span></div>`;
    });
    wrap.innerHTML = _filterSectionHdr("Node Types", l2NodeFilterCollapsed, actionsHtml) + `<div class="l2n-filter-body" style="display:${bodyDisplay}; padding:4px 0 2px;">` + rowsHtml + `</div>`;
    wrap.querySelector(".flt-section-hdr").addEventListener("click", () => {
      l2NodeFilterCollapsed = !l2NodeFilterCollapsed;
      wrap.querySelector(".l2n-filter-body").style.display = l2NodeFilterCollapsed ? "none" : "block";
      wrap.querySelector(".flt-chevron").style.transform = l2NodeFilterCollapsed ? "rotate(-90deg)" : "";
    });
    wrap.querySelectorAll("[data-l2n]").forEach((row) => {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const k = row.dataset.l2n;
        if (l2NodeFilter.has(k)) l2NodeFilter.delete(k);
        else l2NodeFilter.add(k);
        row.classList.toggle("active", l2NodeFilter.has(k));
        applyL2Filter();
      });
    });
    wrap.querySelectorAll("[data-l2n-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.dataset.l2nAction === "all") {
          visible.forEach((d) => l2NodeFilter.add(d.key));
          wrap.querySelectorAll("[data-l2n]").forEach((r) => r.classList.add("active"));
        } else {
          l2NodeFilter.clear();
          wrap.querySelectorAll("[data-l2n]").forEach((r) => r.classList.remove("active"));
        }
        applyL2Filter();
      });
    });
    return;
  }
  wrap.innerHTML = "";
}
function rerenderCurrentLevel() {
  if (state.level === 0) {
    loadLevel0();
    return;
  }
  if (state.level === 1) {
    rerenderCurrentL1();
    return;
  }
  if (state.level === 2 && l2State.activeFile) {
    openL2File(l2State.activeFile, { pushHistory: false });
  }
}
function updateSidebarStats() {
  const nodesEl = document.getElementById("sb-stat-nodes");
  const edgesEl = document.getElementById("sb-stat-edges");
  if (!nodesEl || !edgesEl) return;
  if (!cy) {
    nodesEl.textContent = "\u2013";
    edgesEl.textContent = "\u2013";
    return;
  }
  nodesEl.textContent = cy.nodes(":visible").length + " nodes";
  edgesEl.textContent = cy.edges(":visible").length + " edges";
}
function _updateGuideHeight(container) {
  if (!container || !container.classList.contains("open")) return;
  const rows = container.querySelectorAll(":scope > .tree-row");
  if (!rows.length) return;
  const lastRow = rows[rows.length - 1];
  const h = lastRow.offsetTop + lastRow.offsetHeight / 2;
  container.style.setProperty("--guide-h", h + "px");
}
function _updateAllGuideHeights() {
  document.querySelectorAll("#module-list .tree-children.open").forEach(_updateGuideHeight);
}
let fsCollapsed = false;
function collectAllFilesForTree() {
  const out = [];
  Object.values(DATA.files_by_module || {}).forEach((files) => {
    files.forEach((f) => out.push(f));
  });
  Object.values(DATA.other_files_by_module || {}).forEach((files) => {
    files.forEach((f) => out.push(f));
  });
  return out;
}
function buildFullFileTree(allFiles) {
  const root = { name: "", path: "", children: [], files: [] };
  const nodeMap = { "": root };
  function getNode(folderPath) {
    if (nodeMap[folderPath]) return nodeMap[folderPath];
    const parts = folderPath.split("/");
    const name = parts[parts.length - 1];
    const parent = parts.slice(0, -1).join("/");
    const parentNode = getNode(parent);
    const node = { name, path: folderPath, children: [], files: [] };
    parentNode.children.push(node);
    nodeMap[folderPath] = node;
    return node;
  }
  for (const f of allFiles) {
    if (!f || !f.path) continue;
    const lastSlash = f.path.lastIndexOf("/");
    const folder = lastSlash >= 0 ? f.path.slice(0, lastSlash) : "";
    getNode(folder).files.push(f);
  }
  function sortNode(n) {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.files.sort((a, b) => (a.label || a.path).localeCompare(b.label || b.path));
    n.children.forEach(sortNode);
  }
  sortNode(root);
  return root;
}
function buildFullTreeRows(container, node, depth) {
  node.children.forEach((child) => {
    const modId = child.path.split("/")[0] || child.name;
    const isTop = depth === 0;
    const subPath = child.path.startsWith(modId + "/") ? child.path.slice(modId.length + 1) : "";
    const hasKids = child.children.length > 0 || child.files.length > 0;
    const row = document.createElement("div");
    row.className = `tree-row ${isTop ? "mod-row" : "subdir-row"}`;
    row.dataset.modId = modId;
    row.dataset.path = child.path;
    if (isTop) {
      row.id = `mi-${modId}`;
    } else {
      row.dataset.subPath = subPath;
    }
    const count = countFiles(child);
    if (isTop) {
      row.innerHTML = `<span class="subdir-icon">${_iconFolderClosed()}</span><span class="mod-name" data-tip="${child.path}">${child.name}</span><span class="mod-count" data-tip="${count} files">${count}</span>`;
    } else {
      const indent = 6 + depth * 10;
      row.style.setProperty("--tree-indent", indent + "px");
      row.innerHTML = `<span style="flex-shrink:0;width:${indent}px"></span><span class="subdir-icon">${_iconFolderClosed()}</span><span class="subdir-name" data-tip="${child.path}">${child.name}</span><span class="subdir-count">${count}</span>`;
    }
    const children = document.createElement("div");
    children.className = "tree-children";
    if (hasKids) {
      buildFullTreeRows(children, child, depth + 1);
    }
    row.addEventListener("contextmenu", (e) => {
      if (typeof _showExplorerCtxMenu === "function") _showExplorerCtxMenu(e, child.path, true);
    });
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      const iconEl = row.querySelector(".subdir-icon");
      const isOpen = children.classList.contains("open");
      if (hasKids) {
        children.classList.toggle("open", !isOpen);
        if (iconEl) iconEl.innerHTML = isOpen ? _iconFolderClosed() : _iconFolderOpen();
        requestAnimationFrame(_updateAllGuideHeights);
      }
      if (state?.galaxyActive) return;
      clearSidebarActive();
      row.classList.add("active");
      if (isTop) {
        drillToModule(modId);
      } else {
        filterGraphToSubPath(modId, subPath);
        setSubdirActive(modId, subPath);
      }
    });
    container.appendChild(row);
    container.appendChild(children);
  });
  const fileIndent = 10 + depth * 10;
  node.files.forEach((f) => {
    const row = document.createElement("div");
    row.className = "tree-row file-row";
    row.dataset.path = f.path;
    row.dataset.fileType = f.file_type || "other";
    row.style.setProperty("--tree-indent", fileIndent + "px");
    const label = f.label || f.path;
    row.innerHTML = `<span style="flex-shrink:0;width:${fileIndent}px"></span><span class="file-icon">${_iconFile()}</span><span class="file-name" data-tip="${f.path}">${label}</span>`;
    row.addEventListener("contextmenu", (e) => {
      if (typeof _showExplorerCtxMenu === "function") _showExplorerCtxMenu(e, f.path, false);
    });
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      clearSidebarActive();
      row.classList.add("active");
      if (state?.galaxyActive && typeof galaxyHighlightByPath === "function") {
        galaxyHighlightByPath(f.path);
        return;
      }
      const ft = f.file_type || "other";
      if (!ftActiveFilter.has(ft)) {
        ftActiveFilter.add(ft);
        if (typeof buildFtFilter === "function") {
          const modId2 = resolveModuleForFile(f.path);
          if (modId2 && state.level === 1) {
            buildFtFilter(modId2, state.activeSubDir || null);
          }
        }
      }
      const modId = resolveModuleForFile(f.path) || "_root";
      if (modId && modId !== "_root") {
        drillToModule(modId, { focusFile: f.path });
        setTimeout(() => {
          if (typeof loadFileInPanel === "function") {
            loadFileInPanel(f.path);
          }
          if (typeof updateCallGraphBtn === "function") {
            updateCallGraphBtn(f.path);
          }
          if (window.svUpdateStructBtn && typeof window.svUpdateStructBtn === "function") {
            const hasFuncs = DATA.funcs_by_file && DATA.funcs_by_file[f.path]?.length > 0;
            const hasSyms = DATA.file_symdefs && DATA.file_symdefs[f.path]?.length > 0;
            if (hasFuncs || hasSyms) {
              window.svUpdateStructBtn(true);
            }
          }
        }, 100);
      } else {
        if (state.level === 1 && state.activeModule) {
          rerenderCurrentL1();
          setTimeout(() => {
            if (typeof buildFtFilter === "function") {
              buildFtFilter(state.activeModule, state.activeSubDir || null);
            }
          }, 50);
          setTimeout(() => {
            const nodeId = `f${f.id}`;
            const node2 = cy?.$id(nodeId);
            if (node2 && node2.length) {
              cy.elements().unselect();
              node2.select();
              if (typeof highlightNode === "function") {
                highlightNode(node2);
              }
              cy.animate({
                center: { eles: node2 },
                zoom: Math.max(cy.zoom(), 1.8)
              }, {
                duration: 700,
                easing: "ease-in-out-cubic",
                complete: () => {
                  if (!cy.hasElementWithId(node2.id())) return;
                  let count = 0;
                  const originalBc = node2.data("bc");
                  const flashInterval = setInterval(() => {
                    count++;
                    if (!cy.hasElementWithId(node2.id())) {
                      clearInterval(flashInterval);
                      return;
                    }
                    node2.style("border-color", count % 2 === 1 ? typeof _tC === "function" ? _tC("#ffffff", "#8c7851") : "#ffffff" : originalBc);
                    node2.style("border-width", count % 2 === 1 ? 4 : 2);
                    if (count >= 6) {
                      clearInterval(flashInterval);
                      node2.style("border-color", originalBc);
                      node2.style("border-width", 2);
                    }
                  }, 200);
                }
              });
            }
          }, 150);
        }
        if (typeof loadFileInPanel === "function") {
          loadFileInPanel(f.path);
        }
        if (typeof updateCallGraphBtn === "function") {
          updateCallGraphBtn(f.path);
        }
        if (window.svUpdateStructBtn && typeof window.svUpdateStructBtn === "function") {
          const hasFuncs = DATA.funcs_by_file && DATA.funcs_by_file[f.path]?.length > 0;
          const hasSyms = DATA.file_symdefs && DATA.file_symdefs[f.path]?.length > 0;
          if (hasFuncs || hasSyms) {
            window.svUpdateStructBtn(true);
          }
        }
      }
    });
    container.appendChild(row);
  });
}
function setAllExplorerFolders(open) {
  const list = document.getElementById("module-list");
  if (!list) return;
  const root = list.querySelector(":scope > .tree-children");
  list.querySelectorAll(".tree-children").forEach((tc) => {
    if (tc === root) {
      tc.classList.add("open");
      return;
    }
    tc.classList.toggle("open", open);
  });
  list.querySelectorAll(".mod-row .subdir-icon, .subdir-row .subdir-icon").forEach((iconEl) => {
    iconEl.innerHTML = open ? _iconFolderOpen() : _iconFolderClosed();
  });
  requestAnimationFrame(_updateAllGuideHeights);
}
function buildSidebar() {
  const list = document.getElementById("module-list");
  list.innerHTML = "";
  const titleEl = document.getElementById("sidebar-title");
  if (titleEl) {
    const expandTip = typeof T === "function" ? T("selectAll") : "Expand all";
    const collapseTip = typeof T === "function" ? T("selectNone") : "Collapse all";
    titleEl.innerHTML = `<span>Explorer</span><span class="flt-actions"><button class="flt-action is-add" data-tree-action="expand" title="${expandTip}">+</button><button class="flt-action is-rm" data-tree-action="collapse" title="${collapseTip}">\u2212</button></span>`;
    titleEl.querySelectorAll("[data-tree-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        setAllExplorerFolders(btn.dataset.treeAction === "expand");
      });
    });
  }
  const rootPath = (DATA.stats?.root || "").replace(/\\/g, "/").replace(/\/$/, "");
  const rootName = rootPath.split("/").filter(Boolean).pop() || "VIZCODE";
  const allFiles = collectAllFilesForTree();
  const tree = buildFullFileTree(allFiles);
  const totalCount = countFiles(tree);
  const hasKids = tree.children.length > 0 || tree.files.length > 0;
  const rootChildren = document.createElement("div");
  rootChildren.className = "tree-children open";
  if (hasKids) buildFullTreeRows(rootChildren, tree, 0);
  list.appendChild(rootChildren);
  requestAnimationFrame(_updateAllGuideHeights);
  requestAnimationFrame(applyFtFilterToExplorer);
}
function buildFileTree(files, modId) {
  const root = { name: modId, path: "", files: [], children: [] };
  const nodeMap = { "": root };
  function ensureNode(parts, upTo) {
    const key = parts.slice(0, upTo + 1).join("/");
    if (!nodeMap[key]) {
      const parent = nodeMap[parts.slice(0, upTo).join("/") || ""];
      const node = { name: parts[upTo], path: key, files: [], children: [] };
      parent.children.push(node);
      nodeMap[key] = node;
    }
    return nodeMap[key];
  }
  files.forEach((f) => {
    const prefix = modId + "/";
    const rel = f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path;
    const parts = rel.split("/");
    if (parts.length === 1) {
      root.files.push(f);
    } else {
      for (let i = 0; i < parts.length - 1; i++) {
        ensureNode(parts, i);
      }
      const dirKey = parts.slice(0, -1).join("/");
      nodeMap[dirKey].files.push(f);
    }
  });
  return root;
}
function buildTreeRows(container, node, modId, modColor, depth) {
  node.children.forEach((child) => {
    const fileCount = countFiles(child);
    const hasKids = child.children.length > 0;
    const indent = 14 + depth * 10;
    const row = document.createElement("div");
    row.className = "tree-row subdir-row";
    row.dataset.modId = modId;
    row.dataset.subPath = child.path;
    row.dataset.path = `${modId}/${child.path}`;
    row.style.setProperty("--tree-indent", indent + "px");
    row.innerHTML = `<span style="flex-shrink:0;width:${indent}px"></span><span class="subdir-icon">${_iconFolderClosed()}</span><span class="subdir-name" data-tip="${modId}/${child.path}">${child.name}</span><span class="subdir-count">${fileCount}</span>`;
    const subChildren = document.createElement("div");
    subChildren.className = "tree-children";
    if (hasKids) {
      buildTreeRows(subChildren, child, modId, modColor, depth + 1);
    }
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      const iconEl = row.querySelector(".subdir-icon");
      const isOpen = subChildren.classList.contains("open");
      if (hasKids) {
        subChildren.classList.toggle("open", !isOpen);
        if (iconEl) iconEl.innerHTML = isOpen ? _iconFolderClosed() : _iconFolderOpen();
        requestAnimationFrame(_updateAllGuideHeights);
      }
      filterGraphToSubPath(modId, child.path);
      setSubdirActive(modId, child.path);
    });
    container.appendChild(row);
    container.appendChild(subChildren);
  });
}
function countFiles(node) {
  return node.files.length + node.children.reduce((s, c) => s + countFiles(c), 0);
}
function _sidebarNormPath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").replace(/\/$/, "");
}
function _sidebarDirname(path) {
  const norm = _sidebarNormPath(path);
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? "" : norm.slice(0, idx);
}
function _sidebarFindRowByPath(path, selector) {
  const norm = _sidebarNormPath(path);
  return Array.from(document.querySelectorAll(selector)).find(
    (row) => _sidebarNormPath(row.dataset.path || "") === norm
  ) || null;
}
function _sidebarSetFolderOpen(row, isOpen) {
  if (!row) return;
  const children = row.nextElementSibling;
  if (!children || !children.classList.contains("tree-children")) return;
  children.classList.toggle("open", isOpen);
  const iconEl = row.querySelector(".subdir-icon");
  if (iconEl) iconEl.innerHTML = isOpen ? _iconFolderOpen() : _iconFolderClosed();
  requestAnimationFrame(_updateAllGuideHeights);
}
function _sidebarExpandToPath(path) {
  const norm = _sidebarNormPath(path);
  if (!norm) return;
  const parts = norm.split("/");
  let acc = "";
  parts.forEach((part) => {
    acc = acc ? `${acc}/${part}` : part;
    const row = _sidebarFindRowByPath(acc, ".mod-row, .subdir-row");
    if (row) _sidebarSetFolderOpen(row, true);
  });
}
function clearSidebarActive() {
  document.querySelectorAll(".tree-row.active, .tree-row.galaxy-active").forEach((row) => row.classList.remove("active", "galaxy-active"));
}
window.clearSidebarActive = clearSidebarActive;
window.clearSidebarGalaxyExplorerHighlight = clearSidebarActive;
function setSubdirActive(modId, subPath) {
  clearSidebarActive();
  const row = document.querySelector(`.subdir-row[data-mod-id="${modId}"][data-sub-path="${subPath}"]`);
  if (row) row.classList.add("active");
}
function revealSidebarExplorerPath(path, kind = "file") {
  if (_sbActiveTab === "filters") {
    const inOverview = typeof window.isOverviewTreemapActive === "function" && window.isOverviewTreemapActive();
    if (!inOverview) return false;
    _sbActiveTab = "explorer";
    _applySidebarTab();
  }
  const norm = _sidebarNormPath(path);
  clearSidebarActive();
  if (!norm) return false;
  if (kind === "folder") {
    _sidebarExpandToPath(norm);
    const folderRow = _sidebarFindRowByPath(norm, ".mod-row, .subdir-row");
    if (!folderRow) return false;
    folderRow.classList.add("active");
    folderRow.scrollIntoView({ block: "nearest" });
    return true;
  }
  _sidebarExpandToPath(_sidebarDirname(norm));
  const fileRow = _sidebarFindRowByPath(norm, ".file-row");
  if (!fileRow) return false;
  fileRow.classList.add("active");
  fileRow.scrollIntoView({ block: "nearest" });
  return true;
}
window.revealSidebarExplorerPath = revealSidebarExplorerPath;
function filterGraphToSubPath(modId, subPath) {
  if (typeof pushGlobalNavSnapshot === "function" && !isGlobalNavRestoring()) {
    pushGlobalNavSnapshot("filter-subpath");
  }
  state.level = 1;
  state.activeModule = modId;
  state.activeSubDir = subPath;
  const prefix = modId + "/" + subPath + "/";
  const allFiles = DATA.files_by_module[modId] || [];
  const filtered = allFiles.filter((f) => f.path.startsWith(prefix) || f.path === modId + "/" + subPath);
  pushL1History(modId, subPath);
  setL1ToolbarVisible(true);
  updateL1Toolbar(`${modId} / ${subPath}`, filtered.length);
  renderFilesFlat(modId, filtered, subPath);
  updateBreadcrumb();
  buildFtFilter(modId, subPath);
}
