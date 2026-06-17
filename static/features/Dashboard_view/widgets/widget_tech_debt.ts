// @ts-nocheck -- JS->TS migration: renamed to .ts, type-curation pending. Remove this line and fix errors to enable checking.
// @module Dashboard_view/widgets/widget_tech_debt

const _DASH_DEBT_ORDER = [
    { key: 'circular',    label: 'dashDebtCircular'    },
    { key: 'god',         label: 'dashDebtGod'         },
    { key: 'complexity',  label: 'dashDebtComplexity'  },
    { key: 'duplication', label: 'dashDebtDuplication' },
    { key: 'dead',        label: 'dashDebtDead'        },
];

function _dashDebtCategoryFiles(key, stats) {
    if (key === 'circular') return (stats.top_circular_deps || []).flat();
    if (key === 'god') return (stats.top_caller_files || []).map(x => x.file);
    if (key === 'complexity') return (stats.complexity_top_offenders || []).map(x => x.file);
    if (key === 'duplication') return (stats.duplication_blocks || []).flatMap(b => (b.occurrences || []).map(o => o.file));
    if (key === 'dead') return (stats.dead_code_symbols || []).map(x => x.file);
    return [];
}

_dashRegisterWidget({
    id: 'tech_debt',
    labelKey: 'dashTechDebtTitle',
    descriptionKey: 'dashDescTechDebt',
    defaultSize: 'M',

    render(container, size, stats) {
        const hours     = Number(stats.tech_debt_hours || 0);
        const breakdown = stats.tech_debt_breakdown || {};
        const colors    = _dashAccentForSlices(_DASH_DEBT_ORDER.length);
        const totalMin  = Object.values(breakdown).reduce((a, n) => a + Number(n || 0), 0);
        const denom     = totalMin || 1;
        const hoursStat = `${hours.toFixed(1)}<small style="font-size:var(--text-xs);color:var(--muted);margin-left:3px">h</small>`;

        if (size === 'S') {
            const pills = _DASH_DEBT_ORDER
                .map(d => ({ label: _dashT(d.label), value: Number(breakdown[d.key] || 0), key: d.key }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 3)
                .map(d => ({
                    label: d.label,
                    value: `${d.value}m`,
                    onclick: `_dashOpenFileGroupDrilldown('Tech Debt: ${_dashEscape(d.label)}', _dashDebtCategoryFiles(${_dashJson(d.key)}, DATA.stats))`,
                }));
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashTechDebtTitle'))}</div>
    <div class="dash-widget-stat">${hours.toFixed(1)}<small style="font-size:var(--text-xs);color:var(--muted);margin-left:3px">h</small></div>
    <div class="dash-widget-sub">estimated debt</div>
    ${_dashMiniPills(pills)}
  </div>
</div>`;
            return;
        }

        const makeRows = (limit) => _DASH_DEBT_ORDER.slice(0, limit).map((d, i) => {
            const minutes = Number(breakdown[d.key] || 0);
            const pct     = Math.round((minutes / denom) * 100);
            const col     = colors[Math.min(i, colors.length - 1)];
            return `<div class="dash-kpi-bar-row" style="cursor:pointer"
     onclick="_dashOpenFileGroupDrilldown('Tech Debt: ${_dashEscape(_dashT(d.label))}', _dashDebtCategoryFiles(${_dashJson(d.key)}, DATA.stats))">
  <span class="dash-kpi-bar-label">${_dashEscape(_dashT(d.label))}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${pct}%;background:${col}"></div></div>
  <span class="dash-kpi-bar-val">${minutes}m</span>
</div>`;
        }).join('');

        if (size === 'M') {
            container.innerHTML = `
<div class="dash-kpi-m">
  <div class="dash-kpi-m-left">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashTechDebtTitle'))}</div>
    <div class="dash-widget-stat-md">${hours.toFixed(1)}<small style="font-size:11px;color:var(--muted);margin-left:3px">h</small></div>
    <div class="dash-widget-sub">estimated</div>
  </div>
  <div class="dash-kpi-m-sep"></div>
  <div class="dash-kpi-m-right">${makeRows(4)}</div>
</div>`;
        } else {
            container.innerHTML = `
<div class="dash-kpi-l">
  <div class="dash-kpi-l-head">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashTechDebtTitle'))}</div>
    <div class="dash-widget-stat-lg">${hours.toFixed(1)}<small style="font-size:var(--text-base);color:var(--muted);margin-left:4px">h</small></div>
    <div class="dash-widget-sub">estimated remediation</div>
  </div>
  <div class="dash-kpi-divider"></div>
  <div class="dash-kpi-l-body">${makeRows(5)}</div>
</div>`;
        }
    },

        renderDetail(container, stats) {
        // ── data ─────────────────────────────────────────────────────────────
        const hours        = Number(stats.tech_debt_hours || 0);
        const breakdown    = stats.tech_debt_breakdown || {};
        const colors       = _dashAccentForSlices(_DASH_DEBT_ORDER.length);
        const totalMin     = Object.values(breakdown).reduce((a, n) => a + Number(n || 0), 0);
        const denom        = totalMin || 1;
        const nonZero      = _DASH_DEBT_ORDER.filter(d => Number(breakdown[d.key] || 0) > 0);
        const canvasId     = 'dash-detail-debt-chart';
        const chartKey     = 'tech_debt_detail_chart';
        const HOURS_PER_DAY = 8;

        // ── unit toggle (hours ↔ days) ────────────────────────────────────────
        let showDays = false;
        function _fmtVal()    { return showDays ? (hours / HOURS_PER_DAY).toFixed(1) : hours.toFixed(1); }
        function _fmtSuffix() { return showDays ? 'days' : 'hours'; }
        function _fmtSummary() {
            const top = nonZero.slice().sort((a, b) => Number(breakdown[b.key]||0) - Number(breakdown[a.key]||0))[0];
            return top
                ? `Largest category: ${_dashT(top.label)}. ${nonZero.length} issue types detected.`
                : `${nonZero.length} issue types detected.`;
        }

        // ── chart slice data ──────────────────────────────────────────────────
        const { labels, data, colors: sliceColors } = _dashGroupedSlices(
            _DASH_DEBT_ORDER.map(d => _dashT(d.label)),
            _DASH_DEBT_ORDER.map(d => Number(breakdown[d.key] || 0))
        );

        // ── hero: stacked composition bar ────────────────────────────────────
        const heroSegments = _DASH_DEBT_ORDER.map((d, i) => ({
            key: d.key, label: _dashT(d.label),
            minutes: Number(breakdown[d.key] || 0),
            pct: Math.round((Number(breakdown[d.key] || 0) / denom) * 100),
            col: colors[Math.min(i, colors.length - 1)],
        })).filter(s => s.minutes > 0);

        const heroVisual = `<div class="dash-debt-detail-comp">
  <div class="dash-debt-detail-comp__stack">${
    heroSegments.map(s =>
        `<span style="width:${s.pct}%;background:${s.col}" title="${_dashEscape(s.label)} ${s.pct}%"></span>`
    ).join('')
  }</div>
  <div class="dash-debt-detail-comp__legend">${
    heroSegments.map(s =>
        `<button type="button" onclick="_dashOpenFileGroupDrilldown('Tech Debt: ${_dashEscape(s.label)}', _dashDebtCategoryFiles(${_dashJson(s.key)}, DATA.stats))">
          <i style="background:${s.col}"></i><span>${_dashEscape(s.label)}</span><b>${s.pct}%</b>
        </button>`
    ).join('')
  }</div>
</div>`;

        // ── category breakdown rows ───────────────────────────────────────────
        const categoryRows = _DASH_DEBT_ORDER.map((d, i) => {
            const minutes = Number(breakdown[d.key] || 0);
            const pct     = Math.round((minutes / denom) * 100);
            const col     = colors[Math.min(i, colors.length - 1)];
            return `<div class="dash-kpi-detail-row" data-clickable="true"
                onclick="_dashOpenFileGroupDrilldown('Tech Debt: ${_dashEscape(_dashT(d.label))}', _dashDebtCategoryFiles(${_dashJson(d.key)}, DATA.stats))">
                <span class="dash-kpi-detail-row__rank">${i + 1}</span>
                <span class="dash-kpi-detail-row__name">${_dashEscape(_dashT(d.label))}</span>
                <div class="dash-kpi-detail-row__bar-track"><div class="dash-kpi-detail-row__bar-fill" style="width:${pct}%;background:${col}"></div></div>
                <span class="dash-kpi-detail-row__value">${minutes}m</span>
            </div>`;
        }).join('');

        // ── recommended actions ───────────────────────────────────────────────
        const _REC = {
            circular:    { action: 'Break up circular imports',          detail: 'Extract shared utilities to break import cycles.' },
            god:         { action: 'Reduce god files',                   detail: 'Split large central files into smaller focused modules.' },
            complexity:  { action: 'Refactor high-complexity functions', detail: 'Break down functions with cyclomatic complexity > 10.' },
            duplication: { action: 'Remove duplicate blocks',            detail: 'Extract repeated code into shared utilities.' },
            dead:        { action: 'Delete unused symbols',              detail: 'Remove dead functions and unreferenced exports.' },
        };
        const recCards = nonZero
            .slice().sort((a, b) => Number(breakdown[b.key]||0) - Number(breakdown[a.key]||0))
            .map((d, i) => {
                const minutes = Number(breakdown[d.key] || 0);
                const rec     = _REC[d.key] || { action: 'Address this category', detail: '' };
                const col     = colors[Math.min(_DASH_DEBT_ORDER.findIndex(x => x.key === d.key), colors.length - 1)];
                return `<div class="dash-debt-detail-rec" data-clickable="true"
                    onclick="_dashOpenFileGroupDrilldown('Tech Debt: ${_dashEscape(_dashT(d.label))}', _dashDebtCategoryFiles(${_dashJson(d.key)}, DATA.stats))">
                    <div class="dash-debt-detail-rec__head">
                        <span class="dash-debt-detail-rec__dot" style="background:${col}"></span>
                        <span class="dash-debt-detail-rec__cat">${_dashEscape(_dashT(d.label))}</span>
                        <span class="dash-debt-detail-rec__time">${minutes}m</span>
                    </div>
                    <div class="dash-debt-detail-rec__action">${_dashEscape(rec.action)}</div>
                    <div class="dash-debt-detail-rec__detail">${_dashEscape(rec.detail)}</div>
                </div>`;
            }).join('');

        // ── render ────────────────────────────────────────────────────────────
        container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--tech-debt">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Technical debt</div>
      <h2 class="dash-kpi-detail__title">Debt Overview</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value" id="dash-debt-val" style="color:#DFA745">${_fmtVal()}</span>
        <span class="dash-kpi-detail__primary-suffix" id="dash-debt-suffix">${_fmtSuffix()}</span>
        <button type="button" class="dash-debt-detail-unit-btn" id="dash-debt-unit-btn">${showDays ? 'Show hours' : 'Show days'}</button>
      </div>
      <p class="dash-kpi-detail__summary" id="dash-debt-summary">${_fmtSummary()}</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
    title: 'Snapshot',
    body: _dashKpiDetailStatsHTML([
        { value: _fmtVal(),      label: _fmtSuffix(),      color: '#DFA745' },
        { value: `${totalMin}`,  label: 'total minutes' },
        { value: `${nonZero.length}`, label: 'issue categories' },
    ]),
})}
${_dashKpiDetailGridHTML([
    _dashKpiDetailSectionHTML({
        title: 'By Category',
        subtitle: _dashChartToggleHTML(chartKey, ['doughnut', 'bar'], 'doughnut'),
        body: _dashKpiDetailChartHTML(`<canvas id="${canvasId}"></canvas>`, { size: 'sm' }),
    }),
    _dashKpiDetailSectionHTML({
        title: 'Category Breakdown',
        body: _dashKpiDetailListHTML(categoryRows || '<div class="dash-empty">No debt data</div>'),
    }),
], { columns: 2 })}
${_dashKpiDetailSectionHTML({
    title: 'Recommended Actions',
    body: `<div class="dash-debt-detail-rec-grid">${recCards || '<div class="dash-empty">No issues detected.</div>'}</div>`,
})}
  </div>
</div>`;

        // ── unit toggle wiring ────────────────────────────────────────────────
        container.querySelector('#dash-debt-unit-btn')?.addEventListener('click', () => {
            showDays = !showDays;
            container.querySelector('#dash-debt-val').textContent     = _fmtVal();
            container.querySelector('#dash-debt-suffix').textContent  = _fmtSuffix();
            container.querySelector('#dash-debt-summary').textContent = _fmtSummary();
            container.querySelector('#dash-debt-unit-btn').textContent = showDays ? 'Show hours' : 'Show days';
            const statsEl = container.querySelector('.dash-kpi-detail-stats');
            if (statsEl) statsEl.outerHTML = _dashKpiDetailStatsHTML([
                { value: _fmtVal(),      label: _fmtSuffix(),      color: '#DFA745' },
                { value: `${totalMin}`,  label: 'total minutes' },
                { value: `${nonZero.length}`, label: 'issue categories' },
            ]);
        });

        // ── chart ─────────────────────────────────────────────────────────────
        function renderChart() {
            const canvas = document.getElementById(canvasId);
            if (!canvas || typeof Chart === 'undefined') return;
            const type     = _dashChartCurrentType(chartKey, 'doughnut');
            const circular = type === 'doughnut' || type === 'pie';
            _dashMkChart(canvas, type, {
                labels,
                datasets: [{ data, backgroundColor: sliceColors, borderWidth: circular ? 0 : 1, borderRadius: circular ? 0 : 5 }],
            }, {
                responsive: true, maintainAspectRatio: false,
                indexAxis: type === 'bar' ? 'y' : undefined,
                onClick: (_evt, elements) => {
                    if (!elements || !elements.length) return;
                    const d = _DASH_DEBT_ORDER[elements[0].index];
                    if (d) _dashOpenFileGroupDrilldown(`Tech Debt: ${_dashT(d.label)}`, _dashDebtCategoryFiles(d.key, DATA.stats));
                },
                plugins: { legend: circular ? { position: 'bottom', labels: { boxWidth: 10, padding: 8 } } : { display: false } },
                cutout: type === 'doughnut' ? '65%' : 0,
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
