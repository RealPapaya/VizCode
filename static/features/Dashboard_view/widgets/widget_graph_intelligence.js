// @module Dashboard_view/widgets/widget_graph_intelligence
// Graph Intelligence: Hotspot Nodes and Surprising Connections.

function _dashRenderGraphIntelligence(container, stats) {
    if (!container) return;
    const hotspots = stats.hotspot_nodes || [];
    const surprising = stats.surprising_connections || [];

    container.innerHTML = `
<div class="dash-arch-panel dash-graph-intelligence-panel">
  <div class="dash-arch-panel-header">
    <div class="dash-arch-panel-title-block">
      <div class="dash-arch-panel-title">${_dashEscape(_dashT('dashGraphHotspots'))}</div>
      <div class="dash-arch-panel-sub">${_dashFmtNum(hotspots.length)} hotspot nodes &middot; ${_dashFmtNum(surprising.length)} surprising connections</div>
    </div>
  </div>
  <div class="dash-arch-panel-body">
    <div class="dash-graph-intel-grid">
      <section class="dash-graph-intel-section">
        <div class="dash-graph-intel-section-title">
          ${_dashEscape(_dashT('dashGraphHotspots'))}
        </div>
        <div class="dash-graph-hotspot-list" id="dash-graph-hotspots"></div>
      </section>
      <section class="dash-graph-intel-section">
        <div class="dash-graph-intel-section-title">
          ${_dashEscape(_dashT('dashGraphSurprising'))}
        </div>
        <div class="dash-graph-link-list" id="dash-graph-surprising"></div>
      </section>
    </div>
  </div>
</div>`;

    _dashRenderHotspotsLarge(hotspots, container);
    _dashRenderSurprising(surprising, container);
}

function _dashRenderHotspotsLarge(items, root) {
    const el = (root || document).querySelector('#dash-graph-hotspots');
    if (!el) return;
    if (!items.length) {
        el.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashGraphHotspotsEmpty'))}</div>`;
        return;
    }
    const max = items[0]?.degree || 1;
    el.innerHTML = items.map((item, i) => {
        const file = String(item.file || '').replace(/\\/g, '/');
        const fileShort = file.split('/').pop();
        const fileJSON = JSON.stringify(item.file || '').replace(/"/g, '&quot;');
        const pct = Math.max(4, Math.round((item.degree || 0) / max * 100));
        return `
<div class="dash-graph-hotspot-row" data-clickable="true" title="${_dashEscape(file)}"
     onclick="_dashDrill(${fileJSON}, null)">
  <span class="dash-graph-hotspot-rank">${String(i + 1).padStart(2, '0')}</span>
  <div class="dash-graph-hotspot-main">
    <div class="dash-graph-hotspot-name">${_dashEscape(item.label || fileShort || '')}</div>
    <div class="dash-graph-hotspot-file">${_dashEscape(fileShort || file)}</div>
    <div class="dash-graph-hotspot-meter"><i style="width:${pct}%"></i></div>
  </div>
  <span class="dash-graph-hotspot-degree">${_dashEscape(item.degree ?? 0)}</span>
</div>`;
    }).join('');
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
        const fileJSON = JSON.stringify(item.file || '').replace(/"/g, '&quot;');
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
        const title = `${srcShort} -> ${tgtShort}`;
        return `
<div class="dash-graph-link-row" data-clickable="true" title="${_dashEscape(title)}"
     onclick="_dashOpenFileGroupDrilldown('Surprising connection', [${_dashJson(item.source)}, ${_dashJson(item.target)}])">
  <div class="dash-graph-link-head">
    <span class="dash-graph-node">${_dashEscape(srcShort)}</span>
    <span class="dash-graph-arrow">&rarr;</span>
    <span class="dash-graph-node">${_dashEscape(tgtShort)}</span>
    <span class="dash-graph-score">${_dashEscape(item.score ?? '')}</span>
  </div>
  <div class="dash-graph-reason">${_dashEscape(item.reason || '')}</div>
</div>`;
    }).join('');
}


// ── Detail panel (dash-kpi-detail--graph-intel) ───────────────────────────
function _dashGraphIntelRenderDetail(container, stats) {
    if (!container) return;
    const hotspots   = stats.hotspot_nodes          || [];
    const surprising = stats.surprising_connections || [];
    const maxDegree  = hotspots.length ? (hotspots[0].degree || 0) : 0;

    // Hero visual: top-3 pill stack
    const pillsHTML = hotspots.slice(0, 3).map((item, i) => {
        const fileShort = String(item.file || '').replace(/\\/g, '/').split('/').pop();
        const fileJSON  = JSON.stringify(item.file || '').replace(/"/g, '&quot;');
        return `<div class="dash-graph-intel-pill" data-clickable="true"
     onclick="_dashDrill(${fileJSON}, null)">
  <span class="dash-graph-intel-pill__name">${_dashEscape(item.label || '')}</span>
  <span class="dash-graph-intel-pill__file">${_dashEscape(fileShort)}</span>
  <span class="dash-graph-intel-pill__badge">${item.degree}</span>
</div>`;
    }).join('') || `<div class="dash-empty" style="font-size:11px">${_dashEscape(_dashT('dashGraphHotspotsEmpty'))}</div>`;

    const summaryText = hotspots.length === 0
        ? 'No hotspot symbols detected.'
        : `${hotspots.length} hotspot symbol${hotspots.length !== 1 ? 's' : ''}` +
          (surprising.length > 0 ? ` · ${surprising.length} surprising connection${surprising.length !== 1 ? 's' : ''}.` : '.');

    // Hotspot rows (full list)
    const max = maxDegree || 1;
    const hotspotRows = hotspots.length ? hotspots.map((item, i) => {
        const fileShort = String(item.file || '').replace(/\\/g, '/').split('/').pop();
        const fileJSON  = JSON.stringify(item.file || '').replace(/"/g, '&quot;');
        return `<div class="dash-list-row" data-clickable="true"
     onclick="_dashDrill(${fileJSON}, null)">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(item.label || '')}<span class="dash-list-meta">${_dashEscape(fileShort)}</span></span>
  <div class="dash-list-bar-track"><div class="dash-list-bar-fill" style="width:${Math.round(item.degree / max * 100)}%"></div></div>
  <span class="dash-list-val">${item.degree}</span>
</div>`;
    }).join('') : `<div class="dash-empty">${_dashEscape(_dashT('dashGraphHotspotsEmpty'))}</div>`;

    // Surprising rows (full list)
    const surprisingRows = surprising.length ? surprising.map(item => {
        const srcShort = String(item.source || '').split('/').pop();
        const tgtShort = String(item.target || '').split('/').pop();
        return `<div class="dash-list-row dash-list-row--stacked" data-clickable="true"
     onclick="_dashOpenFileGroupDrilldown('Surprising connection', [${_dashJson(item.source)}, ${_dashJson(item.target)}])">
  <div class="dash-graph-pair">
    <span class="dash-graph-node">${_dashEscape(srcShort)}</span>
    <span class="dash-graph-arrow">&rarr;</span>
    <span class="dash-graph-node">${_dashEscape(tgtShort)}</span>
    <span class="dash-graph-score">score ${item.score}</span>
  </div>
  <div class="dash-graph-reason">${_dashEscape(item.reason || '')}</div>
</div>`;
    }).join('') : `<div class="dash-empty">${_dashEscape(_dashT('dashGraphSurprisingEmpty'))}</div>`;

    container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--graph-intel">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Structural coupling signals</div>
      <h2 class="dash-kpi-detail__title">Graph Intelligence</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value">${hotspots.length}</span>
        <span class="dash-kpi-detail__primary-suffix">hotspot symbols</span>
      </div>
      <p class="dash-kpi-detail__summary">${_dashEscape(summaryText)}</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">
      <div class="dash-graph-intel-pills">${pillsHTML}</div>
    </div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
    title: 'Snapshot',
    body: _dashKpiDetailStatsHTML([
        { value: String(hotspots.length),   label: 'hotspot symbols' },
        { value: String(surprising.length), label: 'surprising connections' },
        { value: String(maxDegree),         label: 'max in-degree' },
    ]),
})}
${_dashKpiDetailGridHTML([
    _dashKpiDetailSectionHTML({
        title: `Hotspot Nodes (${hotspots.length})`,
        body: `<div class="dash-graph-intel-detail-list">${hotspotRows}</div>`,
    }),
    _dashKpiDetailSectionHTML({
        title: `Surprising Connections (${surprising.length})`,
        body: `<div class="dash-graph-intel-detail-list">${surprisingRows}</div>`,
    }),
], { columns: 2 })}
  </div>
</div>`;
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

    renderDetail(container, stats) { _dashGraphIntelRenderDetail(container, stats); },
});
