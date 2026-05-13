// @module Dashboard_view/dashboard_charts
// Chart.js helpers shared by every widget. Owns the _dashCharts registry so
// charts can be destroyed / recreated on re-render.
//
// COLOR RULES:
//   • _DASH_ACCENT_SCALE — the canonical 5-stop warm gold palette
//   • _dashAccentStop(i) — pick by index (wraps at 5)
//   • _dashAccentForSlices(n) — returns n distinct stops for pie/donut
//     (if n > 5 the caller must pre-group small slices into "Others")
//   • Commit delta colours: #A4B55B (add) / #E05A5A (del) — ONLY exception
//   • Single-metric charts (bar, sparkline, progress ring) may use
//     _dashAccentTint(alpha) for fill intensity variation

const _dashCharts = {};   // canvas-id → Chart instance

const _DASH_ACCENT_SCALE = ['#eedcbc', '#DFA745', '#c57429', '#955223', '#673606'];
// Commit-delta exceptions (not accent-derived)
const _DASH_COLOR_ADD = '#A4B55B';
const _DASH_COLOR_DEL = '#E05A5A';
const _DASH_CHART_TOOLTIP_ID = 'dash-chart-tooltip';

function _dashAccentStop(i) {
    return _DASH_ACCENT_SCALE[((i % 5) + 5) % 5];
}

// For pie / donut: return the first n stops from the scale.
// If n > 5, caller is responsible for grouping tail slices into "Others"
// and using _dashAccentStop(4) = #673606 for that bucket.
function _dashAccentForSlices(n) {
    const count = Math.min(n, 5);
    return _DASH_ACCENT_SCALE.slice(0, count);
}

// Read a CSS custom property from :root.
function _dashCssVar(name, fallback) {
    if (typeof document === 'undefined') return fallback || '';
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v || '').trim() || (fallback || '');
}

function _dashHexToRgb(hex) {
    let h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return { r: 223, g: 167, b: 69 };
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
    };
}

// Returns rgba(...) for the main accent (#DFA745) at the given alpha.
// For single-metric charts where alpha variation conveys intensity.
function _dashAccentTint(alpha) {
    const a = (alpha == null) ? 1 : Math.max(0, Math.min(1, alpha));
    const { r, g, b } = _dashHexToRgb('#DFA745');
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Muted gray for axis ticks, background series.
function _dashMutedTint(alpha) {
    const a = (alpha == null) ? 1 : Math.max(0, Math.min(1, alpha));
    const { r, g, b } = _dashHexToRgb(_dashCssVar('--muted', '#93918b'));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Faded border colour for chart gridlines / axis lines.
function _dashBorderTint(alpha) {
    const a = (alpha == null) ? 1 : Math.max(0, Math.min(1, alpha));
    const { r, g, b } = _dashHexToRgb(_dashCssVar('--border', '#2e302b'));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function _dashChartEscape(value) {
    if (typeof _dashEscape === 'function') return _dashEscape(value);
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

function _dashChartTooltipEl() {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById(_DASH_CHART_TOOLTIP_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = _DASH_CHART_TOOLTIP_ID;
        document.body.appendChild(el);
    }
    return el;
}

function _dashHideChartTooltip() {
    const el = typeof document !== 'undefined' ? document.getElementById(_DASH_CHART_TOOLTIP_ID) : null;
    if (el) el.classList.remove('visible');
}

function _dashShowChartTooltip(evt, chart, element) {
    const native = evt && (evt.native || evt);
    if (!native || !chart || !element) {
        _dashHideChartTooltip();
        return;
    }

    const ds = chart.data.datasets[element.datasetIndex] || {};
    const label = (chart.data.labels || [])[element.index] || '';
    const raw = Array.isArray(ds.data) ? ds.data[element.index] : null;
    const value = Number(raw || 0);
    const total = Array.isArray(ds.data)
        ? ds.data.reduce((sum, n) => sum + Number(n || 0), 0)
        : 0;
    const pct = total > 0 ? ` · ${Math.round(value / total * 100)}%` : '';
    const color = Array.isArray(ds.backgroundColor)
        ? ds.backgroundColor[element.index]
        : ds.backgroundColor;
    const fmt = typeof _dashFmtNum === 'function' ? _dashFmtNum(value) : String(value);
    const el = _dashChartTooltipEl();
    if (!el) return;

    el.innerHTML = `
<div class="dash-chart-tip-row">
  <span class="dash-chart-tip-swatch" style="background:${_dashChartEscape(color || 'var(--accent)')}"></span>
  <span class="dash-chart-tip-label">${_dashChartEscape(label)}</span>
</div>
<div class="dash-chart-tip-value">${_dashChartEscape(fmt + pct)}</div>`;

    const offset = 14;
    const pad = 8;
    el.style.left = `${native.clientX + offset}px`;
    el.style.top = `${native.clientY + offset}px`;
    el.classList.add('visible');

    const rect = el.getBoundingClientRect();
    let left = native.clientX + offset;
    let top = native.clientY + offset;
    if (left + rect.width + pad > window.innerWidth) {
        left = native.clientX - rect.width - offset;
    }
    if (top + rect.height + pad > window.innerHeight) {
        top = native.clientY - rect.height - offset;
    }
    el.style.left = `${Math.max(pad, left)}px`;
    el.style.top = `${Math.max(pad, top)}px`;
}

// Multi-bar/category alpha-stepped fills (for bar charts; bars are
// distinguishable by position, so single-hue alpha stepping is OK).
function _dashAccentSeries(n) {
    if (!n || n < 1) return [];
    if (n === 1) return [_dashAccentTint(1)];
    const out = [];
    const top = 1.0, bot = 0.30;
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        out.push(_dashAccentTint(top - t * (top - bot)));
    }
    return out;
}

// Pie/doughnut hover enlargement.
//
// Chart.js's native `hoverOffset` is disabled on our datasets (set to 0 in
// _dashEnhanceInteractiveDataset) because its animation interpolator is
// broken in this context — symptoms: "this._fn is not a function" plus arcs
// that grow but never shrink back, accumulating until every slice is
// enlarged. We replace it with our own deterministic system:
//
//   1. _dashEnhanceInteractiveDataset stashes the desired growth amount on
//      `ds._dashHoverGrow` and zeroes `ds.hoverOffset`.
//   2. The onHover wrapper writes the single currently-hovered arc into
//      `chart._dashActive` ({ datasetIndex, index } | null) and calls
//      `chart.draw()` whenever that target changes.
//   3. This plugin's afterDatasetsDraw reads `chart._dashActive` and
//      redraws ONLY that arc with an enlarged outerRadius on top of the
//      normal pass. The base outerRadius is never mutated, so there is no
//      drift between hovers.
const _dashArcGrowPlugin = {
    id: 'dashArcGrow',
    afterDatasetsDraw(chart) {
        const t = chart.config.type;
        if (t !== 'doughnut' && t !== 'pie') return;
        const active = chart._dashActive;
        if (!active) return;
        const meta = chart.getDatasetMeta(active.datasetIndex);
        const arc = meta && meta.data && meta.data[active.index];
        if (!arc) return;
        const ds = chart.data.datasets[active.datasetIndex] || {};
        const grow = ds._dashHoverGrow ?? ds.hoverOffset ?? 10;
        const savedOuter = arc.outerRadius;
        const savedBW    = arc.options.borderWidth;
        const savedBC    = arc.options.borderColor;
        arc.outerRadius = savedOuter + grow;
        if (ds.hoverBorderWidth != null) arc.options.borderWidth = ds.hoverBorderWidth;
        if (ds.hoverBorderColor != null) arc.options.borderColor = ds.hoverBorderColor;
        arc.draw(chart.ctx);
        arc.outerRadius = savedOuter;
        arc.options.borderWidth = savedBW;
        arc.options.borderColor = savedBC;
    }
};

function _dashApplyChartDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color                               = _dashCssVar('--muted', '#93918b');
    Chart.defaults.borderColor                         = _dashCssVar('--border', '#2e302b');
    Chart.defaults.font.family                         = "'Segoe UI', system-ui, sans-serif";
    Chart.defaults.font.size                           = 11;
    Chart.defaults.plugins.legend.labels.boxWidth      = 10;
    Chart.defaults.plugins.legend.labels.padding       = 14;
    Chart.defaults.plugins.tooltip.backgroundColor     = _dashCssVar('--surface-elevated', '#22241f');
    Chart.defaults.plugins.tooltip.borderColor         = _dashCssVar('--border', '#2e302b');
    Chart.defaults.plugins.tooltip.borderWidth         = 1;
    Chart.defaults.plugins.tooltip.titleColor          = _dashCssVar('--text', '#eae8e3');
    Chart.defaults.plugins.tooltip.bodyColor           = _dashCssVar('--muted', '#93918b');
    Chart.defaults.plugins.tooltip.padding             = 10;
    // Bar defaults — rounded tops, 300ms grow animation
    Chart.defaults.datasets.bar = Chart.defaults.datasets.bar || {};
    Chart.defaults.datasets.bar.borderRadius = 6;
    // Pie / doughnut: native hoverOffset is OFF — the dashArcGrow plugin
    // handles slice enlargement instead. See plugin comment for why.
    Chart.defaults.datasets.pie      = Chart.defaults.datasets.pie      || {};
    Chart.defaults.datasets.doughnut = Chart.defaults.datasets.doughnut || {};
    Chart.defaults.datasets.pie.hoverOffset      = 0;
    Chart.defaults.datasets.doughnut.hoverOffset = 0;
    Chart.defaults.animation = { duration: 260, easing: 'easeOutQuart' };
    Chart.defaults.transitions = Chart.defaults.transitions || {};
    Chart.defaults.transitions.active = Chart.defaults.transitions.active || {};
    Chart.defaults.transitions.active.animation = { duration: 0 };

    if (!Chart.registry.plugins.get(_dashArcGrowPlugin.id)) {
        Chart.register(_dashArcGrowPlugin);
    }
}

function _dashMkChart(canvas, type, data, options) {
    if (!canvas || typeof Chart === 'undefined') return null;
    const id = canvas.id || ('dash-chart-' + Math.random().toString(36).slice(2, 8));
    canvas.id = id;
    if (_dashCharts[id]) {
        try { _dashCharts[id].destroy(); } catch (_) {}
        delete _dashCharts[id];
    }
    // Chart.js keeps its own static registry keyed on canvas; clearing our
    // map alone can leave a stale instance bound to this canvas across
    // detach/reattach cycles (e.g. mode-switching), which breaks recreation.
    const stray = Chart.getChart(canvas);
    if (stray) { try { stray.destroy(); } catch (_) {} }
    const ctx = canvas.getContext('2d');
    const enhanced = _dashInteractiveChartConfig(canvas, type, data, options);
    _dashCharts[id] = new Chart(ctx, enhanced);

    // The detail panel opens with a CSS scale animation. The chart may be
    // created while the canvas is mid-resize; Chart.js's internal
    // ResizeObserver sometimes misses the final size, leaving the canvas
    // bitmap blank even though the chart instance is intact. Nudge the chart
    // to re-measure and redraw after the open animation completes.
    const chart = _dashCharts[id];
    const nudge = () => {
        try {
            if (_dashCharts[id] === chart) { chart.resize(); chart.update('none'); }
        } catch (_) {}
    };
    requestAnimationFrame(() => requestAnimationFrame(nudge));
    setTimeout(nudge, 320);

    return chart;
}

function _dashInteractiveChartConfig(canvas, type, data, options) {
    const chartData = data || {};
    const chartOptions = options ? { ...options } : {};
    const isActionable = typeof chartOptions.onClick === 'function';

    const circular = type === 'pie' || type === 'doughnut';

    if (isActionable) {
        const userHover = chartOptions.onHover;
        chartOptions.onHover = (evt, elements, chart) => {
            const active = !!(elements && elements.length);
            if (canvas) canvas.style.cursor = active ? 'pointer' : '';

            // For pie/doughnut, record the single hovered arc on the chart
            // and redraw if it changed. The dashArcGrow plugin reads
            // chart._dashActive in afterDatasetsDraw and renders the
            // enlarged version on top — only ever one slice at a time.
            // Never mutate arc.outerRadius directly here (doing so corrupts
            // the natural base across hovers and arcs end up accumulating).
            if (circular) {
                const next = active
                    ? { datasetIndex: elements[0].datasetIndex, index: elements[0].index }
                    : null;
                const prev = chart._dashActive || null;
                const changed = !!next !== !!prev || (
                    next && prev && (next.datasetIndex !== prev.datasetIndex || next.index !== prev.index)
                );
                if (changed) {
                    chart._dashActive = next;
                    try { chart.draw(); } catch (_) {}
                }
                if (active) {
                    _dashShowChartTooltip(evt, chart, elements[0]);
                } else {
                    _dashHideChartTooltip();
                }
            }

            if (typeof userHover === 'function') userHover(evt, elements, chart);
        };
        // Chart.js 4.x: `interaction` drives visual active-element state (hoverOffset,
        // tooltip). `hover` only drives the onHover callback. Set both so the cursor
        // change and the visual arc expansion come from the same hit-detection pass.
        chartOptions.interaction = chartOptions.interaction || {};
        chartOptions.interaction.mode      = chartOptions.interaction.mode      || 'nearest';
        chartOptions.interaction.intersect = chartOptions.interaction.intersect ?? true;
        chartOptions.hover = chartOptions.hover || {};
        chartOptions.hover.mode      = chartOptions.hover.mode      || 'nearest';
        chartOptions.hover.intersect = chartOptions.hover.intersect ?? true;

        const userClick = chartOptions.onClick;
        chartOptions.onClick = (evt, elements, chart) => {
            if (elements && elements.length && evt && evt.native) {
                evt.native.stopPropagation?.();
            }
            userClick(evt, elements, chart);
        };
    }

    const datasets = Array.isArray(chartData.datasets)
        ? chartData.datasets.map(ds => _dashEnhanceInteractiveDataset(ds, type, isActionable))
        : chartData.datasets;

    // For pie/doughnut: reserve layout.padding >= the plugin's hover growth
    // so the enlarged active arc has room to render outside the base ring
    // without being clipped at the canvas edge.
    if (circular && !chartOptions.layout?.padding) {
        const maxHoverGrow = (datasets || []).reduce(
            (m, ds) => Math.max(m, (ds && (ds._dashHoverGrow ?? ds.hoverOffset)) || 0),
            0
        );
        if (maxHoverGrow > 0) {
            chartOptions.layout = Object.assign({}, chartOptions.layout, {
                padding: maxHoverGrow,
            });
        }
    }

    // Force-disable Chart.js's native arc-level hoverOffset. Our plugin
    // owns the visual enlargement; leaving this non-zero would let
    // Chart.js mutate outerRadius on hover and the two systems would fight.
    if (circular) {
        chartOptions.elements = chartOptions.elements || {};
        chartOptions.elements.arc = chartOptions.elements.arc || {};
        chartOptions.elements.arc.hoverOffset = 0;
        chartOptions.animation = false;
        chartOptions.animations = false;
        chartOptions.transitions = chartOptions.transitions || {};
        chartOptions.transitions.active = chartOptions.transitions.active || {};
        chartOptions.transitions.active.animation = { duration: 0 };
        chartOptions.plugins = chartOptions.plugins || {};
        chartOptions.plugins.tooltip = Object.assign({}, chartOptions.plugins.tooltip, {
            enabled: false,
        });
    }

    return {
        type,
        data: { ...chartData, datasets },
        options: chartOptions,
    };
}

function _dashEnhanceInteractiveDataset(dataset, type, isActionable) {
    if (!dataset || typeof dataset !== 'object') return dataset;
    const ds = { ...dataset };
    const circular = type === 'pie' || type === 'doughnut';
    if (circular) {
        // Stash the desired hover growth on a custom property; zero out
        // Chart.js's native hoverOffset so its broken animation can't
        // mutate outerRadius behind our back. The dashArcGrow plugin reads
        // _dashHoverGrow to render the enlarged active arc.
        ds._dashHoverGrow = isActionable ? (ds.hoverOffset ?? 14) : 0;
        ds.hoverOffset = 0;
        if (isActionable) {
            ds.hoverBorderWidth = ds.hoverBorderWidth ?? 2;
            ds.hoverBorderColor = ds.hoverBorderColor || _dashCssVar('--text', '#eae8e3');
        }
        return ds;
    }
    if (!isActionable) return ds;
    if (type === 'bar') {
        ds.hoverBorderWidth = ds.hoverBorderWidth ?? 2;
        ds.hoverBorderColor = ds.hoverBorderColor || _dashCssVar('--text', '#eae8e3');
        ds.hoverBackgroundColor = ds.hoverBackgroundColor || _dashAccentTint(1);
    }
    return ds;
}

function _dashDestroyAllCharts() {
    _dashHideChartTooltip();
    Object.keys(_dashCharts).forEach(id => {
        try { _dashCharts[id]?.destroy(); } catch (_) {}
        delete _dashCharts[id];
    });
}

// ─── Chart-type toggle (per-widget) ──────────────────────────────────────

const _dashChartTypeState    = {};
const _dashChartSwitchHandlers = {};

const _DASH_CHART_TYPE_ICONS = {
    bar:      '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="4"  y="11" width="3" height="9"/><rect x="10" y="6"  width="3" height="14"/><rect x="16" y="14" width="3" height="6"/></svg>',
    pie:      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4 L12 12 L20 12" stroke-width="2"/></svg>',
    radar:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12,3 21,9 18,20 6,20 3,9"/><polygon points="12,8 17,11 16,17 8,17 7,11" fill="currentColor" fill-opacity="0.4"/></svg>',
    doughnut: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>',
    line:     '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,17 9,11 14,14 20,5"/></svg>',
};

function _dashChartTypeIcon(type) { return _DASH_CHART_TYPE_ICONS[type] || type; }

function _dashChartToggleHTML(widgetKey, supportedTypes, defaultType) {
    if (!_dashChartTypeState[widgetKey]) _dashChartTypeState[widgetKey] = defaultType;
    const current = _dashChartTypeState[widgetKey];
    const buttonsHTML = supportedTypes.map(t => `
<button class="dash-chart-toggle-btn ${t === current ? 'active' : ''}" data-type="${t}" type="button" aria-label="${t}">
  ${_dashChartTypeIcon(t)}
</button>`).join('');
    return `<div class="dash-chart-toggle" data-widget="${widgetKey}">${buttonsHTML}</div>`;
}

function _dashChartCurrentType(widgetKey, defaultType) {
    return _dashChartTypeState[widgetKey] || defaultType;
}

function _dashRegisterChartSwitch(widgetKey, handler) {
    _dashChartSwitchHandlers[widgetKey] = handler;
}

function _dashHandleChartToggleClick(e) {
    const btn = e.target.closest('.dash-chart-toggle-btn');
    if (!btn) return;
    const wrap = btn.closest('.dash-chart-toggle');
    if (!wrap) return;
    const widgetKey = wrap.dataset.widget;
    const newType   = btn.dataset.type;
    if (!widgetKey || !newType) return;
    if (_dashChartTypeState[widgetKey] === newType) return;
    _dashChartTypeState[widgetKey] = newType;
    // Update active button
    wrap.querySelectorAll('.dash-chart-toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === newType);
    });
    const handler = _dashChartSwitchHandlers[widgetKey];
    if (typeof handler === 'function') handler(newType);
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', _dashHandleChartToggleClick);
}

// ─── Grouped-slice helper for pie/donut charts ─────────────────────────────
// Call this before passing data to _dashMkChart for pie/donut types.
// If items.length > 5, tail items are merged into a single "Others" bucket.
// Returns { labels, data, colors }.
function _dashGroupedSlices(labels, values) {
    if (labels.length <= 5) {
        return {
            labels,
            data:   values,
            colors: _dashAccentForSlices(labels.length),
        };
    }
    // Take top 4 by value, group the rest
    const indexed = labels.map((l, i) => ({ l, v: values[i] }));
    indexed.sort((a, b) => b.v - a.v);
    const top = indexed.slice(0, 4);
    const rest = indexed.slice(4);
    const othersVal = rest.reduce((s, x) => s + x.v, 0);
    const othersLabel = _dashT('dashOthers') || 'Others';
    return {
        labels: [...top.map(x => x.l), othersLabel],
        data:   [...top.map(x => x.v), othersVal],
        colors: [..._DASH_ACCENT_SCALE.slice(0, 4), '#673606'],
    };
}
