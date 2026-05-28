// @module Dashboard_view/widgets/widget_temporal_timeline
// Phase 2 — Code Churn Timeline. Line chart of commits per week with
// secondary additions/deletions overlay. Toggleable to bar chart.

const _DASH_TIMELINE_KEY = 'temporal_timeline';
const _DASH_TIMELINE_TYPES = ['line', 'bar'];
const _DASH_TIMELINE_DEFAULT = 'line';
let _dashTimelineWidgetSeq = 0;

function _dashTimelineId(scope) {
    return scope ? `dash-chart-timeline-${scope}` : 'dash-chart-timeline';
}

function _dashTimelineKey(scope) {
    return scope ? `${_DASH_TIMELINE_KEY}_${scope}` : _DASH_TIMELINE_KEY;
}

function _dashTimelineStandaloneScope(container, suffix) {
    if (!container) return suffix || 'standalone';
    if (!container.dataset.dashTimelineScope) {
        _dashTimelineWidgetSeq += 1;
        container.dataset.dashTimelineScope = `standalone-${suffix || 'main'}-${_dashTimelineWidgetSeq}`;
    }
    return container.dataset.dashTimelineScope;
}

function _dashRenderTemporalTimeline(container, stats, scope) {
    if (!container) return;

    const buckets = stats.churn_timeline || [];
    const key = _dashTimelineKey(scope);
    const isDetail = String(scope || '').includes('detail');
    const isReport = container.classList.contains('dash-report-section');

    container.innerHTML = isReport ? `
<div class="dash-report-section-head">
  <div class="dash-report-section-title">${_dashEscape(_dashT('dashTemporalChurn'))}</div>
  <div class="dash-report-section-subtitle">${_dashChartToggleHTML(key, _DASH_TIMELINE_TYPES, _DASH_TIMELINE_DEFAULT)}</div>
</div>
<div class="dash-report-section-body">
  ${_dashReportChart(`<canvas id="${_dashTimelineId(scope)}"></canvas>`, { size: isDetail ? 'lg' : 'md' })}
</div>` : `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashTemporalChurn'))}
  ${_dashChartToggleHTML(key, _DASH_TIMELINE_TYPES, _DASH_TIMELINE_DEFAULT)}
</div>
<div class="dash-chart-wrap dash-timeline-chart-wrap"><canvas id="${_dashTimelineId(scope)}"></canvas></div>`;

    if (!buckets.length) {
        const wrap = container.querySelector('.dash-chart-wrap');
        if (wrap) wrap.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashTemporalEmpty'))}</div>`;
        return;
    }

    _dashRegisterChartSwitch(key, () =>
        _dashRenderTemporalTimeline(container, stats, scope)
    );

    _dashDrawTimelineChart(buckets, scope);
}

function _dashDrawTimelineChart(buckets, scope) {
    const canvas = document.getElementById(_dashTimelineId(scope));
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = buckets.map(b => b.week_start);
    const commits = buckets.map(b => b.commits);
    const additions = buckets.map(b => b.additions);
    const deletions = buckets.map(b => -Math.abs(b.deletions));   // negative for visual diff

    const type = _dashChartCurrentType(_dashTimelineKey(scope), _DASH_TIMELINE_DEFAULT);

    _dashMkChart(canvas, type, {
        labels,
        datasets: [
            {
                label: _dashT('dashTemporalCommits'),
                data: commits,
                yAxisID: 'yCommits',
                borderColor: _dashAccentTint(1.0),
                backgroundColor: _dashAccentTint(0.25),
                borderWidth: 2,
                tension: 0.25,
                pointRadius: 3,
                fill: type === 'line',
            },
            {
                label: _dashT('dashTemporalAdditions'),
                data: additions,
                yAxisID: 'yLines',
                borderColor: _dashAccentTint(0.55),
                backgroundColor: _dashAccentTint(0.12),
                borderWidth: 1.5,
                tension: 0.25,
                pointRadius: 2,
                fill: false,
                hidden: false,
            },
            {
                label: _dashT('dashTemporalDeletions'),
                data: deletions,
                yAxisID: 'yLines',
                borderColor: _dashMutedTint(0.7),
                backgroundColor: _dashMutedTint(0.15),
                borderWidth: 1.5,
                tension: 0.25,
                pointRadius: 2,
                fill: false,
                hidden: false,
            },
        ],
    }, {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'top', labels: { boxWidth: 10, padding: 10 } },
        },
        scales: {
            x: {
                grid: { color: _dashBorderTint(0.6) },
                ticks: { maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            },
            yCommits: {
                position: 'left',
                grid: { color: _dashBorderTint(0.6) },
                ticks: { color: _dashAccentTint(1.0) },
                title: { display: true, text: _dashT('dashTemporalCommits'), color: _dashAccentTint(1.0) },
                beginAtZero: true,
            },
            yLines: {
                position: 'right',
                grid: { display: false },
                title: { display: true, text: '+/-' },
            },
        },
    });
}

function _dashRenderChurnTimelineWidget(container, size, stats, suffix) {
    if (!container) return;
    const buckets = stats.churn_timeline || [];

    if (size === 'S') {
        const latest = buckets[buckets.length - 1] || {};
        const totalAdds = buckets.reduce((sum, b) => sum + Number(b.additions || 0), 0);
        const totalDels = buckets.reduce((sum, b) => sum + Number(b.deletions || 0), 0);
        container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashTemporalChurn'))}</div>
    <div class="dash-widget-stat">${_dashFmtNum(stats.commits_analyzed || 0)}</div>
    <div class="dash-widget-sub">${_dashEscape(latest.week_start || stats.period_end || '')}</div>
    ${_dashMiniPills([
            { label: '+', value: _dashFmtNum(totalAdds), title: _dashT('dashTemporalAdditions') },
            { label: '-', value: _dashFmtNum(totalDels), title: _dashT('dashTemporalDeletions') },
            { label: 'Weeks', value: buckets.length },
        ])}
  </div>
</div>`;
        return;
    }

    _dashRenderTemporalTimeline(container, stats, _dashTimelineStandaloneScope(container, suffix));
}

function _dashChurnTimelineTotals(buckets) {
    return (buckets || []).reduce((acc, row) => {
        acc.commits += Number(row.commits || 0);
        acc.additions += Number(row.additions || 0);
        acc.deletions += Number(row.deletions || 0);
        return acc;
    }, { commits: 0, additions: 0, deletions: 0 });
}

function _dashChurnTimelinePeakWeek(buckets) {
    return (buckets || []).reduce((best, row) => (
        Number(row.commits || 0) > Number(best.commits || 0) ? row : best
    ), {});
}

function _dashChurnTimelineWeekBarsHTML(buckets) {
    const rows = (buckets || []).slice(-8);
    if (!rows.length) return `<div class="dash-empty">${_dashEscape(_dashT('dashTemporalEmpty'))}</div>`;
    const max = rows.reduce((m, row) => Math.max(m, Number(row.commits || 0)), 1);
    return `
<div class="dash-churn-timeline-detail-bars">
  ${rows.map(row => {
        const commits = Number(row.commits || 0);
        const pct = Math.max(4, Math.round((commits / max) * 100));
        return `<div class="dash-churn-timeline-detail-bars__row">
    <span>${_dashEscape(row.week_start || '')}</span>
    <div><i style="width:${pct}%"></i></div>
    <b>${_dashFmtNum(commits)}</b>
  </div>`;
    }).join('')}
</div>`;
}

function _dashChurnTimelineFileRowsHTML(stats, limit) {
    const rows = (stats.file_churn || []).slice(0, limit);
    if (!rows.length) return '<div class="dash-empty">No changed files</div>';
    const max = rows.reduce((m, row) => Math.max(m, Number(row.commits || 0)), 1);
    return rows.map((row, i) => {
        const file = String(row.file || '');
        const short = file.split('/').pop() || file;
        const commits = Number(row.commits || 0);
        const pct = Math.max(4, Math.round((commits / max) * 100));
        return `
  <div class="dash-churn-timeline-detail-file" data-clickable="true" data-tip="${_dashEscape(file)}"
       onclick="_dashGoToGraphFile(${_dashJson(file)}, null)">
    <span class="dash-churn-timeline-detail-file__rank">${i + 1}</span>
    <span class="dash-churn-timeline-detail-file__name">${_dashEscape(short)}<small>${_dashEscape(file)} &middot; +${_dashFmtNum(row.additions || 0)} / -${_dashFmtNum(row.deletions || 0)}</small></span>
    <div class="dash-churn-timeline-detail-file__track"><i style="width:${pct}%"></i></div>
    <span class="dash-churn-timeline-detail-file__value">${_dashFmtNum(commits)}</span>
  </div>`;
    }).join('');
}

function _dashChurnTimelineStatsHTML(buckets, totals, peak) {
    return `
<div class="dash-churn-timeline-detail-stats">
  <div><span>${_dashFmtExactNum(totals.commits)}</span><small>Commits</small></div>
  <div><span>${_dashFmtExactNum(buckets.length)}</span><small>Weeks</small></div>
  <div><span>+${_dashFmtExactNum(totals.additions)}</span><small>Additions</small></div>
  <div><span>-${_dashFmtExactNum(totals.deletions)}</span><small>Deletions</small></div>
  <div><span>${_dashFmtExactNum(peak.commits || 0)}</span><small>Peak week</small></div>
</div>`;
}

_dashRegisterWidget({
    id: 'churn_timeline',
    labelKey: 'dashTemporalChurn',
    descriptionKey: 'dashDescChurnTimeline',
    defaultSize: 'L',
    render(container, size, stats) {
        _dashRenderChurnTimelineWidget(container, size, stats, 'widget');
    },
    renderDetail(container, stats) {
        const buckets = stats.churn_timeline || [];
        const totals = _dashChurnTimelineTotals(buckets);
        const peak = _dashChurnTimelinePeakWeek(buckets);
        const chartKey = _dashTimelineKey('detail');
        const chartId = _dashTimelineId('detail');
        const rangeLabel = [stats.period_start, stats.period_end].filter(Boolean).join(' to ');
        const summary = buckets.length
            ? `${_dashFmtExactNum(buckets.length)} weekly buckets${rangeLabel ? ` from ${_dashEscape(rangeLabel)}` : ''}. Peak week ${_dashEscape(peak.week_start || 'n/a')} has ${_dashFmtExactNum(peak.commits || 0)} commits.`
            : _dashEscape(_dashT('dashTemporalEmpty'));

        container.innerHTML = `
<div class="dash-churn-timeline-detail">
  <section class="dash-churn-timeline-detail__hero">
    <div class="dash-churn-timeline-detail__hero-copy">
      <div class="dash-churn-timeline-detail__eyebrow">Code churn</div>
      <h2 class="dash-churn-timeline-detail__title">${_dashEscape(_dashT('dashTemporalChurn'))}</h2>
      <div class="dash-churn-timeline-detail__primary">
        <span class="dash-churn-timeline-detail__primary-value">${_dashFmtExactNum(totals.commits || stats.commits_analyzed || 0)}</span>
        <span class="dash-churn-timeline-detail__primary-suffix">commits</span>
      </div>
      <p class="dash-churn-timeline-detail__summary">${summary} Net line movement is +${_dashFmtExactNum(totals.additions)} / -${_dashFmtExactNum(totals.deletions)}.</p>
    </div>
    <div class="dash-churn-timeline-detail__hero-visual">${_dashChurnTimelineWeekBarsHTML(buckets)}</div>
  </section>
  <div class="dash-churn-timeline-detail__sections">
    <section class="dash-churn-timeline-detail-section">
      <div class="dash-churn-timeline-detail-section__head">
        <div class="dash-churn-timeline-detail-section__title">Weekly Churn</div>
        <div class="dash-churn-timeline-detail-section__tools">${_dashChartToggleHTML(chartKey, _DASH_TIMELINE_TYPES, _DASH_TIMELINE_DEFAULT)}</div>
      </div>
      <div class="dash-churn-timeline-detail-section__body">
        <div class="dash-chart-wrap dash-churn-timeline-detail-chart">${buckets.length ? `<canvas id="${chartId}"></canvas>` : `<div class="dash-empty">${_dashEscape(_dashT('dashTemporalEmpty'))}</div>`}</div>
      </div>
    </section>
    <section class="dash-churn-timeline-detail-section">
      <div class="dash-churn-timeline-detail-section__head">
        <div class="dash-churn-timeline-detail-section__title">Churn Summary</div>
      </div>
      <div class="dash-churn-timeline-detail-section__body">${_dashChurnTimelineStatsHTML(buckets, totals, peak)}</div>
    </section>
    <section class="dash-churn-timeline-detail-section">
      <div class="dash-churn-timeline-detail-section__head">
        <div class="dash-churn-timeline-detail-section__title">Top Churn Files</div>
      </div>
      <div class="dash-churn-timeline-detail-section__body">
        <div class="dash-churn-timeline-detail-files">${_dashChurnTimelineFileRowsHTML(stats, 10)}</div>
      </div>
    </section>
  </div>
</div>`;

        function renderChart() {
            if (!buckets.length) return;
            _dashDrawTimelineChart(buckets, 'detail');
        }
        _dashRegisterChartSwitch(chartKey, renderChart);
        renderChart();
    },
});
