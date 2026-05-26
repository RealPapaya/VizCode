// @module Dashboard_view/widgets/widget_graph_intelligence
// Graph Intelligence: Hotspot Nodes and Surprising Connections.

function _dashRenderGraphIntelligence(container, stats, opts) {
    if (!container) return;
    const isDetail = !!(opts && opts.detail);

    container.innerHTML = `
<div class="${isDetail ? 'dash-detail-grid dash-detail-grid-2' : ''}" style="${isDetail ? '' : 'height:100%;'}display:grid;${isDetail ? '' : 'grid-template-columns:1fr 1fr;'}gap:var(--space-3);${isDetail ? '' : 'overflow:hidden;'}">
  <div class="dash-card${isDetail ? ' dash-detail-section' : ''}" style="${isDetail ? '' : 'display:flex;flex-direction:column;overflow:hidden;min-height:0;'}">
    <div class="dash-card-title">
      <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashGraphHotspots'))}
    </div>
    <div class="dash-list${isDetail ? ' dash-detail-flow-list' : ''}" id="dash-graph-hotspots" style="${isDetail ? '' : 'flex:1;overflow:hidden;'}"></div>
  </div>
  <div class="dash-card${isDetail ? ' dash-detail-section' : ''}" style="${isDetail ? '' : 'display:flex;flex-direction:column;overflow:hidden;min-height:0;'}">
    <div class="dash-card-title">
      <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashGraphSurprising'))}
    </div>
    <div class="dash-list${isDetail ? ' dash-detail-flow-list' : ''}" id="dash-graph-surprising" style="${isDetail ? '' : 'flex:1;overflow:hidden;'}"></div>
  </div>
</div>`;

    _dashRenderHotspots(stats.hotspot_nodes || [], container);
    _dashRenderSurprising(stats.surprising_connections || [], container);
}

function _dashRenderHotspots(items, root) {
    const el = (root || document).querySelector('#dash-graph-hotspots');
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
  <div class="dash-list-bar-track"><div class="dash-list-bar-fill" style="width:${Math.round(item.degree / max * 100)}%"></div></div>
  <span class="dash-list-val">${item.degree}</span>
</div>`;
    }).join('');
}

function _dashRenderSurprising(items, root) {
    const el = (root || document).querySelector('#dash-graph-surprising');
    if (!el) return;
    if (!items.length) {
        el.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashGraphSurprisingEmpty'))}</div>`;
        return;
    }
    el.innerHTML = items.map(item => {
        const srcShort = String(item.source || '').split('/').pop();
        const tgtShort = String(item.target || '').split('/').pop();
        return `
<div class="dash-list-row dash-list-row--stacked" data-clickable="true"
     onclick="_dashOpenFileGroupDrilldown('Surprising connection', [${_dashJson(item.source)}, ${_dashJson(item.target)}])">
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

    render(container, size, stats) {
        if (size === 'S') {
            const items = stats.hotspot_nodes || [];
            const top   = items[0];
            const pills = items.slice(0, 3).map(item => ({
                label: String(item.label || item.file || '').split('/').pop(),
                value: item.degree,
                title: item.file || '',
                onclick: `_dashGoToGraphFile(${_dashJson(item.file || '')}, null)`,
            }));
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Hotspots</div>
    <div class="dash-widget-stat">${items.length}</div>
    <div class="dash-widget-sub">hotspot nodes</div>
    ${_dashMiniPills(pills)}
  </div>
</div>`;
            return;
        }

        if (size === 'M') {
            container.innerHTML = `
<div style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:var(--space-2);overflow:hidden;">
  <div class="dash-card-title">
    <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashGraphHotspots'))}
  </div>
  <div class="dash-list" id="dash-graph-hotspots" style="flex:1;overflow:hidden;"></div>
</div>`;
            _dashRenderHotspots((stats.hotspot_nodes || []).slice(0, 5), container);
            return;
        }

        _dashRenderGraphIntelligence(container, stats);
    },

    renderDetail(container, stats) { _dashRenderGraphIntelligence(container, stats, { detail: true }); },
});
