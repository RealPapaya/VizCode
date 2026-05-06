// @module Dashboard_view/widgets/widget_temporal
// Phase 2 orchestrator. Lays out the temporal sub-cards and delegates
// rendering to the per-card sub-widgets. Returns early when there is no git
// history or no commits in the analysed window.

function _dashRenderTemporal(container, stats) {
    if (!container) return;
    container.innerHTML = '';
    if (!stats.has_git_history) return;
    if (!stats.commits_analyzed) return;

    const periodHTML = `
<div class="dash-temporal-period">
  <span class="dash-temporal-period-label">${_dashEscape(_dashT('dashTemporalTitle'))}</span>
  <span class="dash-temporal-period-range">
    ${_dashEscape(stats.period_start)} &rarr; ${_dashEscape(stats.period_end)}
  </span>
  <span class="dash-temporal-period-meta">
    ${stats.commits_analyzed} ${_dashEscape(_dashT('dashTemporalCommits'))} &middot; ${stats.window_days}d
  </span>
</div>`;

    container.innerHTML = `
${periodHTML}
<div class="dash-grid dash-grid-2 dash-temporal-grid">
  <div class="dash-card" id="dash-temporal-hotspot"></div>
  <div class="dash-card" id="dash-temporal-coupling"></div>
  <div class="dash-card" id="dash-temporal-heatmap"></div>
  <div class="dash-card" id="dash-temporal-timeline"></div>
</div>`;

    _dashRenderTemporalHotspot(document.getElementById('dash-temporal-hotspot'), stats);
    _dashRenderTemporalCoupling(document.getElementById('dash-temporal-coupling'), stats);
    _dashRenderTemporalHeatmap(document.getElementById('dash-temporal-heatmap'), stats);
    _dashRenderTemporalTimeline(document.getElementById('dash-temporal-timeline'), stats);
}
