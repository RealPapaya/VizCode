'use strict';

// Overview Treemap
// Owns the file-centric treemap model, layout, viewport, and selection sync.
// viz_overview_flow.js owns the surrounding Overview mode shell; this module
// owns everything specific to drawing and interacting with the treemap.

let _overviewTreemapResizeObserver = null;
let _overviewTreemapResizeTimer = null;
let _overviewTreemapSelectedPath = '';
let _overviewTreemapSearchQuery = '';
let _overviewTreemapCellsByPath = new Map();
let _overviewTreemapViewport = { x: 0, y: 0, k: 1 };
let _overviewTreemapWorld = { w: 0, h: 0 };
let _overviewTreemapDrag = null;
let _overviewTreemapSuppressClick = false;

const _OVERVIEW_TREEMAP_MIN_ZOOM = 0.35;
const _OVERVIEW_TREEMAP_MAX_ZOOM = 5;
const _OVERVIEW_TREEMAP_PALETTE = [
    '#0ecf86', '#3f8bdd', '#73b60b', '#8d74d0',
    '#df8b35', '#df4f57', '#c83d88', '#23b7cc',
];

function _overviewTreemapFmtBytes(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function _overviewTreemapMetric(file) {
    const loc = file?.loc || {};
    const locTotal = Number(loc.code || 0) + Number(loc.comment || 0) + Number(loc.blank || 0);
    if (locTotal > 0) return Math.max(1, locTotal);

    const size = Math.max(0, Number(file?.size || 0));
    if (!size) return 1;

    // Raw bytes make markdown/images dominate and collapse the treemap into
    // long strips. LOC is still primary; size fallback is deliberately log-ish.
    const base = Math.log2(size + 1);
    if (file?.file_type === 'binary') return Math.max(1, base * 2.2);
    return Math.max(1, base * 5);
}

function _overviewTreemapLineCount(file) {
    const loc = file?.loc || {};
    const locTotal = Number(loc.code || 0) + Number(loc.comment || 0) + Number(loc.blank || 0);
    return Math.max(0, locTotal || Number(file?.lines || 0) || 0);
}

function _overviewTreemapFiles() {
    const files = [];
    Object.entries(window.DATA?.files_by_module || {}).forEach(([moduleKey, bucket]) => {
        bucket.forEach(file => files.push({ ...file, _module: moduleKey }));
    });
    Object.entries(window.DATA?.other_files_by_module || {}).forEach(([moduleKey, bucket]) => {
        bucket.forEach(file => files.push({ ...file, _module: moduleKey }));
    });
    return files;
}

function _overviewTreemapNormPath(path) {
    return _gNormPath(path || '');
}

function _overviewTreemapHashString(value) {
    let h = 0;
    const str = String(value || '');
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return h;
}

function _overviewTreemapModuleColor(path) {
    const modId = _gNormPath(path).split('/')[0] || '_root';
    const mod = (window.DATA?.modules || []).find(m => m.id === modId);
    return mod?.color || _G_COMMUNITY_PALETTE[Math.abs(_overviewTreemapHashString(modId)) % _G_COMMUNITY_PALETTE.length];
}

function _overviewTreemapGroupColor(group, index) {
    const key = String(group?.key || '');
    const label = String(group?.label || '');
    const text = `${key}/${label}`.toLowerCase();
    if (text.includes('parser')) return '#0ecf86';
    if (text.includes('style') || text.includes('css')) return '#c83d88';
    if (text.includes('dashboard')) return '#df4f57';
    if (text.includes('server') || text.includes('mcp')) return '#df8b35';
    if (text.includes('core')) return '#3f8bdd';
    if (text.includes('symbol') || text.includes('preference') || text.includes('toolbar')) return '#73b60b';
    if (text.includes('galaxy') || text.includes('treemap') || text.includes('graph')) return '#8d74d0';
    if (text.includes('chat') || text.includes('ui')) return '#23b7cc';
    return _OVERVIEW_TREEMAP_PALETTE[index % _OVERVIEW_TREEMAP_PALETTE.length];
}

function _overviewTreemapGroupPriority(group) {
    const text = `${group?.key || ''}/${group?.label || ''}`.toLowerCase();
    if (text.includes('parser')) return 0;
    if (text.includes('style') || text.includes('css')) return 1;
    if (text.includes('core')) return 2;
    if (text.includes('server') || text.includes('mcp')) return 3;
    if (text.includes('search') || text.includes('chat')) return 4;
    if (text.includes('ui') || text.includes('preference') || text.includes('toolbar')) return 5;
    if (text.includes('symbol')) return 6;
    if (text.includes('galaxy') || text.includes('treemap') || text.includes('graph')) return 7;
    if (text.includes('dashboard')) return 8;
    return 20;
}

function _overviewTreemapModuleLabel(key) {
    const mod = (window.DATA?.modules || []).find(m => m.id === key);
    return mod?.label || (key === '_root' ? _gRootLabel() : key);
}

function _overviewTreemapGroupKey(file, path) {
    const parts = path.split('/').filter(Boolean);
    if (parts[0] === 'static' && parts[1] === 'features' && parts.length > 2) {
        return parts.slice(0, 3).join('/');
    }
    if ((parts[0] === 'static' || parts[0] === 'src' || parts[0] === 'tests') && parts.length > 1) {
        return parts.slice(0, 2).join('/');
    }
    if (parts[0] === 'ai' && parts[1] === 'providers') return 'ai/providers';
    if (parts[0] === 'ai') return 'ai';
    if (parts[0] === 'testproject' && parts.length > 2) return parts.slice(0, 2).join('/');
    const moduleKey = _overviewTreemapNormPath(file?._module || '');
    if (moduleKey && moduleKey !== '_root') return moduleKey;
    if (parts.length > 1) return parts[0];
    const ext = (file?.ext || '').replace(/^\./, '').toLowerCase();
    return ext ? `_root:${ext}` : '_root:files';
}

function _overviewTreemapSquarify(items, rect) {
    const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
    const scale = (rect.w * rect.h) / total;
    const scaled = items.map(item => ({ ...item, area: Math.max(1, item.value * scale) }));
    const out = [];
    let row = [];
    let rest = { ...rect };

    const worst = (candidate, side) => {
        if (!candidate.length) return Infinity;
        const areas = candidate.map(d => d.area);
        const sum = areas.reduce((a, b) => a + b, 0);
        const max = Math.max(...areas);
        const min = Math.max(1, Math.min(...areas));
        const s2 = side * side;
        return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
    };

    const layoutRow = () => {
        if (!row.length) return;
        const area = row.reduce((sum, item) => sum + item.area, 0);
        const horizontal = rest.w >= rest.h;
        if (horizontal) {
            const h = Math.max(1, area / Math.max(1, rest.w));
            let x = rest.x;
            row.forEach(item => {
                const w = item.area / h;
                out.push({ ...item, x, y: rest.y, w, h });
                x += w;
            });
            rest.y += h;
            rest.h -= h;
        } else {
            const w = Math.max(1, area / Math.max(1, rest.h));
            let y = rest.y;
            row.forEach(item => {
                const h = item.area / w;
                out.push({ ...item, x: rest.x, y, w, h });
                y += h;
            });
            rest.x += w;
            rest.w -= w;
        }
        row = [];
    };

    scaled.forEach(item => {
        const side = Math.min(rest.w, rest.h);
        if (!row.length || worst([...row, item], side) <= worst(row, side)) row.push(item);
        else { layoutRow(); row.push(item); }
    });
    layoutRow();
    return out;
}

function _overviewTreemapBinary(items, rect) {
    if (!items.length) return [];
    if (items.length === 1) return [{ ...items[0], ...rect }];

    const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
    const half = total / 2;
    let split = 1;
    let acc = items[0].value;
    while (split < items.length - 1 && acc + items[split].value <= half) {
        acc += items[split].value;
        split++;
    }
    if (split < items.length - 1) {
        const withNext = Math.abs((acc + items[split].value) - half);
        const withoutNext = Math.abs(acc - half);
        if (withNext < withoutNext) {
            acc += items[split].value;
            split++;
        }
    }

    const first = items.slice(0, split);
    const second = items.slice(split);
    const firstValue = first.reduce((sum, item) => sum + item.value, 0) || 1;
    const ratio = Math.max(0.04, Math.min(0.96, firstValue / total));

    if (rect.w >= rect.h) {
        const w1 = rect.w * ratio;
        return [
            ..._overviewTreemapBinary(first, { x: rect.x, y: rect.y, w: w1, h: rect.h }),
            ..._overviewTreemapBinary(second, { x: rect.x + w1, y: rect.y, w: rect.w - w1, h: rect.h }),
        ];
    }
    const h1 = rect.h * ratio;
    return [
        ..._overviewTreemapBinary(first, { x: rect.x, y: rect.y, w: rect.w, h: h1 }),
        ..._overviewTreemapBinary(second, { x: rect.x, y: rect.y + h1, w: rect.w, h: rect.h - h1 }),
    ];
}

function _overviewTreemapBuildLayout(files, w, h) {
    const groupsByKey = new Map();
    files.forEach(file => {
        const path = _overviewTreemapNormPath(file.path);
        if (!path) return;
        const key = _overviewTreemapGroupKey(file, path);
        if (!groupsByKey.has(key)) {
            groupsByKey.set(key, {
                key,
                label: key.startsWith('_root:') ? key.slice(6) : _overviewTreemapModuleLabel(key),
                color: _overviewTreemapModuleColor(key),
                files: [],
                value: 0,
            });
        }
        const group = groupsByKey.get(key);
        const value = _overviewTreemapMetric(file);
        group.files.push({ file, value });
        group.value += value;
    });

    const groups = Array.from(groupsByKey.values())
        .filter(group => group.value > 0 && group.files.length)
        .sort((a, b) => {
            const pa = _overviewTreemapGroupPriority(a);
            const pb = _overviewTreemapGroupPriority(b);
            return pa === pb ? b.value - a.value : pa - pb;
        });
    groups.forEach((group, index) => { group.color = _overviewTreemapGroupColor(group, index); });
    const groupRects = _overviewTreemapBinary(groups, { x: 0, y: 0, w, h });
    const cells = [];
    groupRects.forEach(group => {
        const pad = group.w > 40 && group.h > 40 ? 3 : 1.5;
        const inner = {
            x: group.x + pad,
            y: group.y + pad,
            w: Math.max(1, group.w - pad * 2),
            h: Math.max(1, group.h - pad * 2),
        };
        const fileItems = group.files
            .map(item => ({ file: item.file, value: item.value, color: group.color, group: group.label }))
            .sort((a, b) => b.value - a.value);
        _overviewTreemapBinary(fileItems, inner).forEach(cell => cells.push(cell));
    });
    return { groups: groupRects, cells };
}

function _overviewTreemapClampViewport() {
    const grid = document.querySelector('#overview-treemap-host .overview-treemap-grid');
    if (!grid) return;
    const vw = grid.clientWidth || 1;
    const vh = grid.clientHeight || 1;
    const worldW = Math.max(1, _overviewTreemapWorld.w * _overviewTreemapViewport.k);
    const worldH = Math.max(1, _overviewTreemapWorld.h * _overviewTreemapViewport.k);
    const margin = 64;
    if (worldW <= vw) _overviewTreemapViewport.x = (vw - worldW) / 2;
    else _overviewTreemapViewport.x = Math.min(margin, Math.max(vw - worldW - margin, _overviewTreemapViewport.x));
    if (worldH <= vh) _overviewTreemapViewport.y = (vh - worldH) / 2;
    else _overviewTreemapViewport.y = Math.min(margin, Math.max(vh - worldH - margin, _overviewTreemapViewport.y));
}

function _overviewTreemapApplyTransform() {
    const canvas = document.querySelector('#overview-treemap-host .overview-treemap-canvas');
    if (!canvas) return;
    _overviewTreemapClampViewport();
    canvas.style.transform = `translate(${_overviewTreemapViewport.x}px, ${_overviewTreemapViewport.y}px) scale(${_overviewTreemapViewport.k})`;
}

function _overviewTreemapZoomAt(clientX, clientY, nextK) {
    const grid = document.querySelector('#overview-treemap-host .overview-treemap-grid');
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const k = Math.max(_OVERVIEW_TREEMAP_MIN_ZOOM, Math.min(_OVERVIEW_TREEMAP_MAX_ZOOM, nextK));
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const wx = (px - _overviewTreemapViewport.x) / _overviewTreemapViewport.k;
    const wy = (py - _overviewTreemapViewport.y) / _overviewTreemapViewport.k;
    _overviewTreemapViewport.x = px - wx * k;
    _overviewTreemapViewport.y = py - wy * k;
    _overviewTreemapViewport.k = k;
    _overviewTreemapApplyTransform();
}

function _overviewTreemapResetViewport() {
    _overviewTreemapViewport = { x: 0, y: 0, k: 1 };
    _overviewTreemapApplyTransform();
}

function _overviewTreemapCenterCell(cell, animated = true) {
    const canvas = document.querySelector('#overview-treemap-host .overview-treemap-canvas');
    const grid = document.querySelector('#overview-treemap-host .overview-treemap-grid');
    if (!canvas || !grid || !cell) return;
    const k = Math.max(1, Math.min(2.4, _overviewTreemapViewport.k || 1));
    _overviewTreemapViewport.k = k;
    _overviewTreemapViewport.x = (grid.clientWidth || 0) / 2 - (cell.x + cell.w / 2) * k;
    _overviewTreemapViewport.y = (grid.clientHeight || 0) / 2 - (cell.y + cell.h / 2) * k;
    canvas.classList.toggle('is-animating', !!animated);
    _overviewTreemapApplyTransform();
    if (animated) setTimeout(() => canvas.classList.remove('is-animating'), 220);
}

function _overviewTreemapApplySearchClasses() {
    const q = (_overviewTreemapSearchQuery || '').trim().toLowerCase();
    _overviewTreemapCellsByPath.forEach(cell => {
        const el = cell.el;
        if (!el) return;
        el.classList.remove('search-hit', 'search-dim');
        if (!q) return;
        const hay = `${cell.file?.path || ''} ${cell.file?.label || ''}`.toLowerCase();
        el.classList.add(hay.includes(q) ? 'search-hit' : 'search-dim');
    });
}

function _overviewTreemapInstallInteractions(grid) {
    if (!grid || grid.dataset.treemapBound === '1') return;
    grid.dataset.treemapBound = '1';
    grid.addEventListener('wheel', event => {
        if (_overviewMode !== 'treemap') return;
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14;
        _overviewTreemapZoomAt(event.clientX, event.clientY, _overviewTreemapViewport.k * factor);
        if (typeof refreshGraphZoomControls === 'function') refreshGraphZoomControls();
    }, { passive: false });
    grid.addEventListener('pointerdown', event => {
        if (_overviewMode !== 'treemap' || event.button !== 0) return;
        _overviewTreemapDrag = { id: event.pointerId, sx: event.clientX, sy: event.clientY, x: _overviewTreemapViewport.x, y: _overviewTreemapViewport.y, moved: false };
        grid.setPointerCapture?.(event.pointerId);
    });
    grid.addEventListener('pointermove', event => {
        const drag = _overviewTreemapDrag;
        if (!drag || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.sx;
        const dy = event.clientY - drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (!drag.moved) return;
        event.preventDefault();
        grid.classList.add('dragging');
        _overviewTreemapViewport.x = drag.x + dx;
        _overviewTreemapViewport.y = drag.y + dy;
        _overviewTreemapApplyTransform();
    });
    const finishDrag = event => {
        const drag = _overviewTreemapDrag;
        if (!drag || drag.id !== event.pointerId) return;
        grid.releasePointerCapture?.(event.pointerId);
        grid.classList.remove('dragging');
        _overviewTreemapDrag = null;
        if (drag.moved) {
            _overviewTreemapSuppressClick = true;
            setTimeout(() => { _overviewTreemapSuppressClick = false; }, 0);
        }
    };
    grid.addEventListener('pointerup', finishDrag);
    grid.addEventListener('pointercancel', finishDrag);
    grid.addEventListener('dblclick', event => {
        event.preventDefault();
        _overviewTreemapResetViewport();
    });
}

function _overviewTreemapTooltip(cell, event) {
    const { container } = _overviewEnsureHosts();
    if (!container) return;
    if (!_gTooltipEl) {
        _gTooltipEl = document.createElement('div');
        _gTooltipEl.className = 'galaxy-tooltip';
        container.appendChild(_gTooltipEl);
    }
    const f = cell.file;
    const funcs = (window.DATA?.funcs_by_file?.[f.path] || []).length;
    const lines = _overviewTreemapLineCount(f);
    _gTooltipEl.innerHTML =
        `<div class="gt-name" style="color:${cell.color}">${_gEsc(f.label || _gLastSegment(f.path))}</div>` +
        `<div class="gt-type">File</div>` +
        `<div class="gt-loc">${_gEsc(f.path || '')}</div>` +
        `<div class="gt-mod">${_gEsc(cell.group || _gDirname(f.path) || _gRootLabel())}</div>` +
        `<div class="gt-degree">${lines ? `${lines} lines` : _overviewTreemapFmtBytes(f.size)} &middot; ${funcs} functions</div>`;
    _gTooltipEl.style.display = 'block';
    _gTooltipEl.style.borderColor = cell.color;
    const bounds = container.getBoundingClientRect();
    const pad = 10;
    const width = _gTooltipEl.offsetWidth || 0;
    const height = _gTooltipEl.offsetHeight || 0;
    const left = Math.min(Math.max(event.clientX - bounds.left + 14, pad), Math.max(pad, container.clientWidth - width - pad));
    const top = Math.min(Math.max(event.clientY - bounds.top + 14, pad), Math.max(pad, container.clientHeight - height - pad));
    _gTooltipEl.style.left = `${left}px`;
    _gTooltipEl.style.top = `${top}px`;
}

function _overviewTreemapUpdateActionButtons(path) {
    if (typeof updateCallGraphBtn === 'function') updateCallGraphBtn(path);
    if (window.svUpdateStructureBtn && path) {
        const fname = path.split('/').pop() || '';
        const ext = fname.includes('.') ? '.' + fname.split('.').pop().toLowerCase() : '';
        window.svUpdateStructureBtn(path, ext);
    }
}

function _overviewTreemapDisableFilterPanel() {
    const wrap = document.getElementById('sb-body-filters');
    if (wrap && _gFilterPanelSaved === null) _gFilterPanelSaved = wrap.innerHTML;
    if (wrap) {
        wrap.innerHTML = '<div id="filters-title" data-i18n="filters">Filters</div><div class="ft-filter-placeholder">Treemap uses Explorer and Search for file selection.</div>';
    }
    if (typeof _sbActiveTab !== 'undefined' && _sbActiveTab === 'filters') {
        _sbActiveTab = 'explorer';
        if (typeof _applySidebarTab === 'function') _applySidebarTab();
    }
    if (typeof updateFilterTabEnabled === 'function') updateFilterTabEnabled();
}

function _overviewTreemapSelectFile(path, opts = {}) {
    if (_overviewMode !== 'treemap' || !state?.galaxyActive) return false;
    const norm = _overviewTreemapNormPath(path);
    if (!norm) return false;
    _overviewTreemapSelectedPath = norm;

    const host = document.getElementById('overview-treemap-host');
    if (!host?.querySelector('.overview-treemap-cell')) _overviewRenderTreemap();
    const cell = _overviewTreemapCellsByPath.get(norm);
    host?.querySelectorAll('.overview-treemap-cell.active').forEach(node => node.classList.remove('active'));
    if (cell?.el) {
        cell.el.classList.add('active');
        if (opts.center !== false) _overviewTreemapCenterCell(cell, opts.animated !== false);
    }

    if (opts.revealExplorer !== false && typeof revealSidebarExplorerPath === 'function') revealSidebarExplorerPath(norm, 'file');
    if (opts.openCode !== false && typeof loadFileInPanel === 'function') loadFileInPanel(norm, opts.funcName || null);
    if (opts.updateActions !== false) _overviewTreemapUpdateActionButtons(norm);
    return !!cell;
}

function _overviewRenderTreemap() {
    const { treemapHost } = _overviewEnsureHosts();
    if (!treemapHost || _overviewMode !== 'treemap') return;
    treemapHost.innerHTML = '<div class="overview-treemap"><div class="overview-treemap-grid"><div class="overview-treemap-canvas"></div></div></div>';
    const grid = treemapHost.querySelector('.overview-treemap-grid');
    const canvas = treemapHost.querySelector('.overview-treemap-canvas');
    if (!grid || !canvas) return;
    const files = _overviewTreemapFiles();
    if (!files.length) {
        grid.innerHTML = '<div class="overview-treemap-empty">No files to display</div>';
        return;
    }
    const rect = grid.getBoundingClientRect();
    const w = Math.max(240, rect.width || treemapHost.clientWidth || 800);
    const h = Math.max(220, rect.height || treemapHost.clientHeight || 520);
    _overviewTreemapWorld = { w, h };
    _overviewTreemapCellsByPath = new Map();
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const { groups, cells } = _overviewTreemapBuildLayout(files, w, h);
    const frag = document.createDocumentFragment();
    groups.forEach(group => {
        const bg = document.createElement('div');
        bg.className = 'overview-treemap-group';
        bg.style.cssText = `left:${Math.round(group.x)}px;top:${Math.round(group.y)}px;width:${Math.max(0, Math.round(group.w) - 2)}px;height:${Math.max(0, Math.round(group.h) - 2)}px;border-color:${group.color}`;
        frag.appendChild(bg);
    });

    cells.forEach(cell => {
        const el = document.createElement('div');
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.className = 'overview-treemap-cell';
        const filePath = _overviewTreemapNormPath(cell.file.path);
        if (filePath === _overviewTreemapSelectedPath) el.classList.add('active');
        const x = Math.round(cell.x);
        const y = Math.round(cell.y);
        const cw = Math.max(0, Math.round(cell.w) - 2);
        const ch = Math.max(0, Math.round(cell.h) - 2);
        const lines = _overviewTreemapLineCount(cell.file);
        el.style.cssText = `left:${x}px;top:${y}px;width:${cw}px;height:${ch}px;background:${cell.color}`;
        el.dataset.path = filePath;
        el.setAttribute('aria-label', cell.file.path || cell.file.label || 'file');
        cell.el = el;
        _overviewTreemapCellsByPath.set(filePath, cell);
        if (cw > 34 && ch > 18) {
            const label = document.createElement('span');
            label.className = 'overview-treemap-label';
            label.textContent = cell.file.label || _gLastSegment(cell.file.path);
            el.appendChild(label);
        }
        if (cw > 42 && ch > 30) {
            const meta = document.createElement('span');
            meta.className = 'overview-treemap-meta';
            meta.textContent = lines ? `${lines} Lines` : _overviewTreemapFmtBytes(cell.file.size);
            el.appendChild(meta);
        }
        el.addEventListener('mouseenter', e => _overviewTreemapTooltip(cell, e));
        el.addEventListener('mousemove', e => _overviewTreemapTooltip(cell, e));
        el.addEventListener('mouseleave', _galaxyHideTooltip);
        el.addEventListener('click', () => {
            if (_overviewTreemapSuppressClick) return;
            _overviewTreemapSelectFile(filePath, { center: false, openCode: true });
        });
        el.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            _overviewTreemapSelectFile(filePath, { center: false, openCode: true });
        });
        frag.appendChild(el);
    });
    canvas.appendChild(frag);
    _overviewTreemapInstallInteractions(grid);
    _overviewTreemapApplyTransform();
    _overviewTreemapApplySearchClasses();
}

function _overviewTreemapInstallResize() {
    const { treemapHost } = _overviewEnsureHosts();
    if (!treemapHost || _overviewTreemapResizeObserver || typeof ResizeObserver !== 'function') return;
    _overviewTreemapResizeObserver = new ResizeObserver(() => {
        if (_overviewMode !== 'treemap') return;
        clearTimeout(_overviewTreemapResizeTimer);
        _overviewTreemapResizeTimer = setTimeout(_overviewRenderTreemap, 80);
    });
    _overviewTreemapResizeObserver.observe(treemapHost);
}

function _overviewTreemapDestroy() {
    clearTimeout(_overviewTreemapResizeTimer);
    _overviewTreemapResizeTimer = null;
    if (_overviewTreemapResizeObserver) {
        try { _overviewTreemapResizeObserver.disconnect(); } catch (_) {}
        _overviewTreemapResizeObserver = null;
    }
    const host = document.getElementById('overview-treemap-host');
    if (host) host.innerHTML = '';
}

window.overviewTreemapOpen = function () {
    _overviewTreemapDisableFilterPanel();
    _overviewTreemapInstallResize();
    requestAnimationFrame(_overviewRenderTreemap);
};

window.overviewTreemapClose = function () {
    _galaxyHideTooltip();
};

window.overviewTreemapDestroy = _overviewTreemapDestroy;

window.overviewTreemapZoomByStep = function (direction) {
    const grid = document.querySelector('#overview-treemap-host .overview-treemap-grid');
    if (!grid) return false;
    const rect = grid.getBoundingClientRect();
    const factor = direction > 0 ? 1.25 : 0.8;
    _overviewTreemapZoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, _overviewTreemapViewport.k * factor);
    if (typeof refreshGraphZoomControls === 'function') refreshGraphZoomControls();
    return true;
};

window.overviewTreemapSelectFile = function (filePath, opts = {}) {
    return _overviewTreemapSelectFile(filePath, opts);
};

window.overviewTreemapSyncCurrentFile = function (filePath) {
    return _overviewTreemapSelectFile(filePath, { openCode: false, revealExplorer: true, center: true });
};

window.overviewTreemapSetSearchQuery = function (query) {
    _overviewTreemapSearchQuery = query || '';
    _overviewTreemapApplySearchClasses();
};

window.isOverviewTreemapActive = function () {
    return !!state?.galaxyActive && _overviewMode === 'treemap';
};
