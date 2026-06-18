// @module Dashboard_view/widgets/widget_complexity

function _dashComplexityBucketFunctions(range) {
    const m = /^(\d+)(?:-(\d+)|\+)$/.exec(String(range || ''));
    if (!m) return [];
    const lo = Number(m[1]);
    const hi = range.includes('+') ? Infinity : Number(m[2] || m[1]);
    // Search symbol_index (all functions) so low-complexity buckets aren't empty.
    // complexity_top_offenders only keeps the top N by score, so clicking
    // low-range bars (e.g. 1-5) would always show 'no file' otherwise.
    const fromIndex = Object.values((window.DATA && DATA.symbol_index) || {})
        .filter(sym => (sym.kind === 'function' || sym.kind === 'method') && sym.complexity != null)
        .filter(sym => Number(sym.complexity) >= lo && Number(sym.complexity) <= hi)
        .sort((a, b) => b.complexity - a.complexity)
        .map(sym => ({ file: sym.file, name: sym.name, value: `complexity ${sym.complexity}` }));
    if (fromIndex.length) return fromIndex;
    // Fallback: use top_offenders for codebases without symbol_index populated.
    return (DATA.stats.complexity_top_offenders || [])
        .filter(sym => Number(sym.complexity || 0) >= lo && Number(sym.complexity || 0) <= hi)
        .map(sym => ({ file: sym.file, name: sym.name, value: `complexity ${sym.complexity}` }));
}

_dashRegisterWidget({
    id: 'complexity',
    labelKey: 'dashComplexityTitle',
    descriptionKey: 'dashDescComplexity',
    defaultSize: 'M',

    render(container, size, stats) {
        const top    = stats.complexity_top_offenders || [];
        const avg    = Number(stats.avg_complexity || 0);

        if (size === 'S') {
            const topName = top[0] ? (top[0].name || top[0].file || '?').split('/').pop() : 'n/a';
            const pills = top.slice(0, 3).map(sym => ({
                label: sym.name || '?',
                value: sym.complexity,
                title: sym.file || '',
                onclick: `_dashGoToGraphFile(${_dashJson(sym.file || '')}, ${_dashJson(sym.name || '')})`,
            }));
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashComplexityTitle'))}</div>
    <div class="dash-widget-stat">${avg.toFixed(1)}</div>
    <div class="dash-widget-sub">avg &middot; top: ${_dashEscape(topName)}</div>
    ${_dashMiniPills(pills)}
  </div>
</div>`;
            return;
        }

        const limit = size === 'L' ? 8 : 5;
        const maxVal = top[0]?.complexity || 1;
        const sliced = top.slice(0, limit);
        const colors = typeof _dashColorScale === 'function' ? _dashColorScale(sliced.length) : [];
        const rows = sliced.map((sym, i) => {
            const pct      = Math.round((sym.complexity / maxVal) * 100);
            const col      = colors[i];
            const fileShort = String(sym.file || '').split('/').pop();
            const fileJSON  = JSON.stringify(sym.file).replace(/"/g, '&quot;');
            const nameJSON  = JSON.stringify(sym.name).replace(/"/g, '&quot;');
            return `<div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(sym.file)}"
             onclick="_dashDrill(${fileJSON}, ${nameJSON})">
          <span class="dash-list-rank">${i + 1}</span>
          <span class="dash-list-name">${_dashEscape(sym.name)}<span class="dash-list-meta">${_dashEscape(fileShort)}</span></span>
          <div class="dash-list-bar-track"><div class="dash-list-bar-fill" style="width:${pct}%;background:${col}"></div></div>
          <span class="dash-list-val">${sym.complexity}</span>
        </div>`;
        }).join('') || `<div class="dash-empty">${_dashEscape(_dashT('dashNoData'))}</div>`;

        container.innerHTML = `
<div style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:var(--space-2);">
  <div class="dash-card-title">
    <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashComplexityTitle'))}
    <span class="dash-card-sub">avg ${avg.toFixed(1)}</span>
  </div>
  <div class="dash-list" style="flex:1;overflow:hidden;" id="dash-cyclo-top">${rows}</div>
</div>`;
    },

        renderDetail(container, stats) {
        // ── data ─────────────────────────────────────────────────────────────
        const dist      = stats.complexity_distribution || [];
        const top       = stats.complexity_top_offenders || [];
        const avg       = Number(stats.avg_complexity || 0);
        const topScore  = top[0]?.complexity || 0;
        const topName   = top[0]?.name || '';
        const topFile   = top[0] ? String(top[0].file || '').split('/').pop() : '';
        const canvasId  = 'dash-detail-cyclo-canvas';
        const chartKey  = 'complexity_detail_chart';
        const rowColors = typeof _dashColorScale === 'function' ? _dashColorScale(top.length) : [];
        const maxCx     = topScore || 1;

        // ── hero: mini histogram (top 5 buckets) ──────────────────────────────
        const heroVisual = (() => {
            const buckets = dist.slice(0, 5);
            if (!buckets.length) return '';
            const maxCnt = Math.max(1, ...buckets.map(b => b.count));
            return `<div class="dash-cyclo-detail-hist">${
                buckets.map((b, i) => {
                    const pct = Math.max(8, Math.round((b.count / maxCnt) * 100));
                    return `<div class="dash-cyclo-detail-hist__bar">
                        <div class="dash-cyclo-detail-hist__fill" style="height:${pct}%;background:${_dashAccentStop(i)}"></div>
                        <span class="dash-cyclo-detail-hist__label">${_dashEscape(b.range)}</span>
                    </div>`;
                }).join('')
            }</div>`;
        })();

        // ── all offender rows (no limit, scrollable) ───────────────────────────
        const offenderRows = top.map((sym, i) => {
            const pct       = Math.round((sym.complexity / maxCx) * 100);
            const col       = rowColors[i] || _dashAccentStop(Math.min(i, 4));
            const fileShort = String(sym.file || '').split('/').pop();
            return `<div class="dash-kpi-detail-row" data-clickable="true" title="${_dashEscape(sym.file)}"
                onclick="_dashDrill(${_dashJson(sym.file)}, ${_dashJson(sym.name)})">
                <span class="dash-kpi-detail-row__rank">${i + 1}</span>
                <span class="dash-kpi-detail-row__name">${_dashEscape(sym.name)}<span class="dash-cyclo-detail-meta">${_dashEscape(fileShort)}</span></span>
                <div class="dash-kpi-detail-row__bar-track"><div class="dash-kpi-detail-row__bar-fill" style="width:${pct}%;background:${col}"></div></div>
                <span class="dash-kpi-detail-row__value">complexity ${sym.complexity}</span>
            </div>`;
        }).join('') || `<div class="dash-empty">${_dashEscape(_dashT('dashNoData'))}</div>`;

        // ── render ────────────────────────────────────────────────────────────
        const summaryText = topName
            ? `Top offender: ${topName} (complexity ${topScore}) in ${topFile}. ${top.length} functions reported.`
            : `${top.length} functions reported.`;

        container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--complexity">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Function complexity</div>
      <h2 class="dash-kpi-detail__title">Complexity Analysis</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value" style="color:${_dashAccentStop(2)}">${avg.toFixed(1)}</span>
        <span class="dash-kpi-detail__primary-suffix">avg</span>
      </div>
      <p class="dash-kpi-detail__summary">${_dashEscape(summaryText)}</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
    title: 'Snapshot',
    body: _dashKpiDetailStatsHTML([
        { value: `${top.length}`, label: 'offenders' },
        { value: avg.toFixed(1),  label: 'average' },
        { value: `${topScore}`,   label: 'top score', color: _dashAccentStop(0) },
    ]),
})}
${_dashKpiDetailSectionHTML({
    title: 'Distribution by Range',
    subtitle: _dashChartToggleHTML(chartKey, ['bar', 'horizontalBar'], 'bar'),
    body: _dashKpiDetailChartHTML(`<canvas id="${canvasId}"></canvas>`, { size: 'md' }),
})}
${_dashKpiDetailSectionHTML({
    title: 'Top Offenders',
    body: `<div class="dash-cyclo-detail-offenders">${offenderRows}</div>`,
})}
  </div>
</div>`;

        // ── chart ─────────────────────────────────────────────────────────────
        function renderChart() {
            const canvas = document.getElementById(canvasId);
            if (!canvas || typeof Chart === 'undefined' || !dist.length) return;
            const type       = _dashChartCurrentType(chartKey, 'bar');
            const horizontal = type === 'horizontalBar';
            const chartColors = typeof _dashColorScale === 'function'
                ? _dashColorScale(dist.length)
                : dist.map((_, i) => _dashAccentStop(i));
            _dashMkChart(canvas, 'bar', {
                labels: dist.map(b => b.range),
                datasets: [{ data: dist.map(b => b.count), backgroundColor: chartColors, borderRadius: 6, borderWidth: 0 }],
            }, {
                responsive: true, maintainAspectRatio: false,
                indexAxis: horizontal ? 'y' : 'x',
                onClick: (_evt, elements) => {
                    if (!elements || !elements.length) return;
                    const bucket = dist[elements[0].index];
                    if (bucket) _dashOpenFunctionGroupDrilldown(`Complexity ${bucket.range}`, _dashComplexityBucketFunctions(bucket.range));
                },
                plugins: { legend: { display: false } },
                scales: horizontal ? {
                    x: { beginAtZero: true, grid: { color: _dashBorderTint(0.6) } },
                    y: { grid: { display: false }, ticks: { font: { size: 11 } } },
                } : {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true, grid: { color: _dashBorderTint(0.6) } },
                },
            });
        }
        _dashRegisterChartSwitch(chartKey, renderChart);
        renderChart();
    },
});
