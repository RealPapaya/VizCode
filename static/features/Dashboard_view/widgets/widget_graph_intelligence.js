// @module Dashboard_view/widgets/widget_graph_intelligence
// Graph Intelligence: Hotspot Nodes and Surprising Connections.

function _dashRenderGraphIntelligence(container, stats) {
    if (!container) return;

    container.innerHTML = `
<div class="dash-grid dash-grid-2">
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashGraphHotspots'))}
    </div>
    <div class="dash-list" id="dash-graph-hotspots"></div>
  </div>
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashGraphSurprising'))}
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
  <span class="dash-list-name">${_dashEscape(item.label)}<span class="dash-list-meta">${_dashEscape(fileShort)}</span></span>
  <div class="dash-list-bar" style="width:${Math.round(item.degree / max * 60)}px"></div>
  <span class="dash-list-val">${item.degree}</span>
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
<div class="dash-list-row dash-list-row--stacked">
  <div class="dash-graph-pair">
    <span class="dash-graph-node">${_dashEscape(srcShort)}</span>
    <span class="dash-graph-arrow">&rarr;</span>
    <span class="dash-graph-node">${_dashEscape(tgtShort)}</span>
    <span class="dash-graph-score">score ${item.score}</span>
  </div>
  <div class="dash-graph-reason">${_dashEscape(item.reason)}</div>
</div>`;
    }).join('');
}

_dashRegisterWidget({
    id: 'graph_intelligence',
    labelKey: 'dashGraphHotspots',
    defaultSize: 'L',
    render(container, size, stats) { _dashRenderGraphIntelligence(container, stats); },
    renderDetail(container, stats) { _dashRenderGraphIntelligence(container, stats); },
});
