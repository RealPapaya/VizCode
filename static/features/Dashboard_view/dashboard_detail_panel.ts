// @module Dashboard_view/dashboard_detail_panel
// Shared zoom-to-center detail overlay.
// Usage: _dashOpenDetailPanel(widgetId, originRect)
//   originRect = the widget's getBoundingClientRect()

let _dashDetailEscBound = false;
let _dashDetailOpen     = false;
let _dashDetailSeq      = 0;
let _dashDetailCurrent  = null;

function _dashOpenDetailPanel(widgetId, originRect) {
    if (_dashDetailOpen || document.getElementById('dash-detail-panel') || document.getElementById('dash-detail-backdrop')) {
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

        const descTip = widget.descriptionKey
        ? `<button class="dash-detail-help-tip" data-tip="${_dashEscape(_dashT(widget.descriptionKey))}" aria-label="Widget description" type="button"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none"/></svg></button>`
        : '';

    panel.innerHTML = `
<div class="dash-detail-head">
  <div class="dash-detail-head-title">
    <span class="dash-detail-head-label">Detail</span>
  </div>
  ${descTip}
  <button class="dash-detail-close" id="dash-detail-close" type="button" aria-label="Close">×</button>
</div>
<div class="dash-detail-body dash-report-body dash-report-body--${widgetId}" id="dash-detail-body"></div>`;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const token = ++_dashDetailSeq;
    _dashDetailCurrent = { backdrop, panel, token };
    const body = panel.querySelector('#dash-detail-body');
    if (body) body.dataset.dashDetailWidgetId = widgetId;

    // Defer renderDetail one frame so the panel's layout (and the canvas's
    // offsetWidth/offsetHeight) is fully resolved before Chart.js captures
    // size. Without this, charts can be created at 0x0 right after navigation
    // (e.g. graph→dashboard) and never recover when no follow-up resize fires.
    requestAnimationFrame(() => {
        if (_dashDetailCurrent?.token !== token || !panel.isConnected || !body?.isConnected) return;
        if (typeof widget.renderDetail === 'function') {
            try {
                widget.renderDetail(body, DATA.stats);
                _dashEnhanceDetailInteractions(body, widgetId, DATA.stats);
                if (typeof _dashAiPromptEnhanceDetail === 'function') {
                    _dashAiPromptEnhanceDetail(body, widgetId, DATA.stats);
                }
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

function _dashGetDetailBody() {
    if (_dashDetailCurrent?.panel?.isConnected) {
        return _dashDetailCurrent.panel.querySelector('#dash-detail-body');
    }
    return document.getElementById('dash-detail-body');
}

function _dashDetailHeroHTML(widgetId, widget, stats) {
    const model: any = _dashDetailReportModel(widgetId, widget, stats || {});
    if (model.noHero) return '';
    const metrics = (model.metrics || []).map(m => _dashReportMetricHTML(m)).join('');
    const visual = model.visual || _dashReportBarsHTML(model.metrics || []);
    const reverse = model.reverse ? ' dash-report-hero--reverse' : '';
    const accentStyle = model.accent ? ` style="--dash-report-accent:${model.accent}"` : '';
    return `
<section class="dash-report-hero${reverse}"${accentStyle}>
  <div class="dash-report-hero-copy">
    <div class="dash-report-eyebrow">${_dashEscape(model.eyebrow || 'Dashboard report')}</div>
    <h2 class="dash-report-title"><span>${_dashEscape(model.title || _dashT(widget.labelKey || widget.id) || widget.id)}</span>${widget.descriptionKey ? `<button class="dash-detail-help-tip" data-tip="${_dashEscape(_dashT(widget.descriptionKey))}" aria-label="Widget description" type="button"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none"/></svg></button>` : ''}</h2>
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

function _dashReportSection({ title, subtitle, accent, body, className }: any = {}) {
    const cls = className ? ` ${className}` : '';
    const accentStyle = accent ? ` style="--dash-report-accent:${accent}"` : '';
    const subtitleHTML = subtitle && String(subtitle).includes('<')
        ? String(subtitle)
        : (subtitle ? _dashEscape(subtitle) : '');
    const head = (title || subtitle) ? `
  <div class="dash-report-section-head">
    ${title ? `<div class="dash-report-section-title">${_dashEscape(title)}</div>` : ''}
    ${subtitle ? `<div class="dash-report-section-subtitle">${subtitleHTML}</div>` : ''}
  </div>` : '';
    return `
<section class="dash-report-section${cls}"${accentStyle}>
  ${head}
  <div class="dash-report-section-body">${body || ''}</div>
</section>`;
}

function _dashReportGrid(items, { columns }: any = {}) {
    const cols = columns ? ` dash-report-grid--${columns}` : '';
    return `<div class="dash-report-grid${cols}">${(items || []).join('')}</div>`;
}

function _dashReportChart(html, { size }: any = {}) {
    const chartSize = size || 'md';
    return `<div class="dash-chart-wrap dash-report-chart dash-report-chart--${chartSize}">${html || ''}</div>`;
}

function _dashReportList(html, { className, id }: any = {}) {
    const cls = className ? ` ${className}` : '';
    const idAttr = id ? ` id="${_dashEscape(id)}"` : '';
    return `<div class="dash-report-list${cls}"${idAttr}>${html || ''}</div>`;
}

function _dashReportStats(items) {
    return `<div class="dash-report-stats">${(items || []).map(item => {
        const color = item.color ? ` style="color:${item.color}"` : '';
        return `<div class="dash-report-stat">
  <span class="dash-report-stat-value"${color}>${_dashEscape(String(item.value ?? ''))}</span>
  <small>${_dashEscape(item.label || '')}</small>
</div>`;
    }).join('')}</div>`;
}

function _dashEnhanceDetailInteractions(body, widgetId, stats) {
    if (!body) return;
    const existingTargets = _dashDetailExistingTargets(body);
    const candidates = body.querySelectorAll([
        '.dash-report-metric',
        '.dash-report-primary',
        '.dash-report-bar-row',
        '.dash-report-stat',
        '.dash-kpi-detail__primary',
        '.dash-kpi-detail-bars__row',
        '.dash-kpi-detail-stat',
        '.dash-code-health-detail-panel__primary',
        '.dash-code-health-diagnostic__weakest',
        '.dash-code-health-summary-card',
        '.dash-entry-detail-hero-stat',
        '.dash-issues-detail-status__item',
        '.dash-cyclo-detail-hist__bar',
        '.dash-coupling-detail-conc__leg-item',
        '.dash-debt-detail-comp__stack span',
        '.dash-detail-stat-row > div',
        '.dash-commit-activity-detail__primary',
        '.dash-commit-activity-detail-stats > div',
        '.dash-churn-timeline-detail__primary',
        '.dash-churn-timeline-detail-stats > div',
    ].join(','));

    candidates.forEach(el => {
        if (!el || el.closest('[data-clickable="true"], [onclick], a[href], button')) return;
        const label = _dashDetailCandidateLabel(el);
        const value = _dashDetailCandidateValue(el);
        const proxy = _dashDetailFindExistingTarget(existingTargets, label, value);
        if (proxy) {
            _dashMakeDetailElementClickable(el, () => proxy.click(), proxy.title || label);
            return;
        }
        const action = _dashDetailMetricAction(widgetId, label, value, stats || {});
        if (action) _dashMakeDetailElementClickable(el, action, label);
    });
}

function _dashDetailExistingTargets(body) {
    return [...body.querySelectorAll('[data-clickable="true"], [onclick], a[href], button')].filter(el =>
        el && !el.closest('.dash-detail-head') && !el.closest('.dash-chart-toggle')
    ).map(el => ({
        el,
        key: _dashDetailNormalize(el.textContent || ''),
        title: el.getAttribute('title') || el.getAttribute('data-tip') || '',
        click: () => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })),
    })).filter(t => t.key);
}

function _dashDetailFindExistingTarget(targets, label, value) {
    const labelKey = _dashDetailNormalize(label);
    const valueKey = _dashDetailNormalize(value);
    const keys = [
        labelKey,
        /[^\d\s.+#/\-]/u.test(valueKey) ? valueKey : '',
        _dashDetailNormalize(`${label || ''} ${value || ''}`),
    ].filter(Boolean);
    if (!keys.length) return null;
    return targets.find(t => keys.some(k => t.key === k || t.key.includes(k) || k.includes(t.key))) || null;
}

function _dashDetailCandidateLabel(el) {
    const node = el.querySelector([
        '.dash-report-metric-label',
        '.dash-report-primary-suffix',
        '.dash-report-bar-row span',
        '.dash-kpi-detail__primary-suffix',
        '.dash-kpi-detail-bars__label',
        '.dash-kpi-detail-stat__label',
        '.dash-code-health-detail-panel__primary-suffix',
        '.dash-code-health-diagnostic__weakest strong',
        '.dash-entry-detail-hero-stat__label',
        '.dash-issues-detail-status__label',
        '.dash-code-health-summary-card small',
        '.dash-cyclo-detail-hist__label',
        '.dash-commit-activity-detail__primary-suffix',
        '.dash-churn-timeline-detail__primary-suffix',
        'small',
    ].join(','));
    return (node ? node.textContent : el.getAttribute('title') || el.textContent || '').trim();
}

function _dashDetailCandidateValue(el) {
    const node = el.querySelector([
        '.dash-report-metric-value',
        '.dash-report-primary-value',
        '.dash-report-bar-row b',
        '.dash-report-stat-value',
        '.dash-kpi-detail__primary-value',
        '.dash-kpi-detail-bars__value',
        '.dash-kpi-detail-stat__value',
        '.dash-code-health-detail-panel__primary-value',
        '.dash-entry-detail-hero-stat__value',
        '.dash-issues-detail-status__value',
        '.dash-code-health-summary-card span',
        '.dash-commit-activity-detail__primary-value',
        '.dash-churn-timeline-detail__primary-value',
        'strong',
        'b',
    ].join(','));
    return (node ? node.textContent : '').trim();
}

function _dashDetailNormalize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\p{L}\p{N}.+#/\- ]+/gu, '')
        .trim();
}

function _dashMakeDetailElementClickable(el, handler, label) {
    if (!el || typeof handler !== 'function') return;
    el.dataset.clickable = 'true';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    if (label && !el.getAttribute('title')) el.setAttribute('title', label);
    el.addEventListener('click', event => {
        if (event.target.closest('button, a[href], [onclick], [data-clickable="true"]:not([data-dash-enhanced-click])') && event.target !== el) return;
        event.preventDefault();
        event.stopPropagation();
        handler();
    });
    el.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handler();
    });
    el.dataset.dashEnhancedClick = 'true';
}

function _dashDetailMetricAction(widgetId, label, value, stats) {
    const text = _dashDetailNormalize(`${label || ''} ${value || ''}`);
    const labelText = _dashDetailNormalize(label);
    const extMatch = /^\.([a-z0-9_+#-]+)$/i.exec((label || '').trim());
    if (extMatch && typeof _dashFilesByExt === 'function') {
        const ext = extMatch[1];
        return () => _dashOpenFileGroupDrilldown(`.${ext} files`, _dashFilesByExt(ext));
    }

    if (/^\d+\s*(?:-\s*\d+|\+)$/.test(labelText) && typeof _dashComplexityBucketFunctions === 'function') {
        return () => _dashOpenFunctionGroupDrilldown(`Complexity ${labelText}`, _dashComplexityBucketFunctions(labelText.replace(/\s+/g, '')));
    }

    const allFiles = () => typeof _dashAllFiles === 'function' ? _dashAllFiles() : [];
    const allFunctions = () => {
        const fromIndex = Object.values((window.DATA && DATA.symbol_index) || {})
            .filter(sym => sym && (sym.kind === 'function' || sym.kind === 'method'))
            .map(sym => ({ file: sym.file, name: sym.name, line: sym.line, value: sym.complexity != null ? `cx ${sym.complexity}` : '' }));
        if (fromIndex.length) return fromIndex;
        const rows = [];
        for (const files of Object.values((window.DATA && DATA.files_by_module) || {})) {
            for (const file of files || []) {
                for (const fn of (file as any).functions || []) {
                    rows.push({ file: file.path, name: fn.name, line: fn.line || 0, value: fn.lines != null ? `${fn.lines} lines` : '' });
                }
            }
        }
        return rows;
    };
    const filesFromPaths = paths => (paths || []).filter(Boolean).map(file => ({ file }));
    const functionRows = rows => (rows || []).filter(r => r && r.file).map(r => ({
        file: r.file,
        name: r.name || r.label || '?',
        line: r.line || 0,
        value: r.value ?? (r.complexity != null ? `cx ${r.complexity}` : ''),
    }));
    const openFiles = (title, rows, options?) => () => _dashOpenFileGroupDrilldown(title, rows, options || {});
    const openFunctions = (title, rows, options?) => () => _dashOpenFunctionGroupDrilldown(title, rows, options || {});
    const fmtExact = typeof _dashFmtExactNum === 'function' ? _dashFmtExactNum : _dashFmtNum;

    if (text.includes('comment')) {
        return openFiles('Files with comments', allFiles().filter(f => (f.loc || {}).comment > 0), {
            meta: f => `${fmtExact((f.loc || {}).comment || 0)} lines`,
        });
    }
    if (text.includes('blank')) {
        return openFiles('Files with blank LOC', allFiles().filter(f => (f.loc || {}).blank > 0), {
            meta: f => `${fmtExact((f.loc || {}).blank || 0)} lines`,
        });
    }
    if ((text.includes('code') || text.includes('loc') || text.includes('line')) && !text.includes('dead') && !text.includes('health')) {
        return openFiles('Files with code LOC', allFiles().filter(f => (f.loc || {}).code > 0), {
            meta: f => `${fmtExact((f.loc || {}).code || 0)} lines`,
        });
    }

    if (widgetId === 'complexity') {
        const rows = functionRows(stats.complexity_top_offenders || []);
        if (rows.length && (text.includes('offender') || text.includes('average') || text.includes('top score'))) {
            return openFunctions('Complexity offenders', rows);
        }
    }

    if (widgetId === 'dead_code') {
        const rows = functionRows(stats.dead_code_symbols || []);
        if (rows.length && (text.includes('unused') || text.includes('dead') || text.includes('affected'))) {
            return openFunctions('Dead code symbols', rows.map(r => Object.assign({}, r, { value: 'unused' })));
        }
        if (text.includes('total function')) return openFunctions('All functions', allFunctions());
    }

    if (widgetId === 'issues') {
        if (text.includes('circular')) {
            return openFiles('Circular dependency files', filesFromPaths([...(new Set((stats.top_circular_deps || []).flat()))]));
        }
        if (text.includes('dead')) return openFunctions('Dead code symbols', functionRows(stats.dead_code_symbols || []));
        if (text.includes('unimported')) return openFiles('Unimported files', filesFromPaths(stats.unimported_file_paths || []));
        if (text.includes('entry')) return openFiles('Entry points', filesFromPaths(stats.entry_point_files || []));
        if (text.includes('isolated')) return openFiles('Isolated files', filesFromPaths(stats.isolated_file_paths || []));
    }

    if (widgetId === 'entry_points') {
        if (text.includes('entry')) return openFiles('Entry points', filesFromPaths(stats.entry_point_files || []));
        if (text.includes('isolated')) return openFiles('Isolated files', filesFromPaths(stats.isolated_file_paths || []));
    }

    if (widgetId === 'coupling') {
        if (text.includes('caller')) return openFiles('Top caller files', filesFromPaths((stats.top_caller_files || []).map(x => x.file)));
        if (text.includes('hotspot') || text.includes('import')) return openFiles('Most imported files', filesFromPaths((stats.top_imported_files || []).map(x => x.file)));
    }

    if (widgetId === 'graph_intelligence') {
        if (text.includes('surprising')) {
            return openFiles('Surprising connection files', filesFromPaths((stats.surprising_connections || []).flatMap(x => [x.source, x.target])));
        }
        if (text.includes('hotspot') || text.includes('degree')) {
            return openFiles('Graph hotspot files', filesFromPaths((stats.hotspot_nodes || []).map(x => x.file)));
        }
    }

    if (widgetId === 'bus_factor') {
        if (text.includes('high')) return openFiles('High ownership risk', filesFromPaths((stats.bus_factor_files || []).filter(f => f.risk === 'high').map(f => f.file)));
        if (text.includes('medium')) return openFiles('Medium ownership risk', filesFromPaths((stats.bus_factor_files || []).filter(f => f.risk === 'medium').map(f => f.file)));
        if (text.includes('low')) return openFiles('Low ownership risk', filesFromPaths((stats.bus_factor_files || []).filter(f => f.risk === 'low').map(f => f.file)));
    }

    if (widgetId === 'security') {
        const findings = stats.security_findings || {};
        const bySeverity = findings.by_severity || {};
        if (text.includes('high')) return openFiles('High security findings', bySeverity.high || []);
        if (text.includes('medium')) return openFiles('Medium security findings', bySeverity.medium || []);
        if (text.includes('low')) return openFiles('Low security findings', bySeverity.low || []);
    }

    if (widgetId === 'commit_heatmap' || widgetId === 'churn_timeline' || widgetId === 'temporal') {
        if (text.includes('commit') || text.includes('file') || text.includes('week') || text.includes('addition') || text.includes('deletion')) {
            return openFiles('Changed files', stats.file_churn || []);
        }
    }

    if (widgetId === 'code_health' && typeof _dashHealthCategoryFiles === 'function') {
        const categories = [
            ['complexity', 'Complexity'],
            ['coupling', 'Coupling'],
            ['dead_code', 'Dead code'],
            ['duplication', 'Duplication'],
        ];
        const row = categories.find(([key, name]) => text.includes(key.replace('_', ' ')) || text.includes(name.toLowerCase()));
        if (row) return openFiles(`Code Health: ${row[1]}`, _dashHealthCategoryFiles(row[0], stats));
    }

    if (widgetId === 'tech_debt' && typeof _dashDebtCategoryFiles === 'function' && typeof _DASH_DEBT_ORDER !== 'undefined') {
        const row = _DASH_DEBT_ORDER.find(d => text.includes(_dashDetailNormalize(_dashT(d.label))));
        if (row) return openFiles(`Tech Debt: ${_dashT(row.label)}`, _dashDebtCategoryFiles(row.key, stats));
    }

    if (widgetId === 'overview' && (text.includes('function') || text.includes('call'))) {
        return openFunctions('All functions', allFunctions());
    }

    if ((widgetId === 'overview' || widgetId === 'kpi_files' || widgetId === 'structure') && (text.includes('file') || text.includes('module') || text.includes('extension'))) {
        return openFiles('All files', allFiles());
    }

    if (widgetId === 'kpi_functions' && (text.includes('function') || text.includes('call') || text.includes('module') || text.includes('file'))) {
        return openFunctions('All functions', allFunctions());
    }

    return null;
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
            suffix: 'files',
            summary: `${fmt(funcs)} functions across ${fmt(modules)} modules with ${fmt(extCount)} file extensions.`,
            metrics: [],
            visual: _dashReportBarsHTML(_dashReportFileExts(5).map(([ext, count], i) => ({
                label: `.${ext}`, value: count, raw: count, color: _dashAccentStop(i),
            }))),
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
            .filter(list => (list || []).some(f => (f.func_count || ((f as any).functions || []).length) > 0)).length;
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

    if (widgetId === 'complexity') {
        const top = (stats.complexity_top_offenders || [])[0] || {};
        const topScore = top.complexity || top.score || 0;
        return Object.assign(base, {
            title: _dashT('dashComplexityTitle') || 'Complexity',
            eyebrow: 'Complexity risk',
            value: Number(stats.avg_complexity || 0).toFixed(1),
            suffix: 'avg',
            summary: top.name ? `Highest offender: ${top.name} in ${String(top.file || '').split('/').pop()}.` : 'No complexity offenders were reported.',
            metrics: [
                { label: 'Offenders', value: fmt((stats.complexity_top_offenders || []).length), raw: (stats.complexity_top_offenders || []).length },
                { label: 'Average', value: Number(stats.avg_complexity || 0).toFixed(1), raw: stats.avg_complexity || 0 },
                { label: 'Top score', value: fmt(topScore), raw: topScore },
            ],
        });
    }

    if (widgetId === 'tech_debt') {
        const bd: any = stats.tech_debt_breakdown || {};
        const minutes = Object.values(bd).reduce((sum: number, v) => sum + Number(v || 0), 0);
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
        const count = stats.uncalled_functions || 0;
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

function _dashCloseDetailPanel(immediate?) {
    const current  = _dashDetailCurrent;
    const backdrop = current?.backdrop || document.getElementById('dash-detail-backdrop');
    const panel    = current?.panel || document.getElementById('dash-detail-panel');
    if (!backdrop && !panel) return;

    _dashDetailOpen = false;
    _dashDetailSeq += 1;
    if (_dashDetailCurrent === current) _dashDetailCurrent = null;
    if (typeof _dashHideChartTooltip === 'function') _dashHideChartTooltip();

    // Destroy Chart.js instances while the canvas nodes are still in the DOM.
    // This lets any pending ResizeObserver callbacks fire against an already-
    // destroyed chart rather than a live one attached to a detached node.
    const body = panel?.querySelector('#dash-detail-body');
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
