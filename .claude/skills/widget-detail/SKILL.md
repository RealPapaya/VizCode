# Widget Detail Panel — Build Workflow

## Trigger
Use this skill whenever building or refactoring a widget's **detail panel** (`renderDetail`).

---

## Architecture Overview

### Panel lifecycle (framework — do NOT modify)
```
_dashOpenDetailPanel(widgetId, originRect)
  └─ creates .dash-detail-panel
       ├─ .dash-detail-head  (title bar + close button)
       └─ #dash-detail-body  (.dash-report-body .dash-report-body--{widgetId})
            └─ widget.renderDetail(body, DATA.stats)   ← widget owns everything inside
```

The framework only provides the **chrome** (panel shell + head). The widget owns 100% of `#dash-detail-body` content.

---

## DOM Structure Every Widget Must Produce

```html
<!-- 1. Hero banner (full-width, above the fold) -->
<section class="dash-report-hero">
  <div class="dash-report-hero-copy">
    <div class="dash-report-eyebrow">…category label…</div>
    <h2 class="dash-report-title">…widget title…</h2>
    <div class="dash-report-primary">
      <span class="dash-report-primary-value" style="color:…">…big number…</span>
      <span class="dash-report-primary-suffix">…unit…</span>
    </div>
    <p class="dash-report-summary">…1-2 sentence summary…</p>
    <!-- optional: metrics row (omit if sections below already show all data) -->
    <div class="dash-report-metrics">…_dashReportMetricHTML() items…</div>
  </div>
  <div class="dash-report-hero-visual">…bar chart / gauge SVG…</div>
</section>

<!-- 2. Section list (scrollable detail body) -->
<div class="dash-report-details dash-report-details--{widgetId}">
  <!-- _dashReportSection() calls go here -->
</div>
```

### Hero visual options
| Visual | When to use |
|--------|-------------|
| `_dashReportBarsHTML(items)` | List of labeled values (file types, metrics) |
| `_dashHealthGaugeSvg(score, color, opts)` | Score-out-of-10 widgets |
| Custom SVG / canvas | Specific widgets (e.g. heatmap thumbnail) |

---

## Helper Functions (available globally)

```js
// Section with optional title + subtitle dot
_dashReportSection({ title, subtitle, accent, body, className })

// 2-column (or auto) grid of sections
_dashReportGrid([sectionHTML, …], { columns: 2 })

// Scrollable list wrapper (preserves overflow:visible)
_dashReportList(innerHTML, { className, id })

// Stat tile grid (big number + label)
_dashReportStats([{ value, label, color }, …])

// Chart canvas wrapper with fixed min-height
_dashReportChart(canvasHTML, { size: 'sm' | 'md' | 'lg' })

// Top-N file extension bars (for hero visual)
_dashReportBarsHTML(items)   // items: [{ label, value, raw, color }]
```

---

## Step-by-Step for a New Widget Detail

### 1. Decide the hero
- **Primary value**: the single most important number for this widget
- **Suffix**: unit string (files / cycles / % / hours / …)
- **Summary**: 1–2 sentences, mention the next most important metrics
- **Visual**: pick from table above; if data-rich use `_dashReportBarsHTML`
- **Omit `dash-report-metrics` row** if the sections below already repeat those numbers

### 2. Plan the sections
- Each `_dashReportSection` = one logical topic
- Max ~3–4 sections per detail panel
- Common patterns:
  - Summary stats → `_dashReportStats([…])`
  - Bar/row breakdown → `<div class="dash-detail-bar-rows">` with `.dash-health-row` items
  - List of files/symbols → `_dashReportList(rows)`
  - Two side-by-side lists → `_dashReportGrid([_dashReportSection(…), _dashReportSection(…)], { columns: 2 })`
  - Chart → `_dashReportChart('<canvas id="…"></canvas>', { size: 'md' })`

### 3. Write `renderDetail(container, stats)`
```js
renderDetail(container, stats) {
    // 1. Extract data from stats
    const files = stats.files || 0;
    // …

    // 2. Build reusable HTML fragments
    const heroVisual = _dashReportBarsHTML(…);
    const rows = …;

    // 3. Set container.innerHTML = hero + details wrapper
    container.innerHTML = `
<section class="dash-report-hero">
  <div class="dash-report-hero-copy">
    <div class="dash-report-eyebrow">…</div>
    <h2 class="dash-report-title">…</h2>
    <div class="dash-report-primary">
      <span class="dash-report-primary-value">${value}</span>
      <span class="dash-report-primary-suffix">${suffix}</span>
    </div>
    <p class="dash-report-summary">…</p>
  </div>
  <div class="dash-report-hero-visual">${heroVisual}</div>
</section>
<div class="dash-report-details dash-report-details--${WIDGET_ID}">
${_dashReportSection({ title: '…', body: _dashReportStats([…]) })}
${_dashReportSection({ title: '…', body: _dashReportList(rows) })}
</div>`;

    // 4. Init charts AFTER innerHTML (canvas must exist in DOM)
    const canvas = container.querySelector('#…');
    if (canvas && typeof Chart !== 'undefined') { … }
},
```

### 4. Add widget-specific CSS overrides (if needed)
In `viz_overlays.css`, under the widget-specific block:
```css
/* {Widget}: list row column layout */
.dash-report-details--{widgetId} .dash-list-row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) minmax(72px, 120px) minmax(44px, auto);
    align-items: center;
}
.dash-report-details--{widgetId} .dash-list-bar-track {
    width: 100%;
    min-width: 0;
}
```

---

## Rules
- **Never** rely on `_dashDetailHeroHTML` or `_dashDetailReportModel` — those are legacy helpers kept for backward compatibility only. Widgets own their full DOM.
- **Always** wrap sections in `<div class="dash-report-details dash-report-details--{widgetId}">` so dividers and spacing work correctly.
- **Always** init Chart.js instances *after* `container.innerHTML = …`, never before.
- **Omit** the hero metrics row (`dash-report-metrics`) when the sections below already surface the same numbers — avoid duplication.
- Use `_dashEscape()` for all user/data strings inserted into HTML.
- Use `_dashFmtExactNum()` for large integers, `_dashFmtNum()` for compact display.

---

## Reference: Overview widget (canonical example)

File: `static/features/Dashboard_view/widgets/widget_overview.js`

- Hero: big file count + file-type bar chart on the right
- No metrics row (sections already have all 6 numbers as stat tiles)
- Section 1: `_dashReportStats` — 6 tile grid
- Section 2: `dash-detail-bar-rows` — LOC breakdown with drilldown
- Section 3: `_dashReportList` — top file types ranked list

CSS overrides: `dash-report-details--overview` in `viz_overlays.css`