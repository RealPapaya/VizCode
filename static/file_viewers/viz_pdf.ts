// @module viz_pdf — PDF file viewer
// Owns: renderPDF
// Called by: viz_code_panel.js → renderFileContent

// Render PDF via embedded <object>
function renderPDF(data) {
    const wrap = document.getElementById('cp-code-wrap');
    const url = `data:application/pdf;base64,${data.data}`;
    const kb = data.size ? (data.size / 1024).toFixed(1) + ' KB' : '';
    wrap.innerHTML = `
<div style="display:flex;flex-direction:column;height:100%;padding:8px;gap:8px;box-sizing:border-box">
  <div style="font-size:11px;color:var(--muted);font-family:var(--code-font);flex-shrink:0">
    ${escapeHtml(data.path || '')} &nbsp;·&nbsp; ${escapeHtml(kb)}
    &nbsp;·&nbsp; <a href="${url}" download="${escapeHtml((data.path || '').split('/').pop())}"
       style="color:var(--accent);text-decoration:none">⬇ Download</a>
  </div>
  <object data="${url}" type="application/pdf"
          style="flex:1;width:100%;min-height:400px;border-radius:4px;border:1px solid var(--border);">
    <div style="padding:20px;color:var(--muted);text-align:center">
      <div style="font-size:32px;margin-bottom:12px">📄</div>
      <div>${T('browserCannotDisplayPdf')}</div>
      <div style="margin-top:8px"><a href="${url}" download style="color:var(--accent)">${T('downloadPdf')}</a></div>
    </div>
  </object>
</div>`;
    wrap.style.display = '';
    codeState.funcLineMap = {};
    codeState.funcList = [];
}
