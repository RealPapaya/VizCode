// @module Dashboard_view/widgets/widget_duplication
// Duplication — percent gauge + top duplicated blocks list.

function _dashRenderDuplication(container, stats) {
    if (!container) return;

    const pct    = Number(stats.duplication_percent || 0);   // already 0-100
    const blocks = stats.duplication_blocks || [];

    // Status colour: green <5%, amber <15%, red otherwise.
    // Status semantics live in --status-* tokens (themes.css).
    const color = pct < 5 ? 'var(--status-good)'
                : pct < 15 ? 'var(--status-warn)'
                : 'var(--status-bad)';
    const fillPct = Math.max(0, Math.min(100, pct));

    const blocksHTML = blocks.map((blk, i) => {
        const occurrences = blk.occurrences || [];
        const first = occurrences[0] || {};
        const firstFile = String(first.file || '').split('/').pop();
        const fileJSON = JSON.stringify(first.file || '').replace(/"/g, '&quot;');
        return `
<div class="dash-dup-row" data-clickable="true" onclick="_dashDrill(${fileJSON}, null)">
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
    <div class="dash-dup-list">${blocksHTML}</div>
  </div>
</div>`;
}
