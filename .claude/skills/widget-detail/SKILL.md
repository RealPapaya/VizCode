---
name: widget-detail
description: Build or modify a Dashboard widget detail panel in VizCode. Use when adding/editing widgets under static/features/Dashboard_view/widgets/.
---

# Widget Detail Panel - Build Workflow

## Trigger
Use this skill whenever building or refactoring a widget's detail panel (`renderDetail`).

## Architecture

The dashboard framework owns only the modal shell:

```text
_dashOpenDetailPanel(widgetId, originRect)
  -> creates .dash-detail-panel
     -> .dash-detail-head
     -> #dash-detail-body.dash-report-body.dash-report-body--{widgetId}
        -> widget.renderDetail(body, DATA.stats)
```

The widget owns everything rendered inside `#dash-detail-body`. Do not make the detail content depend on the shared dashboard card/report layout.

## Required DOM Pattern

Every detail panel should create a widget-owned root and widget-owned class namespace:

```html
<div class="dash-{widgetId}-detail">
  <section class="dash-{widgetId}-detail__hero">
    <div class="dash-{widgetId}-detail__hero-copy">
      <div class="dash-{widgetId}-detail__eyebrow">category label</div>
      <h2 class="dash-{widgetId}-detail__title">widget title</h2>
      <div class="dash-{widgetId}-detail__primary">
        <span class="dash-{widgetId}-detail__primary-value">big number</span>
        <span class="dash-{widgetId}-detail__primary-suffix">unit</span>
      </div>
      <p class="dash-{widgetId}-detail__summary">1-2 sentence summary</p>
    </div>
    <div class="dash-{widgetId}-detail__hero-visual">visual</div>
  </section>

  <div class="dash-{widgetId}-detail__sections">
    <section class="dash-{widgetId}-detail-section">
      <div class="dash-{widgetId}-detail-section__head">
        <div class="dash-{widgetId}-detail-section__title">section title</div>
      </div>
      <div class="dash-{widgetId}-detail-section__body">section body</div>
    </section>
  </div>
</div>
```

Use a family namespace when widgets are intentionally maintained together, for example `dash-kpi-detail--files`, `dash-kpi-detail--functions`, and `dash-kpi-detail--overview`.

## Experience Planning

Each widget detail page should feel purpose-built for that widget, not like a repeated card template. Before coding a new or substantially refactored detail page, infer what the user probably needs to inspect, compare, drill into, or act on for that widget.

If the expected layout or interaction is not obvious, discuss it with the user before implementation. Ask what the detail page should emphasize, for example:

- Should the hero focus on one headline number, a trend, a ranking, or a status?
- Should the main interaction be a chart toggle, file drilldown, ranked list, timeline, heatmap, graph preview, filter, or comparison view?
- Should sections be arranged as a narrative top-to-bottom report, a dense dashboard, a split chart/list workspace, or a focused inspector?
- What should be clickable, and what should open a drilldown or navigate to the graph/code view?

When the user has not specified a design, choose a conservative purpose-built layout based on the widget's data and existing dashboard patterns, then mention the assumption briefly. Avoid making all detail pages identical just because the same helpers are available.

## Visual And Section Choices

Choose the hero and sections before coding:

- Primary value: the single most important number.
- Suffix: short unit text such as `files`, `functions`, `cycles`, `%`, or `hours`.
- Summary: one concise sentence with the next most important metrics.
- Hero visual: choose what fits the widget, such as a compact bar list, stacked composition bar, gauge, mini timeline, heatmap preview, dependency thumbnail, SVG, canvas, or another widget-owned visual.
- Sections: usually 2-4 logical groups such as stats, breakdown rows, lists, charts, filters, ranked findings, or focused drilldown workspaces.

## Implementation Steps

1. Extract all data at the top of `renderDetail(container, stats)`.
2. Build escaped HTML fragments for bars, rows, stats, and chart wrappers.
3. Set `container.innerHTML` to one widget-owned root element.
4. Initialize Chart.js after `container.innerHTML` so canvases exist in the DOM.
5. Add scoped CSS under a widget-specific block in `viz_overlays.css`.

Example:

```js
renderDetail(container, stats) {
  const total = stats.files || 0;
  const bars = buildWidgetBars(rows);

  container.innerHTML = `
<div class="dash-kpi-detail dash-kpi-detail--files">
  <section class="dash-kpi-detail__hero">
    <div class="dash-kpi-detail__hero-copy">
      <div class="dash-kpi-detail__eyebrow">Codebase files</div>
      <h2 class="dash-kpi-detail__title">File Inventory</h2>
      <div class="dash-kpi-detail__primary">
        <span class="dash-kpi-detail__primary-value">${_dashFmtExactNum(total)}</span>
        <span class="dash-kpi-detail__primary-suffix">files</span>
      </div>
      <p class="dash-kpi-detail__summary">...</p>
    </div>
    <div class="dash-kpi-detail__hero-visual">${bars}</div>
  </section>
  <div class="dash-kpi-detail__sections">...</div>
</div>`;

  const canvas = container.querySelector('#chart-id');
  if (canvas && typeof Chart !== 'undefined') {
    // init chart here
  }
}
```

## CSS Rules

Keep detail CSS scoped to the widget-owned namespace:

```css
.dash-kpi-detail {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.dash-kpi-detail__hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 0.8fr);
    gap: 24px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border);
}

.dash-kpi-detail--files .dash-kpi-detail-row {
    grid-template-columns: 24px minmax(0, 1fr) minmax(72px, 120px) minmax(44px, auto);
}
```

Avoid styling the new detail through generic `.dash-report-*` selectors. Those selectors are legacy shared report/card layout and make detail panels harder to modify.

## Rules

- Do not use `_dashDetailHeroHTML` or `_dashDetailReportModel` for new or refactored detail panels.
- Do not use `_dashReportSection`, `_dashReportGrid`, `_dashReportStats`, `_dashReportChart`, or `_dashReportList` as the main layout for new/refactored detail panels.
- A small local helper is acceptable if it emits the widget-owned namespace, not `.dash-report-*`.
- Use `_dashEscape()` for all user/data strings inserted into HTML.
- Use `_dashFmtExactNum()` for large exact integers and `_dashFmtNum()` for compact widget-card display.
- Keep chart initialization after `container.innerHTML`.
- After editing files with non-ASCII text, inspect the diff for mojibake before finishing.

## Current Canonical Example

Use these files as the current pattern:

- `static/features/Dashboard_view/widgets/widget_overview.ts`
- `static/features/Dashboard_view/widgets/widget_kpi_files.ts`
- `static/features/Dashboard_view/widgets/widget_kpi_functions.ts`
- `static/styles/viz_overlays.css` block: `KPI/Overview detail panels`
