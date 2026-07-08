function _dashFmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
function _dashFmtExactNum(n) {
  const value = Number(n || 0);
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}
function _dashFmtBytes(b) {
  if (!b) return "0 B";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 / 1024).toFixed(2) + " MB";
}
function _dashEscape(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function _dashFlatFiles() {
  if (!window.DATA) return [];
  const out = [];
  for (const [, files] of Object.entries(DATA.files_by_module || {})) {
    for (const f of files) out.push(f);
  }
  return out;
}
function _dashAllFiles() {
  return _dashFlatFiles();
}
function _dashFileForPath(path) {
  const norm = String(path || "").replace(/\\/g, "/");
  return _dashAllFiles().find((f) => String(f.path || "").replace(/\\/g, "/") === norm) || null;
}
function _dashFilesByExt(ext) {
  const target = String(ext || "").replace(/^\./, "").toLowerCase();
  return _dashAllFiles().filter((f) => {
    const fExt = String(f.ext || "").replace(/^\./, "").toLowerCase() || String(f.path || "").split(".").pop().toLowerCase();
    return fExt === target;
  });
}
function _dashFilesByType(type) {
  const target = String(type || "").toLowerCase();
  return _dashAllFiles().filter((f) => String(f.file_type || "").toLowerCase() === target);
}
function _dashFilesByModule(modId) {
  return (window.DATA && DATA.files_by_module && DATA.files_by_module[modId] || []).slice();
}
function _dashFunctionsByFile(filePath) {
  if (!window.DATA || !filePath) return [];
  const rel = String(filePath).replace(/\\/g, "/");
  const syms = Object.values(DATA.symbol_index || {}).filter((s) => s && s.file === rel && (s.kind === "function" || s.kind === "method")).map((s) => ({
    file: rel,
    name: s.name || "?",
    line: s.line || 0,
    end_line: s.end_line || s.line || 0,
    lines: s.end_line && s.line ? Math.max(0, s.end_line - s.line + 1) : 0,
    complexity: s.complexity,
    value: s.complexity != null ? `cx ${s.complexity}` : ""
  }));
  if (syms.length) return syms;
  const funcs = DATA.funcs_by_file?.[rel] || [];
  return funcs.map((fn) => ({
    file: rel,
    name: fn.name || fn.label || "?",
    line: fn.line || 0,
    end_line: fn.end_line || fn.line || 0,
    lines: fn.lines || 0,
    complexity: fn.complexity
  }));
}
function _dashAllFunctions() {
  const out = [];
  const symRows = Object.values(window.DATA && DATA.symbol_index || {}).filter((s) => s && s.file && (s.kind === "function" || s.kind === "method"));
  if (symRows.length) {
    symRows.forEach((s) => out.push({
      file: String(s.file).replace(/\\/g, "/"),
      name: s.name || "?",
      line: s.line || 0,
      end_line: s.end_line || s.line || 0,
      lines: s.end_line && s.line ? Math.max(0, s.end_line - s.line + 1) : 0,
      complexity: s.complexity
    }));
    return out;
  }
  for (const f of _dashAllFiles()) {
    const rel = f.path || "";
    const defs = DATA.funcs_by_file?.[rel] || f.functions || [];
    defs.forEach((fn) => out.push({
      file: rel,
      name: fn.name || fn.label || "?",
      line: fn.line || 0,
      end_line: fn.end_line || fn.line || 0,
      lines: fn.lines || 0,
      complexity: fn.complexity
    }));
  }
  return out;
}
function _dashAllEdges() {
  if (!window.DATA) return [];
  const out = [];
  for (const [, edges] of Object.entries(DATA.file_edges_by_module || {})) {
    for (const e of edges) out.push(e);
  }
  return out;
}
function _dashT(key) {
  if (typeof T === "function") {
    try {
      const out = T(key);
      if (out && out !== key) return out;
    } catch (_) {
    }
  }
  return key;
}
function _dashJson(value) {
  return JSON.stringify(value).replace(/"/g, "&quot;");
}
function _dashMiniPills(items, options) {
  const opts = options || {};
  const rows = (items || []).filter(Boolean).slice(0, opts.limit || 3);
  if (!rows.length) {
    return `<div class="dash-s-pills"><span class="dash-s-pill muted">${_dashEscape(opts.empty || "No data")}</span></div>`;
  }
  return `<div class="dash-s-pills">${rows.map((item) => {
    const label = Array.isArray(item) ? item[0] : item.label;
    const value = Array.isArray(item) ? item[1] : item.value;
    const title = item.title || label;
    const click = item.onclick ? ` onclick="${item.onclick}"` : "";
    const cls = item.muted ? " muted" : "";
    return `<span class="dash-s-pill${cls}" title="${_dashEscape(title)}"${click}>${_dashEscape(label)}${value != null ? ` <b>${_dashEscape(value)}</b>` : ""}</span>`;
  }).join("")}</div>`;
}
function _dashFindFunctionSymbol(filePath, funcName) {
  if (!window.DATA || !filePath || !funcName) return null;
  const rel = String(filePath).replace(/\\/g, "/");
  const name = String(funcName);
  return Object.values(DATA.symbol_index || {}).find(
    (s) => s && s.file === rel && s.name === name && (s.kind === "function" || s.kind === "method")
  ) || null;
}
function _dashResolvedLine(filePath, funcName, line) {
  const explicit = Number(line) > 0 ? Number(line) : 0;
  if (explicit) return explicit;
  const sym = _dashFindFunctionSymbol(filePath, funcName);
  return Number(sym?.line) > 0 ? Number(sym.line) : 0;
}
function _dashCloseDashboardWindows(options) {
  const opts = options || {};
  if (typeof _dashCloseGroupDrilldown === "function") _dashCloseGroupDrilldown();
  if (typeof _dashCloseCommitDayDrilldown === "function") _dashCloseCommitDayDrilldown();
  if (typeof _dashCloseDrilldown === "function") _dashCloseDrilldown();
  if (typeof _dashCloseDetailPanel === "function") {
    const detailOpen = typeof _dashDetailOpen !== "undefined" && _dashDetailOpen || !!document.getElementById("dash-detail-panel") || !!document.getElementById("dash-detail-backdrop");
    if (detailOpen) _dashCloseDetailPanel(true);
  }
  if (opts.closeDashboard !== false && typeof closeDashboard === "function") {
    closeDashboard();
  }
}
function _dashForceGraphMode() {
  _dashCloseDashboardWindows();
  if (typeof closeGalaxy === "function") closeGalaxy();
  if (typeof window._lswExitOverview === "function") window._lswExitOverview();
  if (window.state) state.galaxyActive = false;
  document.getElementById("galaxy-container")?.classList.remove("active");
  const cyEl = document.getElementById("cy");
  if (cyEl) cyEl.style.display = "";
  document.body.dataset.topMode = "graph";
  if (window._sv && window._sv.active) {
    if (typeof symViewClose === "function") symViewClose();
    else if (typeof svHideSvView === "function") svHideSvView();
  }
  if (typeof syncTopbarModeButtons === "function") syncTopbarModeButtons();
}
function _dashFocusCodePanel(filePath, funcName, lineNo) {
  if (!filePath) return;
  if (typeof codeState !== "undefined") codeState.userClosed = false;
  const jumpLine = () => {
    if (lineNo && typeof jumpToLine === "function") {
      setTimeout(() => jumpToLine(lineNo), 140);
    }
  };
  if (typeof loadFileInPanel === "function") {
    const result = loadFileInPanel(filePath, funcName || null);
    if (result && typeof result.then === "function") {
      result.then(jumpLine).catch(jumpLine);
    } else {
      jumpLine();
    }
    return;
  }
  if (funcName && typeof _syncCodePanel === "function") {
    _syncCodePanel(filePath, funcName);
    jumpLine();
  }
}
function _dashCanonicalL2FuncName(filePath, funcName) {
  if (!filePath || !funcName) return "";
  const funcs = window.DATA && DATA.funcs_by_file && DATA.funcs_by_file[filePath] || [];
  const target = String(funcName);
  const match = funcs.find((f) => String(f.label || "") === target || String(f.name || "") === target);
  return match ? match.label || match.name || target : target;
}
function _dashOpenGraphFunction(rel, fnName, lineNo) {
  const focusName = _dashCanonicalL2FuncName(rel, fnName);
  document.getElementById("cy")?.classList.add("l2-view");
  if (typeof setL1ToolbarVisible === "function") setL1ToolbarVisible(false);
  if (window.updateFilterTabEnabled) updateFilterTabEnabled();
  const ftWrap = document.getElementById("ft-filter");
  if (ftWrap) ftWrap.style.display = "none";
  if (typeof openL2File === "function") {
    openL2File(rel, { newSession: true, pushHistory: true, focusFunc: focusName || null });
  } else if (typeof drillToFile === "function") {
    drillToFile(rel);
  }
  if (typeof updateCallGraphBtn === "function") updateCallGraphBtn(rel);
  if (window._lswUpdate) {
    window._lswUpdate({ force: true, active: 2, l1Available: true, l2Available: true });
  }
}
function _dashOpenGraphFileL1(rel, modId, lineNo) {
  document.getElementById("cy")?.classList.remove("l2-view");
  if (typeof hideFuncView === "function") hideFuncView();
  if (typeof setL1ToolbarVisible === "function") setL1ToolbarVisible(true);
  if (window.updateFilterTabEnabled) updateFilterTabEnabled();
  const ftWrap = document.getElementById("ft-filter");
  if (ftWrap) ftWrap.style.display = "";
  if (modId && typeof drillToModule === "function") {
    drillToModule(modId, { focusFile: rel });
  } else if (typeof loadLevel0 === "function") {
    loadLevel0();
  }
  if (typeof updateCallGraphBtn === "function") updateCallGraphBtn(rel);
  if (window._lswUpdate) {
    const hasFuncs = !!(window.DATA && DATA.funcs_by_file && DATA.funcs_by_file[rel] || []).length;
    window._lswUpdate({ force: true, active: 1, l1Available: true, l2Available: hasFuncs });
  }
  _dashFocusCodePanel(rel, null, lineNo);
}
function _dashGoToGraphFile(filePath, funcName, line) {
  if (!filePath) return;
  const rel = String(filePath).replace(/\\/g, "/");
  const modId = _dashFindModule(rel);
  const fnName = funcName ? String(funcName) : "";
  const lineNo = _dashResolvedLine(rel, fnName, line);
  _dashForceGraphMode();
  if (fnName) {
    _dashOpenGraphFunction(rel, fnName, lineNo);
  } else {
    _dashOpenGraphFileL1(rel, modId, lineNo);
  }
}
function _dashDrill(filePath, funcName, line) {
  _dashGoToGraphFile(filePath, funcName, line);
}
function _dashNormalizeFileList(files) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const item of files || []) {
    const path = typeof item === "string" ? item : item && (item.path || item.file);
    if (!path) continue;
    const rel = String(path).replace(/\\/g, "/");
    if (seen.has(rel)) continue;
    seen.add(rel);
    const meta = _dashFileForPath(rel) || {};
    out.push(Object.assign({}, meta, typeof item === "object" ? item : {}, { path: rel }));
  }
  return out;
}
function _dashOpenFileGroupDrilldown(title, files, options) {
  _dashOpenGroupDrilldown(title, _dashNormalizeFileList(files), "file", options || {});
}
function _dashOpenFunctionGroupDrilldown(title, functions, options) {
  const rows = (functions || []).filter((fn) => fn && fn.file).map((fn) => ({
    file: String(fn.file).replace(/\\/g, "/"),
    name: fn.name || fn.label || "?",
    line: fn.line || 0,
    end_line: fn.end_line || fn.line || 0,
    value: fn.value ?? fn.lines ?? fn.complexity ?? "",
    meta: fn.meta || ""
  }));
  _dashOpenGroupDrilldown(title, rows, "function", options || {});
}
const _DASH_GROUP_DRILL_ID = "dash-group-drilldown-overlay";
function _dashOpenGroupDrilldown(title, rows, kind, options) {
  _dashCloseGroupDrilldown();
  const overlay = document.createElement("div");
  overlay.id = _DASH_GROUP_DRILL_ID;
  overlay.className = "dash-group-drilldown-overlay";
  const safeTitle = _dashEscape(title || "Files");
  const count = rows.length;
  const body = count ? rows.map((row, i) => {
    const file = row.path || row.file || "";
    const short = String(file).split("/").pop();
    if (kind === "function") {
      const lineNo = _dashResolvedLine(file, row.name || "", row.line);
      return `<div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(file)}"
     onclick="_dashGoToGraphFile(${_dashJson(file)}, ${_dashJson(row.name || "")}, ${lineNo || "null"})">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(row.name || "?")}<span class="dash-list-meta">${_dashEscape(short + (lineNo ? ":" + lineNo : ""))}${row.meta ? " \xB7 " + _dashEscape(row.meta) : ""}</span></span>
  <span class="dash-list-val">${_dashEscape(row.value)}</span>
</div>`;
    }
    const loc = row.loc || {};
    const meta = options && typeof options.meta === "function" ? options.meta(row) : row.count != null ? `${row.count}` : loc.code ? `${_dashFmtNum(loc.code)} LOC` : _dashFmtBytes(row.size || 0);
    return `<div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(file)}"
     onclick="_dashGoToGraphFile(${_dashJson(file)}, null)">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(short)}<span class="dash-list-meta">${_dashEscape(file)}</span></span>
  <span class="dash-list-val">${_dashEscape(meta)}</span>
</div>`;
  }).join("") : `<div class="dash-empty">${_dashEscape(options.empty || "No files")}</div>`;
  overlay.innerHTML = `
<div class="dash-group-drilldown-panel" role="dialog" aria-modal="true">
  <div class="dash-group-drilldown-head">
    <div>
      <div class="dash-detail-head-label">Drilldown</div>
      <div class="dash-detail-head-name">${safeTitle}<span class="dash-list-meta dash-list-meta--inline"> ${count} ${kind === "function" ? "functions" : "files"}</span></div>
    </div>
    <button class="dash-detail-close" type="button" data-close-group aria-label="Close">x</button>
  </div>
  <div class="dash-group-drilldown-body"><div class="dash-list">${body}</div></div>
</div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest("[data-close-group]")) _dashCloseGroupDrilldown();
  });
  if (!_dashGroupDrillEscBound) {
    document.addEventListener("keydown", _dashGroupDrillKeyHandler);
    _dashGroupDrillEscBound = true;
  }
}
let _dashGroupDrillEscBound = false;
function _dashGroupDrillKeyHandler(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    _dashCloseGroupDrilldown();
  }
}
function _dashCloseGroupDrilldown() {
  document.getElementById(_DASH_GROUP_DRILL_ID)?.remove();
  if (_dashGroupDrillEscBound) {
    document.removeEventListener("keydown", _dashGroupDrillKeyHandler);
    _dashGroupDrillEscBound = false;
  }
}
const _DASH_WIDGET_LABEL_KEYS = {
  kpi_strip: "dashSettingsWidgetKpi",
  code_health: "dashCodeHealthTitle",
  tech_debt: "dashTechDebtTitle",
  complexity: "dashComplexityTitle",
  duplication: "dashDuplicationTitle",
  coupling: "dashSettingsWidgetCoupling",
  issues: "dashSettingsWidgetIssues",
  structure: "dashSettingsWidgetStructure",
  graph_intelligence: "dashSettingsWidgetGraph",
  commit_heatmap: "dashTemporalHeatmap",
  churn_timeline: "dashTemporalChurn",
  temporal: "dashTemporalTitle",
  harness_scan: "dashHarnessTitle"
};
function _dashSettingsWidgetRow(key, visible) {
  const labelKey = _DASH_WIDGET_LABEL_KEYS[key] || key;
  const label = _dashT(labelKey);
  return `
<li class="dash-settings-row" data-widget="${key}" draggable="true">
  <span class="dash-settings-grip" aria-hidden="true">\u22EE\u22EE</span>
  <label class="dash-settings-toggle">
    <input type="checkbox" data-toggle="${key}" ${visible ? "checked" : ""}>
    <span>${_dashEscape(label)}</span>
  </label>
  <span class="dash-settings-key">${key}</span>
</li>`;
}
function _dashSettingsBindReorder(list, onReorder) {
  if (!list) return;
  let dragged = null;
  list.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".dash-settings-row");
    if (!row) return;
    dragged = row;
    row.classList.add("dragging");
    try {
      e.dataTransfer.setData("text/plain", row.dataset.widget);
    } catch (_) {
    }
  });
  list.addEventListener("dragend", () => {
    if (dragged) dragged.classList.remove("dragging");
    dragged = null;
    if (typeof onReorder === "function") onReorder();
  });
  list.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!dragged) return;
    const target = e.target.closest(".dash-settings-row");
    if (!target || target === dragged) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    list.insertBefore(dragged, before ? target : target.nextSibling);
  });
}
function _dashFindModule(fileRel) {
  if (!window.DATA) return null;
  const norm = String(fileRel).replace(/\\/g, "/");
  for (const bucket of [DATA.files_by_module || {}, DATA.other_files_by_module || {}]) {
    for (const [modId, files] of Object.entries(bucket)) {
      if ((files || []).some((f) => (f.path || "").replace(/\\/g, "/") === norm)) {
        return modId;
      }
    }
  }
  return null;
}
