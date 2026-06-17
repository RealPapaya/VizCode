// @ts-nocheck -- JS->TS migration: renamed to .ts, type-curation pending. Remove this line and fix errors to enable checking.
// @module Dashboard_view/widgets/widget_dead_code

function _kpiDeadCodeRing(pct, color, width, height) {
    const r    = Math.round(Math.min(width, height) * 0.38);
    const circ = 2 * Math.PI * r;
    const cx   = Math.round(width / 2);
    const cy   = Math.round(height / 2);
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="transform:rotate(-90deg)">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="4"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="4"
            stroke-dasharray="${(pct / 100 * circ).toFixed(1)} ${circ.toFixed(1)}"
            stroke-linecap="round"/>
  </svg>`;
}

_dashRegisterWidget({
    id: 'dead_code',
    labelKey: 'dashDeadCode',
    descriptionKey: 'dashDescDeadCode',
    defaultSize: 'S',

    render(container, size, stats) {
        const count = stats.uncalled_functions || 0;
        const total = stats.functions || 1;
        const pct   = Math.min(100, Math.round((count / total) * 100));
        const color = pct > 20 ? '#c57429' : pct > 5 ? '#DFA745' : '#A4B55B';

        if (size === 'S') {
            const byFile = new Map();
            (stats.dead_code_symbols || []).forEach(sym => byFile.set(sym.file, (byFile.get(sym.file) || 0) + 1));
            const pills = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([file, cnt]) => ({
                label: String(file).split('/').pop(),
                value: cnt,
                title: file,
                onclick: `_dashOpenFunctionGroupDrilldown('Dead symbols in ${_dashEscape(String(file).split('/').pop())}', (DATA.stats.dead_code_symbols || []).filter(s => s.file === ${_dashJson(file)}).map(s => ({ file: s.file, name: s.name, value: 'unused' })))`,
            }));
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Dead Code</div>
    <div class="dash-widget-stat" style="color:${color}">${_dashFmtNum(count)}</div>
    <div class="dash-widget-sub">${pct}% of funcs</div>
    ${_dashMiniPills(pills)}
  </div>
</div>`;
            return;
        }

        if (size === 'M') {
            container.innerHTML = `
<div class="dash-kpi-m" style="align-items:center;">
  <div class="dash-kpi-m-left" style="align-items:center;display:flex;flex-direction:column;justify-content:center;gap:4px;">
    ${_kpiDeadCodeRing(pct, color, 72, 72)}
    <div style="font-size:var(--text-xs);color:var(--muted);text-align:center;margin-top:2px;">${pct}% dead</div>
  </div>
  <div class="dash-kpi-m-sep"></div>
  <div class="dash-kpi-m-right">
    <div class="dash-widget-title">Dead Code</div>
    <div class="dash-widget-stat-md" style="color:${color}">${_dashFmtNum(count)}</div>
    <div class="dash-widget-sub">${pct}% of ${_dashFmtNum(total)} funcs</div>
  </div>
</div>`;
            return;
        }

        // L: ring + list of top dead-code files
        const deadList  = stats.dead_code_symbols || [];
        const byFile    = new Map();
        deadList.forEach(sym => {
            const key = sym.file || 'unknown';
            if (!byFile.has(key)) byFile.set(key, 0);
            byFile.set(key, byFile.get(key) + 1);
        });
        const topFiles = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
        const maxF     = topFiles.length ? topFiles[0][1] : 1;
        const fileRows = topFiles.slice(0, 6).map(([file, cnt], i) => `
<div class="dash-kpi-bar-row" style="cursor:pointer"
     onclick="_dashOpenFunctionGroupDrilldown('Dead symbols in ${_dashEscape(file.split('/').pop())}', (DATA.stats.dead_code_symbols || []).filter(s => s.file === ${_dashJson(file)}).map(s => ({ file: s.file, name: s.name, value: 'unused' })))">
  <span class="dash-kpi-bar-label">${_dashEscape(file.split('/').pop())}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${Math.round(cnt/maxF*100)}%;background:${color}"></div></div>
  <span class="dash-kpi-bar-val">${cnt}</span>
</div>`).join('');

        container.innerHTML = `
<div class="dash-kpi-l">
  <div class="dash-kpi-l-head" style="display:flex;align-items:center;gap:var(--space-3);">
    ${_kpiDeadCodeRing(pct, color, 56, 56)}
    <div>
      <div class="dash-widget-title">Dead Code</div>
      <div class="dash-widget-stat-lg" style="color:${color}">${_dashFmtNum(count)}</div>
      <div class="dash-widget-sub">${pct}% of functions</div>
    </div>
  </div>
  <div class="dash-kpi-divider"></div>
  <div class="dash-kpi-l-body">${fileRows || '<span class="dash-kpi-empty">No dead code detected</span>'}</div>
</div>`;
    },

    renderDetail(container, stats) {
        const count    = stats.uncalled_functions || 0;
        const total    = stats.functions || 1;
        const pct      = Math.min(100, Math.round((count / total) * 100));
        const deadList = stats.dead_code_symbols || [];
        const color    = pct > 20 ? '#c57429' : pct > 5 ? '#DFA745' : '#A4B55B';

        const byFile = new Map();
        deadList.forEach(sym => {
            const key = sym.file || 'unknown';
            if (!byFile.has(key)) byFile.set(key, []);
            byFile.get(key).push(sym);
        });
        const fileEntries   = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
        const affectedFiles = fileEntries.length;

        // Hero visual: large ring
        const heroVisual = `<div class="dash-dead-detail-ring">${_kpiDeadCodeRing(pct, color, 140, 140)}<div class="dash-dead-detail-ring__label" style="color:${color}">${pct}%</div><div class="dash-dead-detail-ring__sub">of functions</div></div>`;

        const summaryText = count === 0
            ? 'No dead code detected.'
            : `${count} unused symbol${count !== 1 ? 's' : ''} across ${affectedFiles} file${affectedFiles !== 1 ? 's' : ''}.`;

        // File rows using dash-kpi-detail-row pattern
        const fileRows = fileEntries.slice(0, 20).map(([file, syms], i) => {
            const short     = file.split('/').pop();
            const symsJson  = _dashJson(syms.map(s => ({ file: s.file, name: s.name, value: 'unused' })));
            const titleJson = _dashJson('Dead code in ' + short);
            return `<div class="dash-kpi-detail-row" data-clickable="true" title="${_dashEscape(file)}"
                onclick="_dashOpenFunctionGroupDrilldown(${titleJson}, ${symsJson})">
                <span class="dash-kpi-detail-row__rank">${i + 1}</span>
                <span class="dash-kpi-detail-row__name">${_dashEscape(short)}<span class="dash-kpi-detail-row__meta">${_dashEscape(file)}</span></span>
                <span class="dash-kpi-detail-row__value">${syms.length} unused</span>
            </div>`;
        }).join('') || `<div class="dash-empty">No dead code detected</div>`;

        container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--dead-code">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Unused symbol risk</div>
      <h2 class="dash-kpi-detail__title">Dead Code</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value" style="color:${color}">${_dashFmtNum(count)}</span>
        <span class="dash-kpi-detail__primary-suffix">unused</span>
      </div>
      <p class="dash-kpi-detail__summary">${_dashEscape(summaryText)}</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
    title: 'Snapshot',
    body: _dashKpiDetailStatsHTML([
        { value: String(count),          label: 'unused symbols', color },
        { value: `${pct}%`,              label: 'of all functions', color },
        { value: String(affectedFiles),  label: 'files affected' },
        { value: String(total),          label: 'total functions' },
    ]),
})}
${_dashKpiDetailSectionHTML({
    title: count > 0 ? `Dead Symbols by File (${affectedFiles})` : 'Dead Symbols by File',
    body: `<div class="dash-dead-detail-list">${fileRows}</div>`,
})}
  </div>
</div>`;
    },
});
