'use strict';

// Overview flow owns the shell that switches between the existing Galaxy graph
// and alternate overview surfaces. Galaxy graph internals stay in viz_galaxy.js.

let _overviewMode = 'galaxy';

function _overviewEnsureHosts() {
    const container = document.getElementById('galaxy-container');
    if (!container) return {};
    let treemapHost = document.getElementById('overview-treemap-host');
    if (!treemapHost) {
        treemapHost = document.createElement('div');
        treemapHost.id = 'overview-treemap-host';
        treemapHost.className = 'overview-mode-host';
        container.appendChild(treemapHost);
    }
    return { container, treemapHost };
}

function _overviewSetHostMode(mode) {
    const { container, treemapHost } = _overviewEnsureHosts();
    if (!container || !treemapHost) return;
    const isTreemap = mode === 'treemap';
    container.classList.toggle('overview-treemap-active', isTreemap);
    treemapHost.classList.toggle('active', isTreemap);
    if (!isTreemap && typeof _gSig !== 'undefined' && _gSig?.refresh) {
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

function _overviewEnter(mode = 'galaxy') {
    _overviewMode = mode === 'treemap' ? 'treemap' : 'galaxy';
    if (typeof window._lswEnterOverview === 'function') window._lswEnterOverview(_overviewMode);
    _overviewSetHostMode(_overviewMode);
    if (_overviewMode === 'treemap') {
        if (typeof window.overviewTreemapOpen === 'function') window.overviewTreemapOpen();
    } else {
        if (typeof window.overviewTreemapClose === 'function') window.overviewTreemapClose();
        else if (typeof _galaxyHideTooltip === 'function') _galaxyHideTooltip();
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
        return _overviewBaseGalaxyHighlightByPath.apply(this, arguments);
    };
}

const _overviewBaseRefreshTheme = window._galaxyRefreshThemeColors;
if (typeof _overviewBaseRefreshTheme === 'function') {
    window._galaxyRefreshThemeColors = function () {
        const wasTreemap = _overviewMode === 'treemap';
        const result = _overviewBaseRefreshTheme.apply(this, arguments);
        if (wasTreemap && typeof window.overviewTreemapOpen === 'function') {
            window.overviewTreemapOpen();
        }
        return result;
    };
}
