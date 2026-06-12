'use strict';

// Overview flow owns the shell that switches between the existing Galaxy graph
// and alternate overview surfaces. Galaxy graph internals stay in viz_galaxy.js.

let _overviewMode = 'galaxy';

function _overviewEnsureHosts() {
    const container = document.getElementById('galaxy-container');
    if (!container) return {};
    const ensureHost = id => {
        let host = document.getElementById(id);
        if (!host) {
            host = document.createElement('div');
            host.id = id;
            host.className = 'overview-mode-host';
            container.appendChild(host);
        }
        return host;
    };
    const treemapHost = ensureHost('overview-treemap-host');
    const sankeyHost = ensureHost('overview-sankey-host');
    return { container, treemapHost, sankeyHost };
}

function _overviewSetHostMode(mode) {
    const { container, treemapHost, sankeyHost } = _overviewEnsureHosts();
    if (!container || !treemapHost || !sankeyHost) return;
    const isTreemap = mode === 'treemap';
    const isSankey = mode === 'sankey';
    container.classList.toggle('overview-treemap-active', isTreemap);
    container.classList.toggle('overview-sankey-active', isSankey);
    treemapHost.classList.toggle('active', isTreemap);
    sankeyHost.classList.toggle('active', isSankey);
    // Body marker so the code panel can float over the Sankey (overlay, not
    // squeeze) instead of consuming flex width and reflowing the diagram.
    document.body.classList.toggle('overview-sankey-mode', isSankey);
    if (!isTreemap && !isSankey && typeof _gSig !== 'undefined' && _gSig?.refresh) {
        requestAnimationFrame(() => {
            try { _gSig.refresh(); } catch (_) {}
        });
    }
}

function _overviewDestroyTreemap() {
    if (typeof window.overviewTreemapDestroy === 'function') {
        window.overviewTreemapDestroy();
        return;
    }
    const host = document.getElementById('overview-treemap-host');
    if (host) host.innerHTML = '';
}

function _overviewDestroySankey() {
    if (typeof window.overviewSankeyDestroy === 'function') {
        window.overviewSankeyDestroy();
        return;
    }
    const host = document.getElementById('overview-sankey-host');
    if (host) host.innerHTML = '';
}

function _overviewEnter(mode = 'galaxy') {
    _overviewMode = mode === 'treemap' || mode === 'sankey' ? mode : 'galaxy';
    if (typeof window._lswEnterOverview === 'function') window._lswEnterOverview(_overviewMode);
    _overviewSetHostMode(_overviewMode);
    if (_overviewMode === 'treemap') {
        if (typeof window.overviewSankeyClose === 'function') window.overviewSankeyClose();
        if (typeof window.overviewTreemapOpen === 'function') window.overviewTreemapOpen();
    } else if (_overviewMode === 'sankey') {
        if (typeof window.overviewTreemapClose === 'function') window.overviewTreemapClose();
        if (typeof window.overviewSankeyOpen === 'function') window.overviewSankeyOpen();
    } else {
        if (typeof window.overviewTreemapClose === 'function') window.overviewTreemapClose();
        if (typeof window.overviewSankeyClose === 'function') window.overviewSankeyClose();
        if (typeof _galaxyHideTooltip === 'function') _galaxyHideTooltip();
        if (typeof _gGraph !== 'undefined' && _gGraph && typeof _galaxyBuildFilterPanel === 'function') {
            _galaxyBuildFilterPanel();
        }
    }
    if (typeof refreshGraphZoomControls === 'function') refreshGraphZoomControls();
}

function _overviewExit() {
    _overviewMode = 'galaxy';
    if (typeof window._lswExitOverview === 'function') window._lswExitOverview();
    _overviewSetHostMode('galaxy');
    _overviewDestroyTreemap();
    _overviewDestroySankey();
}

window.setOverviewMode = function (mode) {
    if (!state?.galaxyActive) {
        if (typeof window.openGalaxy === 'function') {
            const pending = window.openGalaxy();
            if (state?.galaxyActive) {
                _overviewEnter(mode);
                return;
            }
            Promise.resolve(pending).then(() => {
                if (state?.galaxyActive) _overviewEnter(mode);
            });
        }
        return;
    }
    _overviewEnter(mode);
};

window.isOverviewTreemapActive = function () {
    return !!state?.galaxyActive && _overviewMode === 'treemap';
};

const _overviewBaseOpenGalaxy = window.openGalaxy;
if (typeof _overviewBaseOpenGalaxy === 'function') {
    window.openGalaxy = function () {
        const result = _overviewBaseOpenGalaxy.apply(this, arguments);
        if (state?.galaxyActive) _overviewEnter('galaxy');
        return result;
    };
}

const _overviewBaseCloseGalaxy = window.closeGalaxy;
if (typeof _overviewBaseCloseGalaxy === 'function') {
    window.closeGalaxy = function () {
        const result = _overviewBaseCloseGalaxy.apply(this, arguments);
        _overviewExit();
        return result;
    };
}

const _overviewBaseZoomGalaxyByStep = window.zoomGalaxyByStep;
if (typeof _overviewBaseZoomGalaxyByStep === 'function') {
    window.zoomGalaxyByStep = function (direction) {
        if (_overviewMode === 'treemap') {
            if (typeof window.overviewTreemapZoomByStep === 'function') {
                window.overviewTreemapZoomByStep(direction);
            }
            return;
        }
        if (_overviewMode === 'sankey') {
            if (typeof window.overviewSankeyZoomByStep === 'function') {
                window.overviewSankeyZoomByStep(direction);
            }
            return;
        }
        return _overviewBaseZoomGalaxyByStep.apply(this, arguments);
    };
}

const _overviewBaseGalaxyHighlightByPath = window.galaxyHighlightByPath;
if (typeof _overviewBaseGalaxyHighlightByPath === 'function') {
    window.galaxyHighlightByPath = function (filePath) {
        if (_overviewMode === 'treemap') {
            if (typeof window.overviewTreemapSelectFile === 'function') {
                return window.overviewTreemapSelectFile(filePath, { openCode: true, revealExplorer: false });
            }
            return false;
        }
        if (_overviewMode === 'sankey') {
            if (typeof window.overviewSankeySelectFile === 'function') {
                return window.overviewSankeySelectFile(filePath);
            }
            return false;
        }
        return _overviewBaseGalaxyHighlightByPath.apply(this, arguments);
    };
}

const _overviewBaseRefreshTheme = window._galaxyRefreshThemeColors;
if (typeof _overviewBaseRefreshTheme === 'function') {
    window._galaxyRefreshThemeColors = function () {
        const prevMode = _overviewMode;
        const result = _overviewBaseRefreshTheme.apply(this, arguments);
        if (prevMode === 'treemap' && typeof window.overviewTreemapOpen === 'function') {
            window.overviewTreemapOpen();
        } else if (prevMode === 'sankey' && typeof window.overviewSankeyOpen === 'function') {
            window.overviewSankeyOpen();
        }
        return result;
    };
}
