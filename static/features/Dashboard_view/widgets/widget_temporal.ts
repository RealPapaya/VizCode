// @ts-nocheck -- JS->TS migration: renamed to .ts, type-curation pending. Remove this line and fix errors to enable checking.
// @module Dashboard_view/widgets/widget_temporal
// Phase 2 orchestrator. Lays out the temporal sub-cards and delegates
// rendering to the per-card sub-widgets. Returns early when there is no git
// history or no commits in the analysed window.

let _dashTemporalDays = 180; // currently-selected window (0 = show all)

function _dashTemporalId(base, scope) {
    return scope ? `${base}-${scope}` : base;
}

function _dashTemporalFind(container, base, scope) {
    return container?.querySelector(`#${_dashTemporalId(base, scope)}`) || null;
}

function _dashRenderTemporal(container, stats, size, scope) {
    if (!container) return;
    container.innerHTML = '';
    if (!stats.has_git_history) return;
    if (!stats.commits_analyzed) return;

    const latestActivity = String(stats.period_end || '');
    const recentCutoff = new Date();
    recentCutoff.setUTCDate(recentCutoff.getUTCDate() - 180);
    const recentCutoffDate = `${recentCutoff.getUTCFullYear()}-${String(recentCutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(recentCutoff.getUTCDate()).padStart(2, '0')}`;
    _dashTemporalDays = latestActivity && latestActivity < recentCutoffDate
        ? 0
        : Math.min(Number(stats.window_days || 180), 180);

    if (size === 'S') {
        const topFiles = (stats.file_churn || []).slice(0, 3).map(f => ({
            label: String(f.file || '').split('/').pop(),
            value: f.commits,
            title: f.file,
            onclick: `_dashGoToGraphFile(${_dashJson(f.file)}, null)`,
        }));
        container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashTemporalTitle'))}</div>
    <div class="dash-widget-stat">${_dashFmtNum(stats.commits_analyzed || 0)}</div>
    <div class="dash-widget-sub">${_dashEscape(stats.period_start || '')} &rarr; ${_dashEscape(stats.period_end || '')}</div>
    ${_dashMiniPills(topFiles, { empty: _dashT('dashTemporalEmpty') })}
  </div>
</div>`;
        return;
    }

    if (size === 'M') {
        container.innerHTML = `
<div class="dash-grid dash-grid-2" style="height:100%;box-sizing:border-box;">
  <div class="dash-card" id="${_dashTemporalId('dash-temporal-heatmap', scope)}"></div>
  <div class="dash-card" id="${_dashTemporalId('dash-temporal-authors', scope)}"></div>
</div>`;
        const filtered = _dashTemporalFilteredStats(stats);
        _dashRenderTemporalHeatmap(_dashTemporalFind(container, 'dash-temporal-heatmap', scope), filtered);
        _dashRenderTemporalAuthors(_dashTemporalFind(container, 'dash-temporal-authors', scope), stats);
        return;
    }

    container.innerHTML = _dashTemporalShell(stats, scope);

    container.querySelectorAll('.dash-temporal-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            const days = Number(btn.dataset.days);
            _dashTemporalDays = days;
            container.querySelectorAll('.dash-temporal-pill').forEach(b =>
                b.classList.toggle('active', b === btn)
            );
            _dashTemporalRefreshSubs(container, stats, scope);
        });
    });

    _dashTemporalRefreshSubs(container, stats, scope);
}

function _dashTemporalFilteredStats(stats) {
    if (!_dashTemporalDays) return stats;

    const cutoffDate = (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - _dashTemporalDays);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    })();

    const daily  = (stats.commit_activity_daily || []).filter(r => (r.date || '') >= cutoffDate);
    const weekly = (stats.churn_timeline || []).filter(r => (r.week_start || '') >= cutoffDate);

    return Object.assign({}, stats, {
        commit_activity_daily: daily,
        churn_timeline: weekly,
        window_start: cutoffDate,
        window_end: stats.window_end || stats.period_end,
        window_days: _dashTemporalDays,
    });
}

function _dashTemporalRefreshSubs(container, stats, scope) {
    const filtered = _dashTemporalFilteredStats(stats);
    _dashRenderTemporalHotspot(_dashTemporalFind(container, 'dash-temporal-hotspot', scope), stats);
    _dashRenderTemporalCoupling(_dashTemporalFind(container, 'dash-temporal-coupling', scope), stats);
    _dashRenderTemporalHeatmap(_dashTemporalFind(container, 'dash-temporal-heatmap', scope), filtered);
    _dashRenderTemporalTimeline(_dashTemporalFind(container, 'dash-temporal-timeline', scope), filtered, scope);
    _dashRenderTemporalAuthors(_dashTemporalFind(container, 'dash-temporal-authors', scope), stats);
}

function _dashTemporalShell(stats, scope) {
    const isDetail = String(scope || '').includes('detail');
    const maxDays = Number(stats.window_days || 180);
    const pills = [30, 90, 180]
        .filter(d => d <= maxDays)
        .concat(0)
        .map(d => {
            const label = d ? `${d}d` : _dashEscape(_dashT('dashTemporalAll') || 'All');
            const active = (d === _dashTemporalDays) ? ' active' : '';
            return `<button class="dash-temporal-pill${active}" data-days="${d}">${label}</button>`;
        }).join('');

    const period = `
<div class="dash-temporal-period">
  <span class="dash-temporal-period-label">${_dashEscape(_dashT('dashTemporalTitle'))}</span>
  <span class="dash-temporal-period-range">
    ${_dashEscape(stats.period_start)} &rarr; ${_dashEscape(stats.period_end)}
  </span>
  <span class="dash-temporal-period-meta">
    ${stats.commits_analyzed} ${_dashEscape(_dashT('dashTemporalCommits'))} &middot; ${stats.window_days}d
  </span>
  <span class="dash-temporal-pills">${pills}</span>
</div>`;
    if (isDetail) {
        return `
${_dashReportSection({ title: _dashT('dashTemporalTitle'), body: period })}
<div class="dash-report-grid dash-report-grid--2 dash-temporal-grid">
  <section class="dash-report-section" id="${_dashTemporalId('dash-temporal-hotspot', scope)}"></section>
  <section class="dash-report-section" id="${_dashTemporalId('dash-temporal-coupling', scope)}"></section>
  <section class="dash-report-section" id="${_dashTemporalId('dash-temporal-heatmap', scope)}"></section>
  <section class="dash-report-section" id="${_dashTemporalId('dash-temporal-timeline', scope)}"></section>
  <section class="dash-report-section" id="${_dashTemporalId('dash-temporal-authors', scope)}"></section>
</div>`;
    }
    return `
${period}
<div class="dash-grid dash-grid-2 dash-temporal-grid">
  <div class="dash-card" id="${_dashTemporalId('dash-temporal-hotspot', scope)}"></div>
  <div class="dash-card" id="${_dashTemporalId('dash-temporal-coupling', scope)}"></div>
  <div class="dash-card" id="${_dashTemporalId('dash-temporal-heatmap', scope)}"></div>
  <div class="dash-card" id="${_dashTemporalId('dash-temporal-timeline', scope)}"></div>
  <div class="dash-card" id="${_dashTemporalId('dash-temporal-authors', scope)}"></div>
</div>`;
}

_dashRegisterWidget({
    id: 'temporal',
    labelKey: 'dashTemporalTitle',
    descriptionKey: 'dashDescTemporal',
    defaultSize: 'L',
    deprecated: true,
    render(container, size, stats) { _dashRenderTemporal(container, stats, size); },
    renderDetail(container, stats) { _dashRenderTemporal(container, stats, 'L', 'detail'); },
});
