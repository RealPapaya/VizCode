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
    const panelW    = narrow ? Math.max(280, window.innerWidth - 28) : Math.min(980, Math.max(520, window.innerWidth - 96));
    const panelH    = narrow ? Math.max(360, window.innerHeight - 28) : Math.min(680, Math.max(420, window.innerHeight - 96));
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

    const body = document.getElementById('dash-detail-body');

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

function _dashCloseDetailPanel(immediate) {
    const backdrop = document.getElementById('dash-detail-backdrop');
    const panel    = document.getElementById('dash-detail-panel');
    if (!backdrop && !panel) return;

    _dashDetailOpen = false;

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
