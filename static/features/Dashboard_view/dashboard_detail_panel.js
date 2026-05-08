// @module Dashboard_view/dashboard_detail_panel
// Shared zoom-to-center detail overlay.
// Usage: _dashOpenDetailPanel(widgetId, originRect)
//   originRect = the widget's getBoundingClientRect()

let _dashDetailEscBound = false;
let _dashDetailOpen     = false;

function _dashOpenDetailPanel(widgetId, originRect) {
    if (_dashDetailOpen) _dashCloseDetailPanel(true);  // replace if already open

    const widget = _dashWidgetRegistry[widgetId];
    if (!widget) return;

    // Compute transform-origin so the panel appears to expand from the widget
    const panelW    = window.innerWidth  * 0.60;
    const panelH    = window.innerHeight * 0.72;
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
    panel.className = 'dash-detail-panel';
    panel.id = 'dash-detail-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.style.transformOrigin = `${originX}px ${originY}px`;

    const label      = _dashT(widget.labelKey || widget.id) || widget.id;
    const detailLabel = _dashT(widget.detailLabelKey || '') || label;

    panel.innerHTML = `
<div class="dash-detail-head">
  <div class="dash-detail-head-title">
    <span class="dash-detail-head-label">Detail</span>
    <span class="dash-detail-head-name">${_dashEscape(detailLabel)}</span>
  </div>
  <button class="dash-detail-close" id="dash-detail-close" type="button" aria-label="Close">×</button>
</div>
<div class="dash-detail-body" id="dash-detail-body"></div>`;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    // Render detail content
    const body = document.getElementById('dash-detail-body');
    if (body && typeof widget.renderDetail === 'function') {
        try {
            widget.renderDetail(body, DATA.stats);
        } catch (err) {
            console.error(`[dashboard] detail for ${widgetId} failed:`, err);
            body.innerHTML = `<div class="dash-empty">⚠ detail unavailable</div>`;
        }
    }

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

function _dashCloseDetailPanel(immediate) {
    const backdrop = document.getElementById('dash-detail-backdrop');
    const panel    = document.getElementById('dash-detail-panel');
    if (!backdrop && !panel) return;

    _dashDetailOpen = false;

    const cleanup = () => {
        // Destroy any charts rendered inside the detail body
        const body = document.getElementById('dash-detail-body');
        if (body) {
            body.querySelectorAll('canvas').forEach(canvas => {
                if (canvas.id && _dashCharts && _dashCharts[canvas.id]) {
                    try { _dashCharts[canvas.id].destroy(); } catch (_) {}
                    delete _dashCharts[canvas.id];
                }
            });
        }
        backdrop?.remove();
        panel?.remove();
    };

    if (immediate) {
        cleanup();
        return;
    }

    // Animate close
    backdrop?.classList.remove('open');
    panel?.classList.remove('open');

    const duration = 270;
    setTimeout(cleanup, duration);
}

function _dashDetailKeyHandler(e) {
    if (e.key === 'Escape' && _dashDetailOpen) {
        e.stopPropagation();
        _dashCloseDetailPanel();
    }
}
