// @module Dashboard_view/widgets/widget_graph_intelligence
// Graph Intelligence: Hotspot Nodes and Surprising Connections.

function _dashRenderGraphIntelligence(container, stats) {
    if (!container) return;

    container.innerHTML = `
<div class="dash-grid dash-grid-2">
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot" style="background:#60a5fa"></span>${_dashEscape(_dashT('dashGraphHotspots'))}
    </div>
    <div class="dash-list" id="dash-graph-hotspots"></div>
  </div>
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot" style="background:#f472b6"></span>${_dashEscape(_dashT('dashGraphSurprising'))}
    </div>
    <div class="dash-list" id="dash-graph-surprising"></div>
  </div>
</div>`;

    _dashRenderHotspots(stats.hotspot_nodes || []);
    _dashRenderSurprising(stats.surprising_connections || []);
}

function _dashRenderHotspots(items) {
    const el = document.getElementById('dash-graph-hotspots');
    if (!el) return;
    if (!items.length) {
        el.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashGraphHotspotsEmpty'))}</div>`;
        return;
    }
    const max = items[0]?.degree || 1;
    el.innerHTML = items.map((item, i) => {
        const fileShort = String(item.file || '').replace(/\\/g, '/').split('/').pop();
        const fileJSON = JSON.stringify(item.file).replace(/"/g, '&quot;');
        return `
<div class="dash-list-row" data-clickable="true"
     onclick="_dashDrill(${fileJSON}, null)">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(item.label)}<span style="color:#64748b;font-size:11px;margin-left:4px">${_dashEscape(fileShort)}</span></span>
  <div class="dash-list-bar" style="width:${Math.round(item.degree / max * 60)}px;background:#60a5fa"></div>
  <span class="dash-list-val" style="color:#60a5fa">${item.degree}</span>
</div>`;
    }).join('');
}

function _dashRenderSurprising(items) {
    const el = document.getElementById('dash-graph-surprising');
    if (!el) return;
    if (!items.length) {
        el.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashGraphSurprisingEmpty'))}</div>`;
        return;
    }
    el.innerHTML = items.map(item => {
        const srcShort = String(item.source || '').split('/').pop();
        const tgtShort = String(item.target || '').split('/').pop();
        return `
<div class="dash-list-row" style="flex-direction:column;align-items:flex-start;gap:2px;padding:6px 8px">
  <div style="display:flex;align-items:center;gap:6px;width:100%">
    <span style="color:#f472b6;font-size:11px;font-weight:600">${_dashEscape(srcShort)}</span>
    <span style="color:#64748b">&rarr;</span>
    <span style="color:#f472b6;font-size:11px;font-weight:600">${_dashEscape(tgtShort)}</span>
    <span style="margin-left:auto;background:#1e293b;border-radius:4px;padding:1px 6px;font-size:11px;color:#f472b6">score ${item.score}</span>
  </div>
  <div style="color:#64748b;font-size:11px">${_dashEscape(item.reason)}</div>
</div>`;
    }).join('');
}
