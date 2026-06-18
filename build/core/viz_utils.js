function T(key, vars) {
  return window._i18n ? window._i18n.t(key, vars) : key;
}
function getSavedFont() {
  return _PREFS.get("font");
}
function _currentRootName() {
  const root = (window.DATA?.stats?.root || "").replace(/\\/g, "/").replace(/\/$/, "");
  return root.split("/").filter(Boolean).pop() || "VIZCODE";
}
function isDashboardOpen() {
  const overlay = document.getElementById("dashboard-overlay");
  return !!overlay && overlay.style.display !== "none";
}
function getTopbarMode() {
  if (isDashboardOpen()) return "dashboard";
  if (state?.galaxyActive) return "galaxy";
  return "graph";
}
function syncTopbarModeButtons() {
  const activeMode = getTopbarMode();
  ["dashboard", "graph", "galaxy"].forEach((mode) => {
    const btn = document.getElementById(`${mode}-btn`);
    if (!btn) return;
    const active = mode === activeMode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  document.body.dataset.topMode = activeMode;
}
function switchTopbarMode(mode) {
  if (mode === getTopbarMode()) return;
  if (mode === "dashboard" && typeof openDashboard === "function") {
    openDashboard();
    return;
  }
  if (mode === "galaxy" && typeof openGalaxy === "function") {
    openGalaxy();
    return;
  }
  if (mode === "graph") {
    if (typeof closeDashboard === "function") closeDashboard();
    if (typeof closeGalaxy === "function") closeGalaxy();
    syncTopbarModeButtons();
  }
}
function _formatL2Stats(stats) {
  if (!stats) return "";
  const parts = [];
  parts.push(T("countFuncsShort", { count: stats.funcs || 0 }));
  parts.push(T("countEdges", { count: stats.internalEdges || 0 }));
  if (stats.extModules) parts.push(T("countModules", { count: stats.extModules }));
  if (stats.extFuncs) parts.push(T("countExternalFunctions", { count: stats.extFuncs }));
  if (stats.legacy) parts.push(T("legacyEdges"));
  return parts.join(" | ");
}
function showMsg(msg) {
  const el = document.getElementById("loading");
  if (!el) return;
  el.classList.add("show");
  const spinner = document.querySelector("#loading .spinner");
  if (spinner) spinner.style.display = "none";
  document.getElementById("loading-msg").textContent = msg;
}
function isAlreadyAtLocation(node) {
  if (!node) return false;
  const d = node.data();
  const normalize = (p) => (p || "").replace(/\\/g, "/").toLowerCase();
  const srcPath = normalize(state.level === 2 ? l2State.activeFile || "" : state.activeModule || "");
  const tgtPath = normalize((typeof d._f === "object" ? d._f?.path : d._f) || d.mod || d.id || "");
  if (!srcPath || !tgtPath) return false;
  if (state.level === 1) {
    if (tgtPath === srcPath) return true;
    if (tgtPath.startsWith(srcPath + "/")) return true;
  }
  if (state.level === 2) {
    if (tgtPath === srcPath) return true;
  }
  return false;
}
function showToast(msg, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("toast-hide");
    setTimeout(() => el.remove(), 300);
  }, 3e3);
}
function showSelectFileFirstToast() {
  showToast("\u8ACB\u5148\u9078\u64C7\u4E00\u500B\u6A94\u6848<br>Please select a file first", "error");
}
function _tC(dark, light) {
  const t = document.documentElement.getAttribute("data-theme") || "dark";
  return t === "parchment" ? light : dark;
}
function _safeId(s) {
  return String(s || "").replace(/[^a-zA-Z0-9_]+/g, "_").slice(0, 32) || "x";
}
function _hashId(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function showLoading(v, msg) {
  const el = document.getElementById("loading");
  const sp = document.querySelector("#loading .spinner");
  el.classList.toggle("show", v);
  if (v && msg) document.getElementById("loading-msg").textContent = msg;
  if (sp) sp.style.display = "";
  const cancelBtn = document.getElementById("loading-cancel-btn");
  if (cancelBtn) cancelBtn.style.display = v ? "" : "none";
}
function cancelRender() {
  _renderToken++;
  showLoading(false);
  showToast("\u5DF2\u53D6\u6D88\u6E32\u67D3 (Render cancelled)", "info");
}
function dedupeBy(arr, key) {
  return [...new Map(arr.map((x) => [x[key], x])).values()];
}
function fmtSize(b) {
  return b > 1e6 ? (b / 1e6).toFixed(1) + "MB" : b > 1e3 ? (b / 1e3).toFixed(0) + "KB" : b + "B";
}
function _pathDist(a, b) {
  if (!a || !b) return a === b ? 0 : 99;
  if (a === b) return 0;
  const pa = a.replace(/\\/g, "/").split("/");
  const pb = b.replace(/\\/g, "/").split("/");
  let shared = 0;
  const ml = Math.min(pa.length, pb.length);
  for (let i = 0; i < ml; i++) {
    if (pa[i] === pb[i]) shared++;
    else break;
  }
  return pa.length - shared + (pb.length - shared);
}
function _distColor(d) {
  if (d === 0) return "#38bdf8";
  if (d <= 2) return "#10b981";
  if (d <= 4) return "#f59e0b";
  if (d >= 99) return "#64748b";
  return "#f87171";
}
function _distLabel(d) {
  if (d === 0) return "same file";
  if (d >= 99) return "external";
  return `${d} layer${d !== 1 ? "s" : ""} away`;
}
function _edgeLine(col, style) {
  const dash = style === "dashed" ? "4,3" : style === "dotted" ? "2,2" : "none";
  const strokeDash = dash !== "none" ? `stroke-dasharray="${dash}"` : "";
  return `<svg width="20" height="10" viewBox="0 0 20 10" style="vertical-align:middle;overflow:visible">
        <line x1="0" y1="5" x2="16" y2="5" stroke="${col}" stroke-width="2" ${strokeDash}/>
        <polygon points="14,2 20,5 14,8" fill="${col}"/>
    </svg>`;
}
