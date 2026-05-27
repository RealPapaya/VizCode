// @module Dashboard_view/widgets/widget_duplication

_dashRegisterWidget({
  id: 'duplication',
  labelKey: 'dashDuplicationTitle',
  defaultSize: 'S',

  render(container, size, stats) {
    const pct = Number(stats.duplication_percent || 0);
    const blocks = stats.duplication_blocks || [];
    const color = pct < 5 ? 'var(--status-good)'
      : pct < 15 ? 'var(--status-warn)'
        : 'var(--status-bad)';
    const label = pct < 5 ? 'clean' : pct < 15 ? 'moderate' : 'high';

    if (size === 'S') {
      container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Duplication</div>
    <div class="dash-widget-stat" style="color:${color}">${pct.toFixed(1)}%</div>
    <div class="dash-widget-sub" style="color:${color}">${label}</div>
  </div>
</div>
</div>`;
      return;
    }

    if (size === 'M') {
      const fillPct = Math.max(0, Math.min(100, pct));
      const blockCount = blocks.length;
      container.innerHTML = `
<div class="dash-kpi-m">
  <div class="dash-kpi-m-left">
    <div class="dash-widget-title">Duplication</div>
    <div class="dash-widget-stat-md" style="color:${color}">${pct.toFixed(1)}%</div>
    <div class="dash-widget-sub" style="color:${color}">${label}</div>
  </div>
  <div class="dash-kpi-m-sep"></div>
  <div class="dash-kpi-m-right">
    <div style="font-size:var(--text-xs);color:var(--muted);margin-bottom:6px">Duplicated blocks</div>
    <div class="dash-widget-stat-md" style="font-size:28px;color:${color}">${blockCount}</div>
    <div class="dash-kpi-bar-row" style="margin-top:8px;">
      <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${fillPct}%;background:${color}"></div></div>
      <span class="dash-kpi-bar-val">${pct.toFixed(1)}%</span>
    </div>
  </div>
</div>`;
      return;
    }

    // L: stat + top duplicate blocks list
    const fillPct = Math.max(0, Math.min(100, pct));
    const blockRows = blocks.slice(0, 5).map((blk, i) => {
      const occ = blk.occurrences || [];
      const first = occ[0] || {};
      const fname = String(first.file || '').split('/').pop();
      const fileJSON = JSON.stringify(first.file || '').replace(/"/g, '&quot;');
      return `<div class="dash-kpi-bar-row" style="cursor:pointer" onclick="_dashDrill(${fileJSON}, null)">
  <span class="dash-kpi-bar-label" title="${_dashEscape(first.file || '')}">${_dashEscape(fname)}</span>
  <div class="dash-kpi-bar-track"><div class="dash-kpi-bar-fill" style="width:${Math.round(occ.length / (blocks[0]?.occurrences?.length || 1) * 100)}%;background:${color}"></div></div>
  <span class="dash-kpi-bar-val">${occ.length}×</span>
</div>`;
    }).join('');

    container.innerHTML = `
<div class="dash-kpi-l">
  <div class="dash-kpi-l-head">
    <div class="dash-widget-title">Duplication</div>
    <div class="dash-widget-stat-lg" style="color:${color}">${pct.toFixed(1)}%</div>
    <div class="dash-widget-sub" style="color:${color}">${label} &middot; ${blocks.length} blocks</div>
  </div>
  <div class="dash-kpi-divider"></div>
  <div class="dash-kpi-l-body">
    <div class="dash-kpi-bar-row" style="flex:0 0 auto;margin-bottom:4px;">
      <div class="dash-kpi-bar-track" style="height:6px;border-radius:3px;">
        <div class="dash-kpi-bar-fill" style="width:${fillPct}%;background:${color};border-radius:3px;"></div>
      </div>
    </div>
    ${blockRows || '<span class="dash-kpi-empty">No duplicate blocks</span>'}
  </div>
</div>`;
  },

  renderDetail(container, stats) {
        // ── data ─────────────────────────────────────────────────────────────
        const pct    = Number(stats.duplication_percent || 0);
        const blocks = stats.duplication_blocks || [];
        const color  = pct < 5  ? 'var(--status-good)'
                     : pct < 15 ? 'var(--status-warn)'
                     :             'var(--status-bad)';
        const label  = pct < 5 ? 'clean' : pct < 15 ? 'moderate' : 'high';
        const fillPct = Math.max(0, Math.min(100, pct));

        // Collect unique affected files across all blocks
        const affectedFiles = new Set();
        blocks.forEach(blk => (blk.occurrences || []).forEach(o => { if (o.file) affectedFiles.add(o.file); }));

        // ── hero visual: gauge bar ────────────────────────────────────────────
        const heroVisual = `
<div class="dash-dup-detail-gauge">
    <div class="dash-dup-detail-gauge__bar-wrap">
        <div class="dash-dup-detail-gauge__bar" style="width:${fillPct}%;background:${color}"></div>
    </div>
    <div class="dash-dup-detail-gauge__labels">
        <span style="color:var(--muted);font-size:10px">0%</span>
        <span style="color:${color};font-weight:600;font-size:11px">${label}</span>
        <span style="color:var(--muted);font-size:10px">100%</span>
    </div>
</div>`;

        // ── block rows ────────────────────────────────────────────────────────
        const blockRows = blocks.map((blk, i) => {
            const occ = blk.occurrences || [];
            const first = occ[0] || {};
            const fileShort = String(first.file || '').split('/').pop();
            const allFiles  = [...new Set(occ.map(o => o.file).filter(Boolean))];
            return `<div class="dash-kpi-detail-row dash-dup-detail-block-row" data-clickable="true"
                title="${_dashEscape(first.file || '')}"
                onclick="_dashOpenFileGroupDrilldown(${_dashJson('Duplication block ' + (i + 1))}, ${_dashJson(allFiles.map(f => ({ file: f })))})">
                <span class="dash-kpi-detail-row__rank">${i + 1}</span>
                <span class="dash-kpi-detail-row__name">
                    ${_dashEscape(fileShort)}<span class="dash-dup-detail-meta">:${first.line || '?'} · ${_dashEscape(blk.sample ? blk.sample.trim().slice(0, 60) : '')}</span>
                </span>
                <span class="dash-kpi-detail-row__value">${occ.length}×</span>
            </div>`;
        }).join('') || `<div class="dash-empty">✅ ${_dashEscape(_dashT('dashDuplicationNone'))}</div>`;

        // ── render ────────────────────────────────────────────────────────────
        const summaryText = blocks.length
            ? `${blocks.length} duplicated block${blocks.length !== 1 ? 's' : ''} detected across ${affectedFiles.size} file${affectedFiles.size !== 1 ? 's' : ''}. ${label.charAt(0).toUpperCase() + label.slice(1)} duplication level.`
            : `No duplicated blocks detected. Codebase is clean.`;

        container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--duplication">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Code duplication</div>
      <h2 class="dash-kpi-detail__title">Duplication Analysis</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value" style="color:${color}">${pct.toFixed(1)}</span>
        <span class="dash-kpi-detail__primary-suffix">%</span>
      </div>
      <p class="dash-kpi-detail__summary">${_dashEscape(summaryText)}</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${heroVisual}</div>
  </section>
  <div class="dash-kpi-detail__sections">
${_dashKpiDetailSectionHTML({
    title: 'Snapshot',
    body: _dashKpiDetailStatsHTML([
        { value: `${pct.toFixed(1)}%`, label: 'duplication', color },
        { value: `${blocks.length}`,   label: 'blocks' },
        { value: `${affectedFiles.size}`, label: 'files affected' },
    ]),
})}
${_dashKpiDetailSectionHTML({
    title: 'Duplicated Blocks',
    body: `<div class="dash-dup-detail-list">${blockRows}</div>`,
})}
  </div>
</div>`;
    },
});
