// @ts-nocheck -- JS->TS migration: deferred (not in page load order / unused). Curate or remove later.
// @module Dashboard_view/dashboard_export
// Print-driven dashboard export. Toggles a body class so print CSS in
// viz_overlays.css can isolate the dashboard overlay and re-style it for
// paper. Closes any drilldown panel first so the printout reflects the
// dashboard surface only.

function _dashExportPrint() {
    if (typeof _dashCloseDrilldown === 'function') {
        _dashCloseDrilldown();
    }

    document.body.classList.add('dash-printing');

    const cleanup = () => {
        document.body.classList.remove('dash-printing');
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    // Defer one frame so any pending re-renders settle before the browser
    // snapshots the page for printing.
    requestAnimationFrame(() => {
        try {
            window.print();
        } catch (_) {
            cleanup();
        }
    });
}
