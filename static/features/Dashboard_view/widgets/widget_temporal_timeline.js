// @module Dashboard_view/widgets/widget_temporal_timeline
// Phase 2 — Code Churn Timeline. Line chart of commits per week with
// secondary additions/deletions overlay. Toggleable to bar chart.

const _DASH_TIMELINE_KEY = 'temporal_timeline';
const _DASH_TIMELINE_TYPES = ['line', 'bar'];
const _DASH_TIMELINE_DEFAULT = 'line';

function _dashRenderTemporalTimeline(container, stats) {
    if (!container) return;

    const buckets = stats.churn_timeline || [];

    container.innerHTML = `
<div class="dash-card-title">
  <span class="dash-card-title-dot" style="background:#34d399"></span>${_dashEscape(_dashT('dashTemporalChurn'))}
  ${_dashChartToggleHTML(_DASH_TIMELINE_KEY, _DASH_TIMELINE_TYPES, _DASH_TIMELINE_DEFAULT)}
</div>
<div class="dash-chart-wrap" style="min-height:220px"><canvas id="dash-chart-timeline"></canvas></div>`;

    if (!buckets.length) {
        const wrap = container.querySelector('.dash-chart-wrap');
        if (wrap) wrap.innerHTML = `<div class="dash-empty">${_dashEscape(_dashT('dashTemporalEmpty'))}</div>`;
        return;
    }

    _dashRegisterChartSwitch(_DASH_TIMELINE_KEY, () =>
        _dashRenderTemporalTimeline(container, stats)
    );

    _dashDrawTimelineChart(buckets);
}

function _dashDrawTimelineChart(buckets) {
    const canvas = document.getElementById('dash-chart-timeline');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels    = buckets.map(b => b.week_start);
    const commits   = buckets.map(b => b.commits);
    const additions = buckets.map(b => b.additions);
    const deletions = buckets.map(b => -Math.abs(b.deletions));   // negative for visual diff

    const type = _dashChartCurrentType(_DASH_TIMELINE_KEY, _DASH_TIMELINE_DEFAULT);

    _dashMkChart(canvas, type, {
        labels,
        datasets: [
            {
                label: _dashT('dashTemporalCommits'),
                data:  commits,
                yAxisID: 'yCommits',
                borderColor: '#34d399',
                backgroundColor: '#34d39955',
                borderWidth: 2,
                tension: 0.25,
                pointRadius: 3,
                fill: type === 'line',
            },
            {
                label: _dashT('dashTemporalAdditions'),
                data:  additions,
                yAxisID: 'yLines',
                borderColor: '#60a5fa',
                backgroundColor: '#60a5fa55',
                borderWidth: 1.5,
                tension: 0.25,
                pointRadius: 2,
                fill: false,
                hidden: false,
            },
            {
                label: _dashT('dashTemporalDeletions'),
                data:  deletions,
                yAxisID: 'yLines',
                borderColor: '#f87171',
                backgroundColor: '#f8717155',
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
            legend: { position: 'top', labels: { color: '#94a3b8', boxWidth: 10, padding: 10 } },
        },
        scales: {
            x: {
                grid: { color: '#1a253588' },
                ticks: { color: '#64748b', maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            },
            yCommits: {
                position: 'left',
                grid: { color: '#1a253588' },
                ticks: { color: '#34d399' },
                title: { display: true, text: _dashT('dashTemporalCommits'), color: '#34d399' },
                beginAtZero: true,
            },
            yLines: {
                position: 'right',
                grid: { display: false },
                ticks: { color: '#64748b' },
                title: { display: true, text: '+/-', color: '#94a3b8' },
            },
        },
    });
}
