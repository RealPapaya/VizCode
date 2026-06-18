// @module Dashboard_view/widgets/widget_kpi_strip
// KPI strip — files / functions / real LOC / Code Health badge.

function _dashRenderKpiStrip(container, stats) {
  if (!container) return;

  const score = Number(stats.code_health_score || 0);
  const healthColor = _dashHealthColor(score);

  // KPI strip is a single accent family — health card uses semantic status
  // colour (the only non-accent allowed). DASHBOARD_DESIGN_SPEC.md §5 rule 2.
  const ACCENT = 'var(--accent)';
  const cards = [
    {
      id: 'files',
      label: _dashT('dashKpiFiles'),
      value: _dashFmtNum(stats.files || 0),
      sub: `${stats.other_files || 0} other`,
      accent: ACCENT,
    },
    {
      id: 'functions',
      label: _dashT('dashKpiFunctions'),
      value: _dashFmtNum(stats.functions || 0),
      sub: `${(stats.calls || 0).toLocaleString()} calls`,
      accent: ACCENT,
    },
    {
      id: 'loc',
      label: _dashT('dashKpiLoc'),
      value: _dashFmtNum(stats.loc_total || 0),
      sub: `${_dashFmtNum(stats.loc_code || 0)} code · ${_dashFmtNum(stats.loc_comment || 0)} comments`,
      accent: ACCENT,
    },
    {
      id: 'health',
      label: _dashT('dashKpiHealth'),
      value: score.toFixed(1) + ' / 10',
      sub: _dashHealthLabel(score),
      accent: healthColor,
    },
  ];

  container.innerHTML = `
<div class="dash-stat-strip">
${cards.map(c => `
<div class="dash-stat-card" data-kpi-id="${c.id}" style="--ds-accent:${c.accent}; cursor: pointer;">
  <div class="dash-stat-label">${_dashEscape(c.label)}</div>
  <div class="dash-stat-value">${_dashEscape(c.value)}</div>
  <div class="dash-stat-sub">${_dashEscape(c.sub)}</div>
</div>`).join('')}
</div>
<div id="dash-kpi-details" class="dash-kpi-details" style="display:none; margin-top:16px;"></div>`;

  let currentOpen = null;
  const detailHost = container.querySelector('#dash-kpi-details');

  container.querySelectorAll('.dash-stat-card').forEach(card => {
    card.addEventListener('click', () => {
      const kpiId = card.dataset.kpiId;
      if (currentOpen === kpiId) {
        // Toggle close
        detailHost.style.display = 'none';
        detailHost.innerHTML = '';
        currentOpen = null;
        container.querySelectorAll('.dash-stat-card').forEach(c => c.style.borderColor = 'var(--border)');
      } else {
        // Open new
        currentOpen = kpiId;
        container.querySelectorAll('.dash-stat-card').forEach(c => c.style.borderColor = 'var(--border)');
        card.style.borderColor = card.style.getPropertyValue('--ds-accent');
        detailHost.style.display = 'block';
        _dashRenderKpiDetail(detailHost, kpiId, stats);
      }
    });
  });
}

function _dashRenderKpiDetail(host, kpiId, stats) {
  host.innerHTML = '';

  if (kpiId === 'files') {
    const langMap = new Map();
    for (const [modId, files] of Object.entries(DATA.files_by_module || {})) {
      (files || []).forEach(f => {
        const ext = f.path.split('.').pop() || 'unknown';
        langMap.set(ext, (langMap.get(ext) || 0) + 1);
      });
    }
    const langs = Array.from(langMap.entries()).sort((a, b) => b[1] - a[1]);
    const max = langs.length ? langs[0][1] : 1;

    host.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title">${_dashEscape(_dashT('dashKpiFiles'))} Breakdown</div>
  <div class="dash-list" style="max-height:300px;overflow-y:auto;margin-top:12px;">
    ${langs.map(([ext, count]) => {
      const pct = Math.round((count / max) * 100);
      return `
        <div class="dash-health-row">
          <div class="dash-health-row-label">.${_dashEscape(ext)}</div>
          <div class="dash-health-row-track" style="flex:1;"><div class="dash-health-row-fill" style="width:${pct}%;background:var(--accent)"></div></div>
          <div class="dash-health-row-value">${count}</div>
        </div>`;
    }).join('')}
  </div>
</div>`;

  } else if (kpiId === 'functions') {
    const allFuncs = [];
    for (const [modId, files] of Object.entries(DATA.files_by_module || {})) {
      (files || []).forEach(f => {
        ((f as any).functions || []).forEach(fn => {
          allFuncs.push({ file: f.path, name: fn.name, lines: fn.lines || 0 });
        });
      });
    }
    allFuncs.sort((a, b) => b.lines - a.lines);
    const top10 = allFuncs.slice(0, 10);

    host.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title">Top 10 Longest Functions</div>
  <div class="dash-list" style="margin-top:12px;">
    ${top10.map(fn => `
    <div class="dash-list-row" data-clickable="true" onclick="_dashDrill(${_dashJson(fn.file)}, ${_dashJson(fn.name)})">
      <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        <span style="color:var(--accent);font-weight:600;font-size:12px;">${_dashEscape(fn.name)}</span>
        <span style="color:var(--muted);font-size:10px;margin-left:8px;">${_dashEscape(fn.file)}</span>
      </div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted);">${fn.lines} lines</div>
    </div>`).join('')}
  </div>
</div>`;

  } else if (kpiId === 'loc') {
    const total = stats.loc_total || 1;
    const codePct = Math.round(((stats.loc_code || 0) / total) * 100);
    const commPct = Math.round(((stats.loc_comment || 0) / total) * 100);
    const blankPct = Math.round(((stats.loc_blank || 0) / total) * 100);

    host.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title">Lines of Code Breakdown</div>
  <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px;">
    <div class="dash-health-row">
      <div class="dash-health-row-label">Code</div>
      <div class="dash-health-row-track" style="flex:1;"><div class="dash-health-row-fill" style="width:${codePct}%;background:${_dashAccentTint(1.0)}"></div></div>
      <div class="dash-health-row-value">${_dashFmtNum(stats.loc_code || 0)} <span style="color:var(--muted);font-size:10px;margin-left:4px;">(${codePct}%)</span></div>
    </div>
    <div class="dash-health-row">
      <div class="dash-health-row-label">Comments</div>
      <div class="dash-health-row-track" style="flex:1;"><div class="dash-health-row-fill" style="width:${commPct}%;background:${_dashAccentTint(0.55)}"></div></div>
      <div class="dash-health-row-value">${_dashFmtNum(stats.loc_comment || 0)} <span style="color:var(--muted);font-size:10px;margin-left:4px;">(${commPct}%)</span></div>
    </div>
    <div class="dash-health-row">
      <div class="dash-health-row-label">Blank</div>
      <div class="dash-health-row-track" style="flex:1;"><div class="dash-health-row-fill" style="width:${blankPct}%;background:${_dashMutedTint(0.55)}"></div></div>
      <div class="dash-health-row-value">${_dashFmtNum(stats.loc_blank || 0)} <span style="color:var(--muted);font-size:10px;margin-left:4px;">(${blankPct}%)</span></div>
    </div>
  </div>
</div>`;
  }
}

function _dashHealthLabel(score) {
  if (score >= _DASH_HEALTH_BANDS.amber) return _dashT('dashHealthGood');
  if (score >= _DASH_HEALTH_BANDS.red) return _dashT('dashHealthFair');
  return _dashT('dashHealthPoor');
}
