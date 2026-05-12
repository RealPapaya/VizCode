// @module Dashboard_view/widgets/widget_duplication

_dashRegisterWidget({
    id: 'duplication',
    labelKey: 'dashDuplicationTitle',
    defaultSize: 'S',

    render(container, size, stats) {
        const pct    = Number(stats.duplication_percent || 0);
        const blocks = stats.duplication_blocks || [];
        const color  = pct < 5  ? 'var(--status-good)'
                     : pct < 15 ? 'var(--status-warn)'
                     : 'var(--status-bad)';
        const label  = pct < 5 ? 'clean' : pct < 15 ? 'moderate' : 'high';

        if (size === 'S') {
            const dupFiles = [...new Set(blocks.flatMap(b => (b.occurrences || []).map(o => o.file)).filter(Boolean))];
            const pills = [
                { label: 'Blocks', value: blocks.length, onclick: `_dashOpenFileGroupDrilldown('Duplicated files', ${_dashJson(dupFiles)})` },
                { label: 'Files', value: dupFiles.length, onclick: `_dashOpenFileGroupDrilldown('Duplicated files', ${_dashJson(dupFiles)})` },
                { label, value: `${pct.toFixed(1)}%`, muted: pct < 5 },
            ];
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Duplication</div>
    <div class="dash-widget-stat" style="color:${color}">${pct.toFixed(1)}%</div>
    <div class="dash-widget-sub" style="color:${color}">${label}</div>
    ${_dashMiniPills(pills)}
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
            const filesJSON = _dashJson(occ.map(o => ({ file: o.file, line: o.line })));
            return `<div class="dash-kpi-bar-row" style="cursor:pointer" onclick="_dashOpenFileGroupDrilldown('Duplicate block ${i + 1}', ${filesJSON}, { meta: f => f.line ? ':' + f.line : '' })">
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
            const filesJSON = _dashJson(occurrences.map(o => ({ file: o.file, line: o.line })));
            return `<div class="dash-dup-row" data-clickable="true" onclick="_dashOpenFileGroupDrilldown('Duplicate block ${i + 1}', ${filesJSON}, { meta: f => f.line ? ':' + f.line : '' })">
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
