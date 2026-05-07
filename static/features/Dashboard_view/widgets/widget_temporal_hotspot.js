// @module Dashboard_view/widgets/widget_temporal_hotspot
// Phase 2 — Hotspot files (churn × complexity ranking).

function _dashRenderTemporalHotspot(container, stats) {
    if (!container) return;

    const items = stats.hotspot_files || [];
    container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot" style="background:#fb923c"></span>${_dashEscape(_dashT('dashTemporalHotspot'))}
</div>
<div class="dash-list" id="dash-temporal-hotspot-list"></div>`;

    const list = document.getElementById('dash-temporal-hotspot-list');
    if (!list) return;
    if (!items.length) {
        list.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashTemporalEmpty'))}</div>`;
        return;
    }
    const max = items[0].score || 1;
    list.innerHTML = items.slice(0, 10).map((it, i) => {
        const fileShort = String(it.file || '').split('/').pop();
        const cxLabel = (it.avg_complexity != null) ? `cx ${it.avg_complexity}` : 'cx —';
        const fileJSON = JSON.stringify(it.file).replace(/"/g, '&quot;');
        return `
<div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(it.file)}"
     onclick="_dashOpenDrilldown(${fileJSON})">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(fileShort)}<span style="color:#64748b;font-size:11px;margin-left:6px">${cxLabel} · ${it.churn} commits</span></span>
  <div class="dash-list-bar" style="width:${Math.round(it.score / max * 60)}px;background:#fb923c"></div>
  <span class="dash-list-val" style="color:#fb923c">${it.score}</span>
</div>`;
    }).join('');
}
