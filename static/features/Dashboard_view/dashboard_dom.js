// @module Dashboard_view/dashboard_dom
// Builds the overlay shell once. Each widget gets its own <section> container
// to fill — the renderer never edits other widgets' DOM.

let _dashBuilt = false;

// Section ids in the order Mode 1 displays them. Each entry's id is also the
// container id passed to its widget renderer.
const _DASH_SECTIONS = [
    { id: 'dash-sec-kpi',         widget: 'kpi_strip' },
    { id: 'dash-sec-health',      widget: 'code_health' },
    { id: 'dash-sec-debt',        widget: 'tech_debt' },
    { id: 'dash-sec-complexity',  widget: 'complexity' },
    { id: 'dash-sec-duplication', widget: 'duplication' },
    { id: 'dash-sec-coupling',    widget: 'coupling' },
    { id: 'dash-sec-issues',      widget: 'issues' },
    { id: 'dash-sec-structure',   widget: 'structure' },
    { id: 'dash-sec-graph',       widget: 'graph_intelligence' },
    { id: 'dash-sec-temporal',    widget: 'temporal' },
];

function _dashBuildDOM() {
    if (document.getElementById('dashboard-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'dashboard-overlay';

    const sectionsHTML = _DASH_SECTIONS
        .map(s => `<section id="${s.id}" class="dash-section" data-widget="${s.widget}"></section>`)
        .join('\n');

    overlay.innerHTML = `
<div id="dashboard-panel">
  <div id="dashboard-scroll">
    ${sectionsHTML}
  </div>
</div>`;

    document.body.appendChild(overlay);

    // Backdrop click + ESC close
    overlay.addEventListener('click', e => {
        if (e.target === overlay) closeDashboard();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && overlay.style.display !== 'none') closeDashboard();
    });

    _dashBuilt = true;
}
