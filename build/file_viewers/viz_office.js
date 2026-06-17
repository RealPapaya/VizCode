const _OFFICE_HEADER_CSS = `
.office-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden}
.office-header{display:flex;align-items:center;gap:10px;padding:7px 12px;border-bottom:1px solid var(--border);flex-shrink:0;font-size:12px;color:var(--muted);font-family:var(--code-font)}
.office-icon{font-size:18px}
.office-iframe{flex:1;width:100%;border:none;min-height:0}
`;
let _officeCssInjected = false;
function _injectOfficeCss() {
  if (_officeCssInjected) return;
  const el = document.createElement("style");
  el.textContent = _OFFICE_HEADER_CSS;
  document.head.appendChild(el);
  _officeCssInjected = true;
}
function renderOffice(data) {
  _injectOfficeCss();
  const wrap = document.getElementById("cp-code-wrap");
  const kb = data.size ? (data.size / 1024).toFixed(1) + " KB" : "";
  const fname = (data.path || "").split("/").pop();
  const jobId = codeState.jobId || "";
  const dlUrl = `/file?job=${encodeURIComponent(jobId)}&path=${encodeURIComponent(data.path || "")}&raw=1`;
  const iconMap = { xlsx: "\u{1F4CA}", docx: "\u{1F4DD}", pptx: "\u{1F4CB}", legacy: data.office_icon || "\u{1F4C4}" };
  const icon = iconMap[data.office_type] || "\u{1F4C4}";
  if (data.office_type === "legacy") {
    wrap.innerHTML = `
<div class="office-wrap">
  <div class="office-header">
    <span class="office-icon">${icon}</span>
    <span style="flex:1;color:var(--fg);font-weight:500">${escapeHtml(fname)}</span>
    <span>${escapeHtml(kb)}</span>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--muted)">
    <div style="font-size:48px">${icon}</div>
    <div style="font-size:13px;text-align:center">Legacy Office format \u2014 preview not supported.<br>Please open in Microsoft Office or LibreOffice.</div>
    <a href="${dlUrl}" download="${escapeHtml(fname)}" style="color:var(--accent);font-size:13px;text-decoration:none">\u2B07 Download ${escapeHtml(fname)}</a>
  </div>
</div>`;
    wrap.style.display = "";
    codeState.funcLineMap = {};
    codeState.funcList = [];
    return;
  }
  if (!data.srcdoc) {
    wrap.innerHTML = `<div style="color:var(--muted);padding:20px">Office preview unavailable</div>`;
    wrap.style.display = "";
    return;
  }
  const srcdocAttr = data.srcdoc.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  wrap.innerHTML = `
<div class="office-wrap">
  <div class="office-header">
    <span class="office-icon">${icon}</span>
    <span style="flex:1;color:var(--fg);font-weight:500">${escapeHtml(fname)}</span>
    <span>${escapeHtml(kb)}</span>
    <a href="${dlUrl}" download="${escapeHtml(fname)}" style="color:var(--accent);text-decoration:none">\u2B07 Download</a>
  </div>
  <iframe class="office-iframe" srcdoc="${srcdocAttr}"
          sandbox="allow-scripts"
          title="${escapeHtml(fname)}"></iframe>
</div>`;
  wrap.style.display = "";
  codeState.funcLineMap = {};
  codeState.funcList = [];
}
