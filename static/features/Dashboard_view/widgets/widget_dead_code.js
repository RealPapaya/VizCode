// @module Dashboard_view/widgets/widget_dead_code

_dashRegisterWidget({
    id: 'dead_code',
    labelKey: 'dashDeadCode',
    defaultSize: 'S',

    render(container, size, stats) {
        const count  = stats.dead_code_count || 0;
        const total  = stats.functions || 1;
        const pct    = Math.min(100, Math.round((count / total) * 100));
        // SVG ring: r=18, circumference ≈ 113
        const circ   = 2 * Math.PI * 18;
        const fill   = ((1 - pct / 100) * circ).toFixed(1);
        const color  = pct > 20 ? '#c57429' : pct > 5 ? '#DFA745' : '#A4B55B';

        container.innerHTML = `
<div class="dash-widget-title">Dead Code</div>
<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
  <svg width="44" height="44" viewBox="0 0 44 44" style="transform:rotate(-90deg)">
    <circle cx="22" cy="22" r="18" fill="none" stroke="var(--border)" stroke-width="4"/>
    <circle cx="22" cy="22" r="18" fill="none" stroke="${color}" stroke-width="4"
            stroke-dasharray="${(pct / 100 * circ).toFixed(1)} ${circ.toFixed(1)}"
            stroke-linecap="round"/>
  </svg>
  <div>
    <div class="dash-widget-stat" style="font-size:22px;color:${color}">${_dashFmtNum(count)}</div>
    <div class="dash-widget-sub">${pct}% of funcs</div>
  </div>
</div>`;
    },

    renderDetail(container, stats) {
        const count    = stats.dead_code_count || 0;
        const total    = stats.functions || 1;
        const pct      = Math.min(100, Math.round((count / total) * 100));
        const deadList = stats.dead_code_symbols || [];
        const color    = pct > 20 ? '#c57429' : pct > 5 ? '#DFA745' : '#A4B55B';

        // Group by file
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
