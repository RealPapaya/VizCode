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

    container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashTemporalChurn'))}
  ${_dashChartToggleHTML(key, _DASH_TIMELINE_TYPES, _DASH_TIMELINE_DEFAULT)}
</div>
<div class="dash-chart-wrap dash-timeline-chart-wrap${isDetail ? ' dash-detail-chart dash-detail-chart--lg' : ''}"><canvas id="${_dashTimelineId(scope)}"></canvas></div>`;

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

_dashRegisterWidget({
    id: 'churn_timeline',
    labelKey: 'dashTemporalChurn',
    defaultSize: 'L',
    render(container, size, stats) {
        _dashRenderChurnTimelineWidget(container, size, stats, 'widget');
    },
    renderDetail(container, stats) {
        _dashRenderChurnTimelineWidget(container, 'L', stats, 'detail');
    },
});
