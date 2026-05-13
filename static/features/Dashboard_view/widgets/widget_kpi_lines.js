// @module Dashboard_view/widgets/widget_kpi_lines

_dashRegisterWidget({
    id: 'kpi_lines',
    labelKey: 'dashKpiLoc',
    defaultSize: 'S',

    render(container, size, stats) {
        const total      = stats.loc_total   || 0;
        const code       = stats.loc_code    || 0;
        const comment    = stats.loc_comment || 0;
        const blank      = stats.loc_blank   || 0;
        const base       = total || 1;
        const codePct    = Math.round((code    / base) * 100);
        const commentPct = Math.round((comment / base) * 100);
        const blankPct   = Math.round((blank   / base) * 100);
        const colors     = _dashAccentForSlices(3);

        if (size === 'S') {
            const linePills = [
                { label: 'Code', value: `${codePct}%`, onclick: `_dashOpenFileGroupDrilldown('Files with code LOC', _dashAllFiles().filter(f => (f.loc || {}).code > 0), { meta: f => _dashFmtNum((f.loc || {}).code || 0) + ' LOC' })` },
                { label: 'Comments', value: `${commentPct}%`, onclick: `_dashOpenFileGroupDrilldown('Files with comment LOC', _dashAllFiles().filter(f => (f.loc || {}).comment > 0), { meta: f => _dashFmtNum((f.loc || {}).comment || 0) + ' lines' })` },
                { label: 'Blank', value: `${blankPct}%`, onclick: `_dashOpenFileGroupDrilldown('Files with blank LOC', _dashAllFiles().filter(f => (f.loc || {}).blank > 0), { meta: f => _dashFmtNum((f.loc || {}).blank || 0) + ' lines' })` },
            ];
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Lines</div>
    <div class="dash-widget-stat">${_dashFmtNum(total)}</div>
    <div class="dash-widget-sub">${codePct}% code &middot; ${_dashFmtNum(comment)} comments</div>
    ${_dashMiniPills(linePills)}
  </div>
</div>`;
            return;
        }

        const segments = [
            ['Code',     code,    codePct,    colors[0]],
            ['Comments', comment, commentPct, colors[1] || colors[0]],
            ['Blank',    blank,   blankPct,   'var(--border)'],
        ];

        if (size === 'M') {
            const rows = segments.map(([label, cnt, pct, col]) => `
<div class="dash-kpi-bar-row" style="cursor:pointer" onclick="_dashOpenFileGroupDrilldown('Files with ${label} LOC', _dashAllFiles().filter(f => ((f.loc || {})[${_dashJson(label === 'Comments' ? 'comment' : label.toLowerCase())}] || 0) > 0), { meta: f => _dashFmtNum(((f.loc || {})[${_dashJson(label === 'Comments' ? 'comment' : label.toLowerCase())}] || 0)) + ' lines' })">
  <span class="dash-kpi-bar-label">${label}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${pct}%;background:${col}"></div></div>
  <span class="dash-kpi-bar-val">${_dashFmtNum(cnt)}</span>
</div>`).join('');
            container.innerHTML = `
<div class="dash-kpi-m">
  <div class="dash-kpi-m-left">
    <div class="dash-widget-title">Lines</div>
    <div class="dash-widget-stat-md">${_dashFmtNum(total)}</div>
    <div class="dash-widget-sub">${codePct}% code</div>
  </div>
  <div class="dash-kpi-m-sep"></div>
  <div class="dash-kpi-m-right">${rows}</div>
</div>`;
        } else {
            const rows = segments.map(([label, cnt, pct, col]) => `
<div class="dash-kpi-bar-row" style="cursor:pointer" onclick="_dashOpenFileGroupDrilldown('Files with ${label} LOC', _dashAllFiles().filter(f => ((f.loc || {})[${_dashJson(label === 'Comments' ? 'comment' : label.toLowerCase())}] || 0) > 0), { meta: f => _dashFmtNum(((f.loc || {})[${_dashJson(label === 'Comments' ? 'comment' : label.toLowerCase())}] || 0)) + ' lines' })">
  <span class="dash-kpi-bar-label">${label}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${pct}%;background:${col}"></div></div>
  <span class="dash-kpi-bar-val">${_dashFmtNum(cnt)}<small class="dash-kpi-bar-pct">${pct}%</small></span>
</div>`).join('');
            container.innerHTML = `
<div class="dash-kpi-l">
  <div class="dash-kpi-l-head">
    <div class="dash-widget-title">Lines</div>
    <div class="dash-widget-stat-lg">${_dashFmtNum(total)}</div>
    <div class="dash-widget-sub">${codePct}% code &middot; ${_dashFmtNum(comment)} comments</div>
  </div>
  <div class="dash-kpi-divider"></div>
  <div class="dash-kpi-l-body">${rows}</div>
</div>`;
        }
    },

    renderDetail(container, stats) {
        const total      = stats.loc_total   || 1;
        const code       = stats.loc_code    || 0;
        const comment    = stats.loc_comment || 0;
        const blank      = stats.loc_blank   || 0;
        const codePct    = Math.round((code    / total) * 100);
        const commentPct = Math.round((comment / total) * 100);
        const blankPct   = Math.round((blank   / total) * 100);

        const canvasId = 'dash-detail-lines-donut';
        const { labels, data, colors: sliceColors } = _dashGroupedSlices(
            ['Code', 'Comments', 'Blank'],
            [code, comment, blank]
        );

        container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>Composition</div>
  <div class="dash-detail-split">
    <div class="dash-chart-wrap dash-detail-chart-sm">
      <canvas id="${canvasId}"></canvas>
    </div>
    <div class="dash-detail-breakdown">
    <div class="dash-health-row" data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Files with code LOC', _dashAllFiles().filter(f => (f.loc || {}).code > 0), { meta: f => _dashFmtNum((f.loc || {}).code || 0) + ' LOC' })">
      <span class="dash-health-row-label">Code</span>
      <div class="dash-health-row-track">
        <div class="dash-health-row-fill" style="width:${codePct}%;background:${sliceColors[0]}"></div>
      </div>
      <span class="dash-health-row-value">${_dashFmtNum(code)} <small style="color:var(--muted)">(${codePct}%)</small></span>
    </div>
    <div class="dash-health-row" data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Files with comment LOC', _dashAllFiles().filter(f => (f.loc || {}).comment > 0), { meta: f => _dashFmtNum((f.loc || {}).comment || 0) + ' lines' })">
      <span class="dash-health-row-label">Comments</span>
      <div class="dash-health-row-track">
        <div class="dash-health-row-fill" style="width:${commentPct}%;background:${sliceColors[1] || sliceColors[0]}"></div>
      </div>
      <span class="dash-health-row-value">${_dashFmtNum(comment)} <small style="color:var(--muted)">(${commentPct}%)</small></span>
    </div>
    <div class="dash-health-row" data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Files with blank LOC', _dashAllFiles().filter(f => (f.loc || {}).blank > 0), { meta: f => _dashFmtNum((f.loc || {}).blank || 0) + ' lines' })">
      <span class="dash-health-row-label">Blank</span>
      <div class="dash-health-row-track">
        <div class="dash-health-row-fill" style="width:${blankPct}%;background:var(--border)"></div>
      </div>
      <span class="dash-health-row-value">${_dashFmtNum(blank)} <small style="color:var(--muted)">(${blankPct}%)</small></span>
    </div>
    </div>
  </div>
</div>`;

        const canvas = document.getElementById(canvasId);
        if (canvas && typeof Chart !== 'undefined') {
            _dashMkChart(canvas, 'doughnut', {
                labels,
                datasets: [{ data, backgroundColor: sliceColors, borderWidth: 0 }],
            }, {
                responsive: true, maintainAspectRatio: false,
                onClick: (_evt, elements) => {
                    if (!elements || !elements.length) return;
                    const label = labels[elements[0].index];
                    const key = label === 'Comments' ? 'comment' : String(label || '').toLowerCase();
                    _dashOpenFileGroupDrilldown(`Files with ${label} LOC`, _dashAllFiles().filter(f => ((f.loc || {})[key] || 0) > 0), {
                        meta: f => `${_dashFmtNum(((f.loc || {})[key] || 0))} lines`,
                    });
                },
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 10 } } },
                cutout: '70%',
            });
        }
    },
});
