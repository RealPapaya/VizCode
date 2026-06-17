// @ts-nocheck -- JS->TS migration: deferred (leaf widget renderer). Curate later.
// @module Dashboard_view/widgets/widget_kpi_lines

_dashRegisterWidget({
    id: 'kpi_lines',
    labelKey: 'dashKpiLoc',
    descriptionKey: 'dashDescKpiLines',
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
        const totalRaw   = stats.loc_total   || 0;
        const total      = totalRaw || 1;
        const code       = stats.loc_code    || 0;
        const comment    = stats.loc_comment || 0;
        const blank      = stats.loc_blank   || 0;
        const codePct    = Math.round((code    / total) * 100);
        const commentPct = Math.round((comment / total) * 100);
        const blankPct   = Math.round((blank   / total) * 100);
        const codeFiles = _dashAllFiles().filter(f => (f.loc || {}).code > 0);
        const commentFiles = _dashAllFiles().filter(f => (f.loc || {}).comment > 0);
        const blankFiles = _dashAllFiles().filter(f => (f.loc || {}).blank > 0);

        const canvasId = 'dash-detail-lines-donut';
        const chartKey = 'kpi_lines_detail_chart';
        const chartTypes = ['doughnut', 'bar'];
        const { labels, data, colors: sliceColors } = _dashGroupedSlices(
            ['Code', 'Comments', 'Blank'],
            [code, comment, blank]
        );

        const heroVisual = `
<div class="dash-kpi-detail-composition">
  <div class="dash-kpi-detail-composition__stack" aria-label="Line composition">
    <span style="width:${codePct}%;background:${sliceColors[0]}" title="Code ${codePct}%"></span>
    <span style="width:${commentPct}%;background:${sliceColors[1] || sliceColors[0]}" title="Comments ${commentPct}%"></span>
    <span style="width:${blankPct}%;background:var(--border)" title="Blank ${blankPct}%"></span>
  </div>
  <div class="dash-kpi-detail-composition__legend">
    <button type="button" onclick="_dashOpenFileGroupDrilldown('Files with code LOC', _dashAllFiles().filter(f => (f.loc || {}).code > 0), { meta: f => _dashFmtExactNum((f.loc || {}).code || 0) + ' lines of code' })">
      <i style="background:${sliceColors[0]}"></i><span>Code</span><b>${codePct}%</b>
    </button>
    <button type="button" onclick="_dashOpenFileGroupDrilldown('Files with comment LOC', _dashAllFiles().filter(f => (f.loc || {}).comment > 0), { meta: f => _dashFmtExactNum((f.loc || {}).comment || 0) + ' lines' })">
      <i style="background:${sliceColors[1] || sliceColors[0]}"></i><span>Comments</span><b>${commentPct}%</b>
    </button>
    <button type="button" onclick="_dashOpenFileGroupDrilldown('Files with blank LOC', _dashAllFiles().filter(f => (f.loc || {}).blank > 0), { meta: f => _dashFmtExactNum((f.loc || {}).blank || 0) + ' lines' })">
      <i style="background:var(--border)"></i><span>Blank</span><b>${blankPct}%</b>
    </button>
  </div>
</div>`;

        const meterRows = `
<div class="dash-kpi-detail-meters">
  <div class="dash-kpi-detail-meter" data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Files with code LOC', _dashAllFiles().filter(f => (f.loc || {}).code > 0), { meta: f => _dashFmtExactNum((f.loc || {}).code || 0) + ' lines of code' })">
    <span class="dash-kpi-detail-meter__label">Code</span>
    <div class="dash-kpi-detail-meter__track">
      <div class="dash-kpi-detail-meter__fill" style="width:${codePct}%;background:${sliceColors[0]}"></div>
    </div>
    <span class="dash-kpi-detail-meter__value">${_dashFmtExactNum(code)} <small style="color:var(--muted)">lines (${codePct}%)</small></span>
  </div>
  <div class="dash-kpi-detail-meter" data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Files with comment LOC', _dashAllFiles().filter(f => (f.loc || {}).comment > 0), { meta: f => _dashFmtExactNum((f.loc || {}).comment || 0) + ' lines' })">
    <span class="dash-kpi-detail-meter__label">Comments</span>
    <div class="dash-kpi-detail-meter__track">
      <div class="dash-kpi-detail-meter__fill" style="width:${commentPct}%;background:${sliceColors[1] || sliceColors[0]}"></div>
    </div>
    <span class="dash-kpi-detail-meter__value">${_dashFmtExactNum(comment)} <small style="color:var(--muted)">lines (${commentPct}%)</small></span>
  </div>
  <div class="dash-kpi-detail-meter" data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Files with blank LOC', _dashAllFiles().filter(f => (f.loc || {}).blank > 0), { meta: f => _dashFmtExactNum((f.loc || {}).blank || 0) + ' lines' })">
    <span class="dash-kpi-detail-meter__label">Blank</span>
    <div class="dash-kpi-detail-meter__track">
      <div class="dash-kpi-detail-meter__fill" style="width:${blankPct}%;background:var(--border)"></div>
    </div>
    <span class="dash-kpi-detail-meter__value">${_dashFmtExactNum(blank)} <small style="color:var(--muted)">lines (${blankPct}%)</small></span>
  </div>
</div>`;

        container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--lines">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Codebase lines</div>
      <h2 class="dash-kpi-detail__title">Line Composition</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value" style="color:${sliceColors[0]}">${_dashFmtExactNum(totalRaw)}</span>
        <span class="dash-kpi-detail__primary-suffix">lines</span>
      </div>
      <p class="dash-kpi-detail__summary">${codePct}% code, ${commentPct}% comments, and ${blankPct}% blank lines across ${_dashFmtExactNum(_dashAllFiles().length)} tracked files.</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
  title: 'Overview',
  body: _dashKpiDetailStatsHTML([
    { value: _dashFmtExactNum(totalRaw), label: 'total lines' },
    { value: _dashFmtExactNum(code), label: 'lines of code' },
    { value: _dashFmtExactNum(comment), label: 'comment lines' },
    { value: _dashFmtExactNum(blank), label: 'blank lines' },
  ]),
})}
${_dashKpiDetailSectionHTML({
  title: 'Line Mix',
  subtitle: _dashChartToggleHTML(chartKey, chartTypes, 'doughnut'),
  body: `<div class="dash-kpi-detail-split dash-kpi-detail-split--lines">
    ${_dashKpiDetailChartHTML(`<canvas id="${canvasId}"></canvas>`, { size: 'sm' })}
    ${meterRows}
  </div>`,
})}
${_dashKpiDetailSectionHTML({
  title: 'Drilldown',
  body: _dashKpiDetailStatsHTML([
    { value: _dashFmtExactNum(codeFiles.length), label: 'files with code' },
    { value: _dashFmtExactNum(commentFiles.length), label: 'files with comments' },
    { value: _dashFmtExactNum(blankFiles.length), label: 'files with blanks' },
  ]),
})}
  </div>
</div>`;

        function renderChart() {
            const canvas = document.getElementById(canvasId);
            if (!canvas || typeof Chart === 'undefined') return;
            const type = _dashChartCurrentType(chartKey, 'doughnut');
            const circular = type === 'doughnut' || type === 'pie';
            _dashMkChart(canvas, type, {
                labels,
                datasets: [{
                    data,
                    backgroundColor: sliceColors,
                    borderWidth: circular ? 0 : 1,
                    borderRadius: circular ? 0 : 5,
                }],
            }, {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: type === 'bar' ? 'y' : undefined,
                onClick: (_evt, elements) => {
                    if (!elements || !elements.length) return;
                    const label = labels[elements[0].index];
                    const key = label === 'Comments' ? 'comment' : String(label || '').toLowerCase();
                    _dashOpenFileGroupDrilldown(`Files with ${label} LOC`, _dashAllFiles().filter(f => ((f.loc || {})[key] || 0) > 0), {
                        meta: f => `${_dashFmtExactNum(((f.loc || {})[key] || 0))} lines`,
                    });
                },
                plugins: { legend: circular ? { position: 'bottom', labels: { boxWidth: 10, padding: 10 } } : { display: false } },
                cutout: type === 'doughnut' ? '70%' : 0,
                scales: type === 'bar' ? {
                    x: { beginAtZero: true, grid: { color: _dashBorderTint(0.6) } },
                    y: { grid: { display: false }, ticks: { font: { size: 11 } } },
                } : {},
            });
        }

        _dashRegisterChartSwitch(chartKey, renderChart);
        renderChart();
    },
});
