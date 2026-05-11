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
    defaultSize: 'S',

    render(container, size, stats) {
        const count = stats.dead_code_count || 0;
        const total = stats.functions || 1;
        const pct   = Math.min(100, Math.round((count / total) * 100));
        const color = pct > 20 ? '#c57429' : pct > 5 ? '#DFA745' : '#A4B55B';

        if (size === 'S') {
            const barPct = Math.min(100, pct * 5);
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Dead Code</div>
    <div class="dash-widget-stat" style="color:${color}">${_dashFmtNum(count)}</div>
    <div class="dash-widget-sub">${pct}% of funcs</div>
  </div>
  <div class="dash-kpi-s-bar"><div class="dash-kpi-s-bar-fill" style="width:${barPct}%;background:${color}"></div></div>
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
<div class="dash-kpi-bar-row">
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
        const count    = stats.dead_code_count || 0;
        const total    = stats.functions || 1;
        const pct      = Math.min(100, Math.round((count / total) * 100));
        const deadList = stats.dead_code_symbols || [];
        const color    = pct > 20 ? '#c57429' : pct > 5 ? '#DFA745' : '#A4B55B';

        const byFile = new Map();
        deadList.forEach(sym => {
            const key = sym.file || 'unknown';
            if (!byFile.has(key)) byFile.set(key, []);
            byFile.get(key).push(sym.name || sym);
        });
        const fileEntries = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);

        container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot" style="background:${color}"></span>Summary</div>
  <div style="display:flex;gap:32px;padding:12px 0;">
    <div>
      <div style="font-size:var(--text-display);font-weight:700;color:${color};line-height:1">${_dashFmtNum(count)}</div>
      <div style="font-size:var(--text-xs);color:var(--muted);margin-top:4px">unused symbols</div>
    </div>
    <div>
      <div style="font-size:var(--text-display);font-weight:700;color:${color};line-height:1">${pct}%</div>
      <div style="font-size:var(--text-xs);color:var(--muted);margin-top:4px">of all functions</div>
    </div>
  </div>
</div>
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>Dead Symbols by File</div>
  <div class="dash-list" style="max-height:340px;overflow-y:auto;">
    ${fileEntries.map(([file, syms]) => {
        const shortFile = file.split('/').pop();
        return `<div style="margin-bottom:8px;">
          <div style="font-size:var(--text-xs);color:var(--muted);margin-bottom:3px;" title="${_dashEscape(file)}">${_dashEscape(shortFile)} <span style="color:var(--border)">(${syms.length})</span></div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${syms.map(n => `<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:var(--surface-elevated);color:${color}">${_dashEscape(n)}</span>`).join('')}
          </div>
        </div>`;
    }).join('') || '<div class="dash-empty">No dead code detected</div>'}
  </div>
</div>`;
    },
});
