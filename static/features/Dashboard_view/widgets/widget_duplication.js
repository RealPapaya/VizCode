// @module Dashboard_view/widgets/widget_duplication

_dashRegisterWidget({
    id: 'duplication',
    labelKey: 'dashDuplicationTitle',
    defaultSize: 'S',

    render(container, size, stats) {
        const pct   = Number(stats.duplication_percent || 0);
        const color = pct < 5  ? 'var(--status-good)'
                    : pct < 15 ? 'var(--status-warn)'
                    : 'var(--status-bad)';
        container.innerHTML = `
<div class="dash-widget-title">Duplication</div>
<div class="dash-widget-stat" style="color:${color}">${pct.toFixed(1)}%</div>
<div class="dash-widget-sub" style="color:${color}">${pct < 5 ? 'clean' : pct < 15 ? 'moderate' : 'high'}</div>`;
    },

    renderDetail(container, stats) {
        const pct    = Number(stats.duplication_percent || 0);
        const blocks = stats.duplication_blocks || [];
        const color  = pct < 5  ? 'var(--status-good)'
                     : pct < 15 ? 'var(--status-warn)'
                     : 'var(--status-bad)';
        const fillPct = Math.max(0, Math.min(100, pct));

        const blocksHTML = blocks.map((blk, i) => {
            const occurrences = blk.occurrences || [];
            const first = occurrences[0] || {};
            const firstFile = String(first.file || '').split('/').pop();
            const fileJSON  = JSON.stringify(first.file || '').replace(/"/g, '&quot;');
            return `<div class="dash-dup-row" data-clickable="true" onclick="_dashDrill(${fileJSON}, null)">
              <div class="dash-dup-row-head">
                <span class="dash-list-rank">${i + 1}</span>
                <span class="dash-dup-row-name">${_dashEscape(firstFile)}<span class="dash-dup-row-line">:${first.line || '?'}</span></span>
                <span class="dash-dup-row-count">${occurrences.length}× duplicated</span>
              </div>
              <div class="dash-dup-row-sample">${_dashEscape(blk.sample || '')}</div>
            </div>`;
        }).join('') || `<div class="dash-empty">✅ ${_dashEscape(_dashT('dashDuplicationNone'))}</div>`;

        container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title">
    <span class="dash-card-title-dot" style="background:${color}"></span>${_dashEscape(_dashT('dashDuplicationTitle'))}
  </div>
  <div class="dash-dup-body">
    <div class="dash-dup-gauge">
      <div class="dash-dup-pct" style="color:${color}">${pct.toFixed(1)}<span style="font-size:18px">%</span></div>
      <div class="dash-dup-pct-track"><div class="dash-dup-pct-fill" style="width:${fillPct}%;background:${color}"></div></div>
      <div class="dash-dup-sub">${_dashEscape(_dashT('dashDuplicationSub'))}</div>
    </div>
  </div>
</div>
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>Duplicated Blocks</div>
  <div class="dash-dup-list" style="max-height:360px;overflow-y:auto;margin-top:8px;">${blocksHTML}</div>
</div>`;
    },
});
