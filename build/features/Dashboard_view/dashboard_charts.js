const _dashCharts = {};
const _DASH_ACCENT_SCALE = ["#eedcbc", "#DFA745", "#c57429", "#955223", "#673606"];
const _DASH_COLOR_ADD = "#A4B55B";
const _DASH_COLOR_DEL = "#E05A5A";
const _DASH_CHART_TOOLTIP_ID = "dash-chart-tooltip";
function _dashAccentStop(i) {
  return _DASH_ACCENT_SCALE[(i % 5 + 5) % 5];
}
function _dashAccentForSlices(n) {
  const count = Math.min(n, 5);
  return _DASH_ACCENT_SCALE.slice(0, count);
}
function _dashInterpolateColor(c1, c2, t) {
  const r1 = _dashHexToRgb(c1), r2 = _dashHexToRgb(c2);
  const r = Math.round(r1.r + (r2.r - r1.r) * t);
  const g = Math.round(r1.g + (r2.g - r1.g) * t);
  const b = Math.round(r1.b + (r2.b - r1.b) * t);
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}
function _dashColorScale(n) {
  if (!n || n < 1) return [];
  if (n === 1) return [_DASH_ACCENT_SCALE[0]];
  if (n <= 5) return _DASH_ACCENT_SCALE.slice(0, n);
  const out = [];
  const maxIdx = _DASH_ACCENT_SCALE.length - 1;
  for (let i = 0; i < n; i++) {
    let t = i / (n - 1);
    t = Math.pow(t, 1.5);
    const pos = t * maxIdx;
    const idx = Math.floor(pos);
    if (idx >= maxIdx) {
      out.push(_DASH_ACCENT_SCALE[maxIdx]);
    } else {
      out.push(_dashInterpolateColor(_DASH_ACCENT_SCALE[idx], _DASH_ACCENT_SCALE[idx + 1], pos - idx));
    }
  }
  return out;
}
function _dashCssVar(name, fallback) {
  if (typeof document === "undefined") return fallback || "";
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return (v || "").trim() || (fallback || "");
}
function _dashHexToRgb(hex) {
  let h = String(hex || "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return { r: 223, g: 167, b: 69 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}
function _dashAccentTint(alpha) {
  const a = alpha == null ? 1 : Math.max(0, Math.min(1, alpha));
  const { r, g, b } = _dashHexToRgb("#DFA745");
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function _dashMutedTint(alpha) {
  const a = alpha == null ? 1 : Math.max(0, Math.min(1, alpha));
  const { r, g, b } = _dashHexToRgb(_dashCssVar("--muted", "#93918b"));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function _dashBorderTint(alpha) {
  const a = alpha == null ? 1 : Math.max(0, Math.min(1, alpha));
  const { r, g, b } = _dashHexToRgb(_dashCssVar("--border", "#2e302b"));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function _dashChartEscape(value) {
  if (typeof _dashEscape === "function") return _dashEscape(value);
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}
function _dashChartTooltipEl() {
  if (typeof document === "undefined") return null;
  let el = document.getElementById(_DASH_CHART_TOOLTIP_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = _DASH_CHART_TOOLTIP_ID;
    document.body.appendChild(el);
  }
  return el;
}
function _dashHideChartTooltip() {
  const el = typeof document !== "undefined" ? document.getElementById(_DASH_CHART_TOOLTIP_ID) : null;
  if (el) el.classList.remove("visible");
}
function _dashShowChartTooltip(evt, chart, element) {
  const native = evt && (evt.native || evt);
  if (!native || !chart || !element) {
    _dashHideChartTooltip();
    return;
  }
  const ds = chart.data.datasets[element.datasetIndex] || {};
  const label = (chart.data.labels || [])[element.index] || "";
  const raw = Array.isArray(ds.data) ? ds.data[element.index] : null;
  const value = Number(raw || 0);
  const total = Array.isArray(ds.data) ? ds.data.reduce((sum, n) => sum + Number(n || 0), 0) : 0;
  const pct = total > 0 ? ` \xB7 ${Math.round(value / total * 100)}%` : "";
  const color = Array.isArray(ds.backgroundColor) ? ds.backgroundColor[element.index] : ds.backgroundColor;
  const fmt = typeof _dashFmtNum === "function" ? _dashFmtNum(value) : String(value);
  const el = _dashChartTooltipEl();
  if (!el) return;
  el.innerHTML = `
<div class="dash-chart-tip-row">
  <span class="dash-chart-tip-swatch" style="background:${_dashChartEscape(color || "var(--accent)")}"></span>
  <span class="dash-chart-tip-label">${_dashChartEscape(label)}</span>
</div>
<div class="dash-chart-tip-value">${_dashChartEscape(fmt + pct)}</div>`;
  const offset = 14;
  const pad = 8;
  el.style.left = `${native.clientX + offset}px`;
  el.style.top = `${native.clientY + offset}px`;
  el.classList.add("visible");
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
function _dashAccentSeries(n) {
  if (!n || n < 1) return [];
  if (n === 1) return [_dashAccentTint(1)];
  const out = [];
  const top = 1, bot = 0.3;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(_dashAccentTint(top - t * (top - bot)));
  }
  return out;
}
const _dashArcGrowPlugin = {
  id: "dashArcGrow",
  afterDatasetsDraw(chart) {
    const t = chart.config.type;
    if (t !== "doughnut" && t !== "pie") return;
    const active = chart._dashActive;
    if (!active) return;
    const meta = chart.getDatasetMeta(active.datasetIndex);
    const arc = meta && meta.data && meta.data[active.index];
    if (!arc) return;
    const ds = chart.data.datasets[active.datasetIndex] || {};
    const grow = ds._dashHoverGrow ?? ds.hoverOffset ?? 10;
    const savedOuter = arc.outerRadius;
    const savedBW = arc.options.borderWidth;
    const savedBC = arc.options.borderColor;
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
  if (typeof Chart === "undefined") return;
  Chart.defaults.color = _dashCssVar("--muted", "#93918b");
  Chart.defaults.borderColor = _dashCssVar("--border", "#2e302b");
  Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.plugins.tooltip.backgroundColor = _dashCssVar("--surface-elevated", "#22241f");
  Chart.defaults.plugins.tooltip.borderColor = _dashCssVar("--border", "#2e302b");
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.titleColor = _dashCssVar("--text", "#eae8e3");
  Chart.defaults.plugins.tooltip.bodyColor = _dashCssVar("--muted", "#93918b");
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.datasets.bar = Chart.defaults.datasets.bar || {};
  Chart.defaults.datasets.bar.borderRadius = 6;
  Chart.defaults.datasets.pie = Chart.defaults.datasets.pie || {};
  Chart.defaults.datasets.doughnut = Chart.defaults.datasets.doughnut || {};
  Chart.defaults.datasets.pie.hoverOffset = 0;
  Chart.defaults.datasets.doughnut.hoverOffset = 0;
  Chart.defaults.animation = { duration: 260, easing: "easeOutQuart" };
  Chart.defaults.transitions = Chart.defaults.transitions || {};
  Chart.defaults.transitions.active = Chart.defaults.transitions.active || {};
  Chart.defaults.transitions.active.animation = { duration: 0 };
  if (!Chart.registry.plugins.get(_dashArcGrowPlugin.id)) {
    Chart.register(_dashArcGrowPlugin);
  }
}
function _dashMkChart(canvas, type, data, options) {
  if (!canvas || typeof Chart === "undefined") return null;
  const id = canvas.id || "dash-chart-" + Math.random().toString(36).slice(2, 8);
  canvas.id = id;
  if (_dashCharts[id]) {
    try {
      _dashCharts[id].destroy();
    } catch (_) {
    }
    delete _dashCharts[id];
  }
  const stray = Chart.getChart(canvas);
  if (stray) {
    try {
      stray.destroy();
    } catch (_) {
    }
  }
  const ctx = canvas.getContext("2d");
  const enhanced = _dashInteractiveChartConfig(canvas, type, data, options);
  _dashCharts[id] = new Chart(ctx, enhanced);
  const chart = _dashCharts[id];
  const nudge = () => {
    try {
      if (_dashCharts[id] === chart) {
        chart.resize();
        chart.update("none");
      }
    } catch (_) {
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(nudge));
  setTimeout(nudge, 320);
  return chart;
}
function _dashInteractiveChartConfig(canvas, type, data, options) {
  const chartData = data || {};
  const chartOptions = options ? { ...options } : {};
  const isActionable = typeof chartOptions.onClick === "function";
  const circular = type === "pie" || type === "doughnut";
  if (isActionable) {
    const userHover = chartOptions.onHover;
    chartOptions.onHover = (evt, elements, chart) => {
      const active = !!(elements && elements.length);
      if (canvas) canvas.style.cursor = active ? "pointer" : "";
      if (circular) {
        const next = active ? { datasetIndex: elements[0].datasetIndex, index: elements[0].index } : null;
        const prev = chart._dashActive || null;
        const changed = !!next !== !!prev || next && prev && (next.datasetIndex !== prev.datasetIndex || next.index !== prev.index);
        if (changed) {
          chart._dashActive = next;
          try {
            chart.draw();
          } catch (_) {
          }
        }
        if (active) {
          _dashShowChartTooltip(evt, chart, elements[0]);
        } else {
          _dashHideChartTooltip();
        }
      }
      if (typeof userHover === "function") userHover(evt, elements, chart);
    };
    chartOptions.interaction = chartOptions.interaction || {};
    chartOptions.interaction.mode = chartOptions.interaction.mode || "nearest";
    chartOptions.interaction.intersect = chartOptions.interaction.intersect ?? true;
    chartOptions.hover = chartOptions.hover || {};
    chartOptions.hover.mode = chartOptions.hover.mode || "nearest";
    chartOptions.hover.intersect = chartOptions.hover.intersect ?? true;
    const userClick = chartOptions.onClick;
    chartOptions.onClick = (evt, elements, chart) => {
      if (elements && elements.length && evt && evt.native) {
        evt.native.stopPropagation?.();
      }
      userClick(evt, elements, chart);
    };
  }
  const datasets = Array.isArray(chartData.datasets) ? chartData.datasets.map((ds) => _dashEnhanceInteractiveDataset(ds, type, isActionable)) : chartData.datasets;
  if (circular && !chartOptions.layout?.padding) {
    const maxHoverGrow = (datasets || []).reduce(
      (m, ds) => Math.max(m, ds && (ds._dashHoverGrow ?? ds.hoverOffset) || 0),
      0
    );
    if (maxHoverGrow > 0) {
      chartOptions.layout = Object.assign({}, chartOptions.layout, {
        padding: maxHoverGrow
      });
    }
  }
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
      enabled: false
    });
  }
  return {
    type,
    data: { ...chartData, datasets },
    options: chartOptions
  };
}
function _dashEnhanceInteractiveDataset(dataset, type, isActionable) {
  if (!dataset || typeof dataset !== "object") return dataset;
  const ds = { ...dataset };
  const circular = type === "pie" || type === "doughnut";
  if (circular) {
    ds._dashHoverGrow = isActionable ? ds.hoverOffset ?? 14 : 0;
    ds.hoverOffset = 0;
    if (isActionable) {
      ds.hoverBorderWidth = ds.hoverBorderWidth ?? 2;
      ds.hoverBorderColor = ds.hoverBorderColor || _dashCssVar("--text", "#eae8e3");
    }
    return ds;
  }
  if (!isActionable) return ds;
  if (type === "bar") {
    ds.hoverBorderWidth = ds.hoverBorderWidth ?? 2;
    ds.hoverBorderColor = ds.hoverBorderColor || _dashCssVar("--text", "#eae8e3");
    ds.hoverBackgroundColor = ds.hoverBackgroundColor || _dashAccentTint(1);
  }
  return ds;
}
function _dashDestroyAllCharts() {
  _dashHideChartTooltip();
  Object.keys(_dashCharts).forEach((id) => {
    try {
      _dashCharts[id]?.destroy();
    } catch (_) {
    }
    delete _dashCharts[id];
  });
}
const _dashChartTypeState = {};
const _dashChartSwitchHandlers = {};
const _DASH_CHART_TYPE_ICONS = {
  bar: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="4"  y="11" width="3" height="9"/><rect x="10" y="6"  width="3" height="14"/><rect x="16" y="14" width="3" height="6"/></svg>',
  pie: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4 L12 12 L20 12" stroke-width="2"/></svg>',
  radar: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12,3 21,9 18,20 6,20 3,9"/><polygon points="12,8 17,11 16,17 8,17 7,11" fill="currentColor" fill-opacity="0.4"/></svg>',
  doughnut: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>',
  line: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,17 9,11 14,14 20,5"/></svg>',
  horizontalBar: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="4" y="4"  width="9"  height="3"/><rect x="4" y="10" width="14" height="3"/><rect x="4" y="16" width="6"  height="3"/></svg>'
};
function _dashChartTypeIcon(type) {
  return _DASH_CHART_TYPE_ICONS[type] || type;
}
function _dashChartToggleHTML(widgetKey, supportedTypes, defaultType) {
  if (!_dashChartTypeState[widgetKey]) _dashChartTypeState[widgetKey] = defaultType;
  const current = _dashChartTypeState[widgetKey];
  const buttonsHTML = supportedTypes.map((t) => `
<button class="dash-chart-toggle-btn ${t === current ? "active" : ""}" data-type="${t}" type="button" aria-label="${t}">
  ${_dashChartTypeIcon(t)}
</button>`).join("");
  return `<div class="dash-chart-toggle" data-widget="${widgetKey}">${buttonsHTML}</div>`;
}
function _dashChartCurrentType(widgetKey, defaultType) {
  return _dashChartTypeState[widgetKey] || defaultType;
}
function _dashRegisterChartSwitch(widgetKey, handler) {
  _dashChartSwitchHandlers[widgetKey] = handler;
}
function _dashHandleChartToggleClick(e) {
  const btn = e.target.closest(".dash-chart-toggle-btn");
  if (!btn) return;
  const wrap = btn.closest(".dash-chart-toggle");
  if (!wrap) return;
  const widgetKey = wrap.dataset.widget;
  const newType = btn.dataset.type;
  if (!widgetKey || !newType) return;
  if (_dashChartTypeState[widgetKey] === newType) return;
  _dashChartTypeState[widgetKey] = newType;
  wrap.querySelectorAll(".dash-chart-toggle-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === newType);
  });
  const handler = _dashChartSwitchHandlers[widgetKey];
  if (typeof handler === "function") handler(newType);
}
if (typeof document !== "undefined") {
  document.addEventListener("click", _dashHandleChartToggleClick);
}
function _dashGroupedSlices(labels, values) {
  if (labels.length <= 5) {
    return {
      labels,
      data: values,
      colors: _dashAccentForSlices(labels.length)
    };
  }
  const indexed = labels.map((l, i) => ({ l, v: values[i] }));
  indexed.sort((a, b) => b.v - a.v);
  const top = indexed.slice(0, 4);
  const rest = indexed.slice(4);
  const othersVal = rest.reduce((s, x) => s + x.v, 0);
  const othersLabel = _dashT("dashOthers") || "Others";
  return {
    labels: [...top.map((x) => x.l), othersLabel],
    data: [...top.map((x) => x.v), othersVal],
    colors: [..._DASH_ACCENT_SCALE.slice(0, 4), "#673606"]
  };
}
