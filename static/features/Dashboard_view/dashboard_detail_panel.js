// @module Dashboard_view/dashboard_detail_panel
// Shared zoom-to-center detail overlay.
// Usage: _dashOpenDetailPanel(widgetId, originRect)
//   originRect = the widget's getBoundingClientRect()

let _dashDetailEscBound = false;
let _dashDetailOpen     = false;

function _dashOpenDetailPanel(widgetId, originRect) {
    if (_dashDetailOpen) {
        // Destroy charts and remove old DOM, then open the new panel next frame
        // so Chart.js ResizeObserver callbacks fire before the canvas nodes vanish.
        _dashCloseDetailPanel(true);
        requestAnimationFrame(() => _dashOpenDetailPanel(widgetId, originRect));
        return;
    }

    const widget = _dashWidgetRegistry[widgetId];
    if (!widget || typeof widget.renderDetail !== 'function') return;

    // Compute transform-origin so the panel appears to expand from the widget
    const narrow    = window.innerWidth <= 720;
    const panelW    = narrow ? Math.max(280, window.innerWidth - 16) : Math.min(1440, Math.max(720, window.innerWidth - 48));
    const panelH    = narrow ? Math.max(360, window.innerHeight - 16) : Math.min(980, Math.max(560, window.innerHeight - 48));
    const panelLeft = (window.innerWidth  - panelW) / 2;
    const panelTop  = (window.innerHeight - panelH) / 2;
    const originX   = (originRect.left + originRect.width  / 2) - panelLeft;
    const originY   = (originRect.top  + originRect.height / 2) - panelTop;

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'dash-detail-backdrop';
    backdrop.id = 'dash-detail-backdrop';

    // Panel
    const panel = document.createElement('div');
    panel.className = `dash-detail-panel dash-detail-report-panel dash-detail-report-panel--${widgetId}`;
    panel.id = 'dash-detail-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.style.transformOrigin = `${originX}px ${originY}px`;

    const label = _dashT(widget.detailLabelKey || widget.labelKey || widget.id) || widget.id;
    panel.setAttribute('aria-label', `${label} detail`);

    panel.innerHTML = `
<div class="dash-detail-head">
  <div class="dash-detail-head-title">
    <span class="dash-detail-head-label">Detail</span>
  </div>
  <button class="dash-detail-close" id="dash-detail-close" type="button" aria-label="Close">×</button>
</div>
<div class="dash-detail-body dash-report-body dash-report-body--${widgetId}" id="dash-detail-body">
  ${_dashDetailHeroHTML(widgetId, widget, DATA.stats || {})}
  <div class="dash-report-details dash-report-details--${widgetId}" id="dash-detail-report-details"></div>
</div>`;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const body = document.getElementById('dash-detail-report-details');

    // Defer renderDetail one frame so the panel's layout (and the canvas's
    // offsetWidth/offsetHeight) is fully resolved before Chart.js captures
    // size. Without this, charts can be created at 0x0 right after navigation
    // (e.g. graph→dashboard) and never recover when no follow-up resize fires.
    requestAnimationFrame(() => {
        if (body && typeof widget.renderDetail === 'function') {
            try {
                widget.renderDetail(body, DATA.stats);
            } catch (err) {
                console.error(`[dashboard] detail for ${widgetId} failed:`, err);
                body.innerHTML = `<div class="dash-empty">⚠ detail unavailable</div>`;
            }
        }
    });

    // Animate open (next frame so initial state is applied first)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            backdrop.classList.add('open');
            panel.classList.add('open');
        });
    });

    _dashDetailOpen = true;

    // Close handlers
    backdrop.addEventListener('click', () => _dashCloseDetailPanel());
    panel.querySelector('#dash-detail-close')
        ?.addEventListener('click', () => _dashCloseDetailPanel());

    if (!_dashDetailEscBound) {
        document.addEventListener('keydown', _dashDetailKeyHandler);
        _dashDetailEscBound = true;
    }
}

function _dashDetailHeroHTML(widgetId, widget, stats) {
    const model = _dashDetailReportModel(widgetId, widget, stats || {});
    const metrics = (model.metrics || []).map(m => _dashReportMetricHTML(m)).join('');
    const visual = model.visual || _dashReportBarsHTML(model.metrics || []);
    const reverse = model.reverse ? ' dash-report-hero--reverse' : '';
    const accentStyle = model.accent ? ` style="--dash-report-accent:${model.accent}"` : '';
    return `
<section class="dash-report-hero${reverse}"${accentStyle}>
  <div class="dash-report-hero-copy">
    <div class="dash-report-eyebrow">${_dashEscape(model.eyebrow || 'Dashboard report')}</div>
    <h2 class="dash-report-title">${_dashEscape(model.title || _dashT(widget.labelKey || widget.id) || widget.id)}</h2>
    <div class="dash-report-primary">
      <span class="dash-report-primary-value"${model.color ? ` style="color:${model.color}"` : ''}>${_dashEscape(String(model.value ?? ''))}</span>
      ${model.suffix ? `<span class="dash-report-primary-suffix">${_dashEscape(model.suffix)}</span>` : ''}
    </div>
    <p class="dash-report-summary">${_dashEscape(model.summary || '')}</p>
    ${metrics ? `<div class="dash-report-metrics">${metrics}</div>` : ''}
  </div>
  <div class="dash-report-hero-visual">${visual}</div>
</section>`;
}

function _dashReportMetricHTML(m) {
    return `
<div class="dash-report-metric">
  <span class="dash-report-metric-value"${m.color ? ` style="color:${m.color}"` : ''}>${_dashEscape(String(m.value ?? ''))}</span>
  <span class="dash-report-metric-label">${_dashEscape(m.label || '')}</span>
</div>`;
}

function _dashReportBarsHTML(items) {
    const rows = (items || []).slice(0, 5);
    const vals = rows.map(m => Number(m.raw ?? String(m.value ?? '').replace(/[^\d.-]/g, '')) || 0);
    const max = Math.max(1, ...vals);
    return `
<div class="dash-report-bars">
  ${rows.map((m, i) => {
        const pct = Math.max(4, Math.round((vals[i] || 0) / max * 100));
        const color = m.color || _dashAccentStop(i);
        return `<div class="dash-report-bar-row">
  <span>${_dashEscape(m.label || '')}</span>
  <div><i style="width:${pct}%;background:${color}"></i></div>
  <b>${_dashEscape(String(m.value ?? ''))}</b>
</div>`;
    }).join('')}
</div>`;
}

function _dashReportFileExts(limit) {
    const map = new Map();
    for (const files of Object.values((window.DATA || {}).files_by_module || {})) {
        for (const f of (files || [])) {
            const ext = (f.path || '').split('.').pop() || 'unknown';
            map.set(ext, (map.get(ext) || 0) + 1);
        }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit || 5);
}

function _dashDetailReportModel(widgetId, widget, stats) {
    const fmt = typeof _dashFmtExactNum === 'function' ? _dashFmtExactNum : _dashFmtNum;
    const title = _dashT(widget.detailLabelKey || widget.labelKey || widget.id) || widget.id;
    const modules = (window.DATA && DATA.modules || []).length;
    const extCount = _dashReportFileExts(1000).length;
    const files = stats.files || 0;
    const funcs = stats.functions || 0;
    const loc = stats.loc_total || 0;
    const base = {
        title,
        eyebrow: 'Engineering dashboard',
        value: fmt(files),
        suffix: 'files',
        summary: `${fmt(funcs)} functions and ${fmt(loc)} lines are represented in the report below.`,
        metrics: [
            { label: 'Functions', value: fmt(funcs), raw: funcs },
            { label: 'LOC', value: fmt(loc), raw: loc },
            { label: 'Modules', value: fmt(modules), raw: modules },
        ],
    };

    if (widgetId === 'overview') {
        return Object.assign(base, {
            title: 'Codebase Snapshot',
            eyebrow: 'Repository overview',
            value: fmt(files),
            suffix: 'tracked files',
            summary: `${fmt(funcs)} functions across ${fmt(modules)} modules with ${fmt(extCount)} file extensions.`,
            metrics: [
                { label: 'Functions', value: fmt(funcs), raw: funcs },
                { label: 'LOC', value: fmt(loc), raw: loc },
                { label: 'File types', value: fmt(extCount), raw: extCount },
                { label: 'Calls', value: fmt(stats.calls || 0), raw: stats.calls || 0 },
            ],
            visual: _dashReportBarsHTML(_dashReportFileExts(5).map(([ext, count], i) => ({ label: `.${ext}`, value: count, raw: count, color: _dashAccentStop(i) }))),
        });
    }

    if (widgetId === 'code_health') {
        const score = Number(stats.code_health_score || 0);
        const color = typeof _dashHealthColor === 'function' ? _dashHealthColor(score) : 'var(--accent)';
        const bd = stats.code_health_breakdown || {};
        const metric = (key, label) => {
            const value = Number(bd[key] || 0);
            return { label, value: value.toFixed(1), raw: value, color: typeof _dashHealthColor === 'function' ? _dashHealthColor(value) : undefined };
        };
        const metrics = [
            metric('complexity', _dashT('dashHealthComplexity') || 'Complexity'),
            metric('coupling', _dashT('dashHealthCoupling') || 'Coupling'),
            metric('dead_code', _dashT('dashHealthDeadCode') || 'Dead code'),
            metric('duplication', _dashT('dashHealthDuplication') || 'Duplication'),
        ];
        return Object.assign(base, {
            title: _dashT('dashCodeHealthTitle') || 'Code Health',
            eyebrow: 'Quality score',
            value: score.toFixed(1),
            suffix: '/ 10',
            color,
            accent: color,
            summary: score >= 8 ? 'Current code health is strong; the lower panels rank the weakest subscores.' : 'Current code health has risk areas; the lower panels rank the pressure points.',
            metrics,
            visual: typeof _dashHealthGaugeSvg === 'function'
                ? _dashHealthGaugeSvg(score, color, { scoreFont: 46, denFont: 16, denDy: 24, style: 'width:min(360px,100%);height:auto;' })
                : _dashReportBarsHTML(metrics),
        });
    }

    if (widgetId === 'kpi_files') {
        return Object.assign(base, {
            title: 'Files',
            eyebrow: 'File inventory',
            value: fmt(files),
            suffix: 'tracked',
            summary: `${fmt(extCount)} extensions distributed across ${fmt(modules)} modules.`,
            metrics: [
                { label: 'Extensions', value: fmt(extCount), raw: extCount },
                { label: 'Modules', value: fmt(modules), raw: modules },
                { label: 'Other files', value: fmt(stats.other_files || 0), raw: stats.other_files || 0 },
            ],
            visual: _dashReportBarsHTML(_dashReportFileExts(5).map(([ext, count], i) => ({ label: `.${ext}`, value: count, raw: count, color: _dashAccentStop(i) }))),
        });
    }

    if (widgetId === 'kpi_functions') {
        const modCount = Object.values((window.DATA || {}).files_by_module || {})
            .filter(list => (list || []).some(f => (f.func_count || (f.functions || []).length) > 0)).length;
        return Object.assign(base, {
            title: 'Functions',
            eyebrow: 'Function inventory',
            value: fmt(funcs),
            suffix: 'functions',
            summary: `${fmt(stats.calls || 0)} calls across ${fmt(modCount)} modules with functions.`,
            metrics: [
                { label: 'Calls', value: fmt(stats.calls || 0), raw: stats.calls || 0 },
                { label: 'Function modules', value: fmt(modCount), raw: modCount },
                { label: 'Files', value: fmt(files), raw: files },
            ],
        });
    }

    if (widgetId === 'kpi_lines') {
        const total = stats.loc_total || 1;
        const codePct = Math.round(((stats.loc_code || 0) / total) * 100);
        return Object.assign(base, {
            title: 'Line Composition',
            eyebrow: 'Source volume',
            value: fmt(stats.loc_total || 0),
            suffix: 'lines',
            summary: `${codePct}% code, ${fmt(stats.loc_comment || 0)} comment lines, ${fmt(stats.loc_blank || 0)} blank lines.`,
            metrics: [
                { label: 'Code', value: fmt(stats.loc_code || 0), raw: stats.loc_code || 0, color: _dashAccentStop(0) },
                { label: 'Comments', value: fmt(stats.loc_comment || 0), raw: stats.loc_comment || 0, color: _dashAccentStop(1) },
                { label: 'Blank', value: fmt(stats.loc_blank || 0), raw: stats.loc_blank || 0, color: 'var(--muted)' },
            ],
        });
    }

    if (widgetId === 'complexity' || widgetId === 'most_complex') {
        const top = (stats.complexity_top_offenders || [])[0] || {};
        const topScore = top.complexity || top.score || 0;
        return Object.assign(base, {
            title: widgetId === 'complexity' ? (_dashT('dashComplexityTitle') || 'Complexity') : 'Most Complex',
            eyebrow: 'Complexity risk',
            value: widgetId === 'complexity' ? Number(stats.avg_complexity || 0).toFixed(1) : fmt(topScore),
            suffix: widgetId === 'complexity' ? 'avg' : 'top score',
            summary: top.name ? `Highest offender: ${top.name} in ${String(top.file || '').split('/').pop()}.` : 'No complexity offenders were reported.',
            metrics: [
                { label: 'Offenders', value: fmt((stats.complexity_top_offenders || []).length), raw: (stats.complexity_top_offenders || []).length },
                { label: 'Average', value: Number(stats.avg_complexity || 0).toFixed(1), raw: stats.avg_complexity || 0 },
                { label: 'Top score', value: fmt(topScore), raw: topScore },
            ],
            reverse: widgetId === 'most_complex',
        });
    }

    if (widgetId === 'tech_debt') {
        const bd = stats.tech_debt_breakdown || {};
        const minutes = Object.values(bd).reduce((sum, v) => sum + Number(v || 0), 0);
        return Object.assign(base, {
            title: _dashT('dashTechDebtTitle') || 'Tech Debt',
            eyebrow: 'Remediation estimate',
            value: Number(stats.tech_debt_hours || 0).toFixed(1),
            suffix: 'hours',
            color: '#DFA745',
            accent: '#DFA745',
            summary: `${fmt(minutes)} estimated minutes distributed across tracked debt categories.`,
            metrics: Object.entries(bd).map(([key, value], i) => ({ label: key.replace('_', ' '), value: `${fmt(value)}m`, raw: value, color: _dashAccentStop(i) })),
        });
    }

    if (widgetId === 'duplication') {
        const pct = Number(stats.duplication_percent || 0);
        const color = pct < 5 ? 'var(--status-good)' : pct < 15 ? 'var(--status-warn)' : 'var(--status-bad)';
        return Object.assign(base, {
            title: _dashT('dashDuplicationTitle') || 'Duplication',
            eyebrow: 'Copy-paste risk',
            value: pct.toFixed(1),
            suffix: '%',
            color,
            accent: color,
            summary: `${fmt((stats.duplication_blocks || []).length)} duplicate blocks are tracked for inspection.`,
            metrics: [
                { label: 'Blocks', value: fmt((stats.duplication_blocks || []).length), raw: (stats.duplication_blocks || []).length, color },
                { label: 'Duplicated', value: `${pct.toFixed(1)}%`, raw: pct, color },
            ],
        });
    }

    if (widgetId === 'dead_code') {
        const count = stats.dead_code_count || 0;
        const total = stats.functions || 1;
        const pct = Math.min(100, Math.round((count / total) * 100));
        const color = pct > 20 ? '#c57429' : pct > 5 ? '#DFA745' : '#A4B55B';
        const fileCount = new Set((stats.dead_code_symbols || []).map(s => s.file)).size;
        return Object.assign(base, {
            title: _dashT('dashDeadCode') || 'Dead Code',
            eyebrow: 'Unused symbol risk',
            value: fmt(count),
            suffix: 'symbols',
            color,
            accent: color,
            summary: `${pct}% of tracked functions appear unused across ${fmt(fileCount)} files.`,
            metrics: [
                { label: 'Function share', value: `${pct}%`, raw: pct, color },
                { label: 'Functions', value: fmt(total), raw: total },
                { label: 'Files touched', value: fmt(fileCount), raw: fileCount },
            ],
        });
    }

    if (widgetId === 'structure') {
        return Object.assign(base, {
            title: _dashT('dashStructureFileTypes') || 'Structure',
            eyebrow: 'Repository shape',
            value: fmt(files),
            suffix: 'files',
            summary: `${fmt(modules)} modules, ${fmt(Object.keys(stats.type_counts || {}).length)} file types, ${fmt(Object.keys(stats.language_distribution || {}).length)} extensions.`,
            metrics: [
                { label: 'Modules', value: fmt(modules), raw: modules },
                { label: 'File types', value: fmt(Object.keys(stats.type_counts || {}).length), raw: Object.keys(stats.type_counts || {}).length },
                { label: 'Extensions', value: fmt(Object.keys(stats.language_distribution || {}).length), raw: Object.keys(stats.language_distribution || {}).length },
            ],
        });
    }

    if (widgetId === 'circular_deps') {
        const cycles = stats.top_circular_deps || [];
        const cycleFiles = new Set(cycles.flat()).size;
        return Object.assign(base, {
            title: _dashT('dashCircularDepsTitle') || 'Circular Dependencies',
            eyebrow: 'Dependency risk',
            value: fmt(stats.circular_dependencies || 0),
            suffix: 'cycles',
            color: (stats.circular_dependencies || 0) ? 'var(--status-warn)' : 'var(--status-good)',
            summary: `${fmt(cycles.length)} representative dependency chains are listed below.`,
            metrics: [
                { label: 'Cycle files', value: fmt(cycleFiles), raw: cycleFiles },
                { label: 'Chains', value: fmt(cycles.length), raw: cycles.length },
            ],
        });
    }

    if (widgetId === 'coupling') {
        const imported = stats.top_imported_files || [];
        const total = imported.reduce((sum, it) => sum + Number(it.count || 0), 0);
        const top3 = imported.slice(0, 3).reduce((sum, it) => sum + Number(it.count || 0), 0);
        const conc = total ? Math.round((top3 / total) * 100) : 0;
        return Object.assign(base, {
            title: _dashT('dashCouplingTopImported') || 'Coupling',
            eyebrow: 'Import concentration',
            value: fmt(imported.length),
            suffix: 'hotspots',
            summary: `Top three imported files account for ${conc}% of tracked imports.`,
            metrics: [
                { label: 'Concentration', value: `${conc}%`, raw: conc },
                { label: 'Callers', value: fmt((stats.top_caller_files || []).length), raw: (stats.top_caller_files || []).length },
                { label: 'Imports', value: fmt(total), raw: total },
            ],
        });
    }

    if (widgetId === 'entry_points') {
        const entry = stats.entry_points || (stats.entry_point_files || []).length;
        const isolated = stats.isolated_files || (stats.isolated_file_paths || []).length;
        return Object.assign(base, {
            title: _dashT('dashEntryPointsTitle') || 'Entry Points',
            eyebrow: 'Graph reachability',
            value: fmt(entry),
            suffix: 'entry files',
            color: 'var(--status-good)',
            summary: `${fmt(isolated)} files are isolated from the import graph.`,
            metrics: [
                { label: 'Isolated', value: fmt(isolated), raw: isolated },
                { label: 'Entry files', value: fmt((stats.entry_point_files || []).length), raw: (stats.entry_point_files || []).length },
            ],
        });
    }

    if (widgetId === 'graph_intelligence') {
        const hotspots = stats.hotspot_nodes || [];
        const surprising = stats.surprising_connections || [];
        return Object.assign(base, {
            title: _dashT('dashGraphHotspots') || 'Graph Intelligence',
            eyebrow: 'Graph signals',
            value: fmt(hotspots.length),
            suffix: 'hotspots',
            summary: `${fmt(surprising.length)} surprising connections are available for review.`,
            metrics: [
                { label: 'Surprising', value: fmt(surprising.length), raw: surprising.length },
                { label: 'Top degree', value: fmt(hotspots[0]?.degree || 0), raw: hotspots[0]?.degree || 0 },
            ],
        });
    }

    if (widgetId === 'health_trend') {
        const history = stats.health_history || [];
        const latest = history[history.length - 1] || null;
        const prev = history.length > 1 ? history[history.length - 2] : null;
        const score = latest ? Number(latest.score || 0) : 0;
        const delta = latest && prev ? score - Number(prev.score || 0) : 0;
        const color = typeof _dashHealthColor === 'function' ? _dashHealthColor(score) : 'var(--accent)';
        return Object.assign(base, {
            title: _dashT('dashHealthTrendTitle') || 'Health Trend',
            eyebrow: 'Historical quality',
            value: score.toFixed(1),
            suffix: '/ 10 latest',
            color,
            accent: color,
            summary: `${fmt(history.length)} health data points. Latest date: ${(latest && (latest.date || (latest.ts || '').slice(0, 10))) || 'n/a'}.`,
            metrics: [
                { label: 'Delta', value: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`, raw: Math.abs(delta), color: delta > 0 ? 'var(--status-good)' : delta < 0 ? 'var(--status-bad)' : 'var(--muted)' },
                { label: 'Points', value: fmt(history.length), raw: history.length },
            ],
        });
    }

    if (widgetId === 'bus_factor') {
        const items = stats.bus_factor_files || [];
        const high = items.filter(f => f.risk === 'high').length;
        const med = items.filter(f => f.risk === 'medium').length;
        const low = items.filter(f => f.risk === 'low').length;
        return Object.assign(base, {
            title: _dashT('dashBusFactorTitle') || 'Bus Factor',
            eyebrow: 'Ownership concentration',
            value: fmt(high),
            suffix: 'high risk',
            color: high ? 'var(--status-bad)' : 'var(--status-good)',
            summary: `${fmt(items.length)} files analyzed for ownership concentration.`,
            metrics: [
                { label: 'Medium', value: fmt(med), raw: med, color: 'var(--status-warn)' },
                { label: 'Low', value: fmt(low), raw: low, color: 'var(--status-good)' },
                { label: 'Files', value: fmt(items.length), raw: items.length },
            ],
        });
    }

    if (widgetId === 'branch_overview') {
        const data = stats.branch_analysis || {};
        const branches = data.branches || [];
        const current = branches.find(b => b.is_current) || branches[0] || {};
        return Object.assign(base, {
            title: _dashT('dashBranchOverviewTitle') || 'Branch Overview',
            eyebrow: 'Branch analysis',
            value: fmt(branches.length),
            suffix: 'branches',
            summary: current.name ? `Current focus: ${current.name}. Ahead ${current.ahead || 0}, behind ${current.behind || 0}.` : 'Branch data will load in the report below when available.',
            metrics: [
                { label: 'Ahead', value: fmt(current.ahead || 0), raw: current.ahead || 0, color: 'var(--status-good)' },
                { label: 'Behind', value: fmt(current.behind || 0), raw: current.behind || 0, color: 'var(--status-bad)' },
                { label: 'Hotspot branches', value: fmt(branches.filter(b => (b.touches_hotspots || []).length).length), raw: branches.filter(b => (b.touches_hotspots || []).length).length },
            ],
        });
    }

    if (widgetId === 'security') {
        const f = stats.security_findings || {};
        const score = Number(f.score == null ? 10 : f.score);
        const color = typeof _dashSecScoreColor === 'function' ? _dashSecScoreColor(score) : (score >= 8 ? 'var(--status-good)' : score >= 5 ? 'var(--status-warn)' : 'var(--status-bad)');
        return Object.assign(base, {
            title: _dashT('dashSecurityTitle') || 'Security',
            eyebrow: 'Static security scan',
            value: score.toFixed(1),
            suffix: '/ 10',
            color,
            accent: color,
            summary: `${fmt(f.total || 0)} findings across high, medium, and low severity buckets.`,
            metrics: [
                { label: 'High', value: fmt((f.counts || {}).high || 0), raw: (f.counts || {}).high || 0, color: 'var(--status-bad)' },
                { label: 'Medium', value: fmt((f.counts || {}).medium || 0), raw: (f.counts || {}).medium || 0, color: 'var(--status-warn)' },
                { label: 'Low', value: fmt((f.counts || {}).low || 0), raw: (f.counts || {}).low || 0, color: 'var(--muted)' },
            ],
        });
    }

    if (widgetId === 'commit_heatmap') {
        const rows = stats.commit_activity_daily || [];
        const active = rows.filter(r => Number(r.commits || 0) > 0).length;
        const peak = rows.reduce((best, r) => Number(r.commits || 0) > Number(best.commits || 0) ? r : best, {});
        return Object.assign(base, {
            title: _dashT('dashTemporalHeatmap') || 'Commit Heatmap',
            eyebrow: 'Temporal activity',
            value: fmt(stats.commits_analyzed || 0),
            suffix: 'commits',
            summary: `${active} active days in the analyzed window. Peak day: ${peak.date || 'n/a'} with ${peak.commits || 0} commits.`,
            metrics: [
                { label: 'Active days', value: fmt(active), raw: active },
                { label: 'Peak day', value: fmt(peak.commits || 0), raw: peak.commits || 0 },
                { label: 'Changed files', value: fmt((stats.file_churn || []).length), raw: (stats.file_churn || []).length },
            ],
            reverse: true,
        });
    }

    if (widgetId === 'churn_timeline') {
        const weeks = stats.churn_timeline || [];
        const adds = weeks.reduce((sum, b) => sum + Number(b.additions || 0), 0);
        const dels = weeks.reduce((sum, b) => sum + Number(b.deletions || 0), 0);
        return Object.assign(base, {
            title: _dashT('dashTemporalChurn') || 'Code Churn',
            eyebrow: 'Temporal change',
            value: fmt(stats.commits_analyzed || 0),
            suffix: 'commits',
            summary: `${fmt(weeks.length)} weekly buckets with ${fmt(adds)} additions and ${fmt(dels)} deletions.`,
            metrics: [
                { label: 'Weeks', value: fmt(weeks.length), raw: weeks.length },
                { label: 'Additions', value: fmt(adds), raw: adds, color: 'var(--status-good)' },
                { label: 'Deletions', value: fmt(dels), raw: dels, color: 'var(--status-bad)' },
            ],
        });
    }

    if (widgetId === 'issues') {
        return Object.assign(base, {
            title: _dashT('dashIssuesOverviewTitle') || 'Architecture Issues',
            eyebrow: 'Architecture signals',
            value: fmt(stats.circular_dependencies || 0),
            suffix: 'cycles',
            color: (stats.circular_dependencies || 0) ? 'var(--status-warn)' : 'var(--status-good)',
            summary: `${fmt(stats.uncalled_functions || 0)} dead functions and ${fmt(stats.entry_points || 0)} entry points are summarized below.`,
            metrics: [
                { label: 'Dead functions', value: fmt(stats.uncalled_functions || 0), raw: stats.uncalled_functions || 0 },
                { label: 'Entry points', value: fmt(stats.entry_points || 0), raw: stats.entry_points || 0, color: 'var(--status-good)' },
                { label: 'Isolated', value: fmt(stats.isolated_files || 0), raw: stats.isolated_files || 0 },
            ],
        });
    }

    return base;
}

function _dashCloseDetailPanel(immediate) {
    const backdrop = document.getElementById('dash-detail-backdrop');
    const panel    = document.getElementById('dash-detail-panel');
    if (!backdrop && !panel) return;

    _dashDetailOpen = false;
    if (typeof _dashHideChartTooltip === 'function') _dashHideChartTooltip();

    // Destroy Chart.js instances while the canvas nodes are still in the DOM.
    // This lets any pending ResizeObserver callbacks fire against an already-
    // destroyed chart rather than a live one attached to a detached node.
    const body = document.getElementById('dash-detail-body');
    if (body) {
        body.querySelectorAll('canvas').forEach(canvas => {
            if (canvas.id && _dashCharts && _dashCharts[canvas.id]) {
                try { _dashCharts[canvas.id].destroy(); } catch (_) {}
                delete _dashCharts[canvas.id];
            }
        });
    }

    const removeDom = () => {
        backdrop?.remove();
        panel?.remove();
    };

    if (immediate) {
        // One rAF so ResizeObserver callbacks flush before the nodes are detached.
        requestAnimationFrame(removeDom);
        return;
    }

    // Animate close, then remove after transition.
    backdrop?.classList.remove('open');
    panel?.classList.remove('open');
    setTimeout(removeDom, 270);
}

function _dashDetailKeyHandler(e) {
    if (e.key === 'Escape' && _dashDetailOpen) {
        e.stopPropagation();
        _dashCloseDetailPanel();
    }
}
