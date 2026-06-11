'use strict';

// Overview Sankey
// Module→module dependency flow rendered as a two-column Sankey (sources on
// the left, targets on the right), with drill-down: modules → files within a
// module → functions within a file. viz_overview_flow.js owns the Overview
// mode shell; this module owns the flow models, SVG layout, and navigation.

// ── Sankey state ──────────────────────────────────────────────────────────────
let _overviewSankeyResizeObserver = null;
let _overviewSankeyResizeTimer = null;
let _overviewSankeyStack = [{ level: 'module' }];

const _OVERVIEW_SANKEY_TOP_MODULES = 15;
const _OVERVIEW_SANKEY_MAX_SIDE_NODES = 24;
const _OVERVIEW_SANKEY_NODE_W = 14;
const _OVERVIEW_SANKEY_NODE_GAP = 6;
const _OVERVIEW_SANKEY_LABEL_W = 190;
const _OVERVIEW_SANKEY_MIN_NODE_H = 4;
const _OVERVIEW_SANKEY_PAD = 14;
const _OVERVIEW_SANKEY_OTHERS = '__others__';
const _OVERVIEW_SANKEY_GRAY = '#64748b';
const _OVERVIEW_SANKEY_SVG_NS = 'http://www.w3.org/2000/svg';

// ── Flow models ───────────────────────────────────────────────────────────────
function _sankeyModuleLabel(modId) {
    const mod = (window.DATA?.modules || []).find(m => m.id === modId);
    return mod?.label || modId;
}

function _sankeyModuleColor(modId) {
    const mod = (window.DATA?.modules || []).find(m => m.id === modId);
    return mod?.color || _OVERVIEW_SANKEY_GRAY;
}

function _sankeyAddFlow(counts, s, t) {
    const key = `${s}\u0000${t}`;
    counts.set(key, (counts.get(key) || 0) + 1);
}

function _sankeyFlowsToLinks(counts) {
    return Array.from(counts.entries()).map(([key, w]) => {
        const [s, t] = key.split('\u0000');
        return { s, t, w };
    });
}

// Module level: directed module→module weights aggregated from file edges.
// DATA.module_edges is undirected (backend keys by sorted pair), so direction
// is recovered here from the per-file edges instead.
function _sankeyBuildModuleFlows() {
    const counts = new Map();
    Object.values(window.DATA?.file_edges_by_module || {}).forEach(edges => {
        (edges || []).forEach(e => {
            const sMod = _fileIdToModule[e.s];
            const tMod = _fileIdToModule[e.t];
            if (!sMod || !tMod || sMod === tMod) return;
            _sankeyAddFlow(counts, sMod, tMod);
        });
    });

    const totals = new Map();
    counts.forEach((w, key) => {
        const [s, t] = key.split('\u0000');
        totals.set(s, (totals.get(s) || 0) + w);
        totals.set(t, (totals.get(t) || 0) + w);
    });
    const ranked = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    const kept = new Set(ranked.slice(0, _OVERVIEW_SANKEY_TOP_MODULES).map(([id]) => id));
    const folded = ranked.slice(_OVERVIEW_SANKEY_TOP_MODULES).map(([id]) => _sankeyModuleLabel(id));

    const merged = new Map();
    counts.forEach((w, key) => {
        let [s, t] = key.split('\u0000');
        if (!kept.has(s)) s = _OVERVIEW_SANKEY_OTHERS;
        if (!kept.has(t)) t = _OVERVIEW_SANKEY_OTHERS;
        const k = `${s}\u0000${t}`;
        merged.set(k, (merged.get(k) || 0) + w);
    });

    const nodes = new Map();
    kept.forEach(id => nodes.set(id, {
        label: _sankeyModuleLabel(id),
        color: _sankeyModuleColor(id),
        title: _sankeyModuleLabel(id),
        drill: { level: 'file', module: id },
    }));
    if (folded.length) {
        nodes.set(_OVERVIEW_SANKEY_OTHERS, {
            label: `${T('sankeyOthers')} (${folded.length})`,
            color: _OVERVIEW_SANKEY_GRAY,
            gray: true,
            title: folded.join(', '),
        });
    }
    return { nodes, links: _sankeyFlowsToLinks(merged), unit: T('sankeyUnitDeps') };
}

// File level: file→file flow within one module, plus grayed boundary nodes
// for flow crossing the module boundary (⇠ inbound sources, ⇢ outbound sinks).
function _sankeyBuildFileFlows(modId) {
    const counts = new Map();
    const nodes = new Map();
    const color = _sankeyModuleColor(modId);

    const fileNode = fid => {
        const file = _fileIdToFile[fid];
        if (!file?.path) return null;
        const id = `f:${file.path}`;
        if (!nodes.has(id)) {
            nodes.set(id, {
                label: file.label || file.path.split('/').pop(),
                color,
                title: file.path,
                drill: { level: 'func', module: modId, file: file.path },
            });
        }
        return id;
    };
    const boundaryNode = (prefix, mod, arrow) => {
        const id = `${prefix}:${mod}`;
        if (!nodes.has(id)) {
            nodes.set(id, {
                label: `${arrow} ${_sankeyModuleLabel(mod)}`,
                color: _OVERVIEW_SANKEY_GRAY,
                gray: true,
                title: _sankeyModuleLabel(mod),
            });
        }
        return id;
    };

    Object.values(window.DATA?.file_edges_by_module || {}).forEach(edges => {
        (edges || []).forEach(e => {
            const sMod = _fileIdToModule[e.s];
            const tMod = _fileIdToModule[e.t];
            if (sMod !== modId && tMod !== modId) return;
            const sId = sMod === modId ? fileNode(e.s) : boundaryNode('in', sMod, '⇠');
            const tId = tMod === modId ? fileNode(e.t) : boundaryNode('out', tMod, '⇢');
            if (!sId || !tId || sId === tId) return;
            _sankeyAddFlow(counts, sId, tId);
        });
    });
    _sankeyFoldSides(counts, nodes);
    return { nodes, links: _sankeyFlowsToLinks(counts), unit: T('sankeyUnitDeps') };
}

// Function level: caller→callee flow within one file. Cross-file callees are
// grouped per target file (grayed); known system calls per category.
function _sankeyBuildFuncFlows(fileRel, modId) {
    const counts = new Map();
    const nodes = new Map();
    const color = _sankeyModuleColor(modId);
    const funcs = window.DATA?.funcs_by_file?.[fileRel] || [];
    const fidMap = new Map();
    funcs.forEach((f, i) => fidMap.set(f.label, i));

    const fnNode = idx => {
        const id = `fn:${idx}`;
        if (!nodes.has(id)) nodes.set(id, { label: funcs[idx].label, color, title: funcs[idx].label });
        return id;
    };
    const extNode = (id, label, title) => {
        if (!nodes.has(id)) nodes.set(id, { label, color: _OVERVIEW_SANKEY_GRAY, gray: true, title });
        return id;
    };

    const callList = window.DATA?.func_calls_by_file?.[fileRel];
    if (Array.isArray(callList) && callList.length) {
        const nameToFile = window.DATA?.func_name_to_file || {};
        const nameToFiles = window.DATA?.func_name_to_files || {};
        const knownCats = window.DATA?.func_known_categories || {};
        funcs.forEach((f, i) => {
            const calls = Array.isArray(callList[i]) ? callList[i] : [];
            calls.forEach(callee => {
                const idx = fidMap.get(callee);
                let tId = null;
                if (idx != null) {
                    if (idx === i) return;
                    tId = fnNode(idx);
                } else if (Object.prototype.hasOwnProperty.call(nameToFile, callee)) {
                    const target = nameToFile[callee];
                    tId = extNode(`ext:${target}`, `⇢ ${target.split('/').pop()}`, target);
                } else if (Object.prototype.hasOwnProperty.call(nameToFiles, callee)) {
                    tId = extNode(`amb:${callee}`, `${callee} ?`, (nameToFiles[callee] || []).join(', '));
                } else if (knownCats[callee]) {
                    tId = extNode(`sys:${knownCats[callee]}`, knownCats[callee], knownCats[callee]);
                }
                if (tId) _sankeyAddFlow(counts, fnNode(i), tId);
            });
        });
    } else {
        (window.DATA?.func_edges_by_file?.[fileRel] || []).forEach(e => {
            if (e.s === e.t || !funcs[e.s] || !funcs[e.t]) return;
            _sankeyAddFlow(counts, fnNode(e.s), fnNode(e.t));
        });
    }
    _sankeyFoldSides(counts, nodes);
    return { nodes, links: _sankeyFlowsToLinks(counts), unit: T('sankeyUnitCalls') };
}

// Cap each column at the top-N nodes by flow; fold the rest into "Others".
function _sankeyFoldSides(counts, nodes) {
    const outT = new Map();
    const inT = new Map();
    counts.forEach((w, key) => {
        const [s, t] = key.split('\u0000');
        outT.set(s, (outT.get(s) || 0) + w);
        inT.set(t, (inT.get(t) || 0) + w);
    });
    const keep = totals => new Set(Array.from(totals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, _OVERVIEW_SANKEY_MAX_SIDE_NODES)
        .map(([id]) => id));
    const keptL = keep(outT);
    const keptR = keep(inT);
    if (keptL.size >= outT.size && keptR.size >= inT.size) return;

    const merged = new Map();
    let foldedAny = false;
    counts.forEach((w, key) => {
        let [s, t] = key.split('\u0000');
        if (!keptL.has(s)) { s = _OVERVIEW_SANKEY_OTHERS; foldedAny = true; }
        if (!keptR.has(t)) { t = _OVERVIEW_SANKEY_OTHERS; foldedAny = true; }
        const k = `${s}\u0000${t}`;
        merged.set(k, (merged.get(k) || 0) + w);
    });
    counts.clear();
    merged.forEach((w, key) => counts.set(key, w));
    if (foldedAny && !nodes.has(_OVERVIEW_SANKEY_OTHERS)) {
        nodes.set(_OVERVIEW_SANKEY_OTHERS, {
            label: T('sankeyOthers'),
            color: _OVERVIEW_SANKEY_GRAY,
            gray: true,
            title: T('sankeyOthers'),
        });
    }
}

function _sankeyBuildModel(frame) {
    try {
        if (frame.level === 'file') return _sankeyBuildFileFlows(frame.module);
        if (frame.level === 'func') return _sankeyBuildFuncFlows(frame.file, frame.module);
        return _sankeyBuildModuleFlows();
    } catch (e) {
        console.error('[sankey]', e);
        return { nodes: new Map(), links: [], unit: '' };
    }
}

function _sankeyFrameTitle(frame) {
    if (frame.level === 'file') return T('sankeyLevelFiles', { name: _sankeyModuleLabel(frame.module) });
    if (frame.level === 'func') return T('sankeyLevelFuncs', { name: frame.file.split('/').pop() });
    return T('sankeyLevelModules');
}

// ── Layout ────────────────────────────────────────────────────────────────────
// Two columns: every node with outflow appears on the left, every node with
// inflow on the right (a node may appear on both sides). Returns positioned
// node entries and ribbon slices.
function _sankeyLayout(model, w, h) {
    const outT = new Map();
    const inT = new Map();
    model.links.forEach(l => {
        outT.set(l.s, (outT.get(l.s) || 0) + l.w);
        inT.set(l.t, (inT.get(l.t) || 0) + l.w);
    });
    const order = totals => Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    const left = order(outT);
    const right = order(inT);
    const sum = list => list.reduce((acc, [, v]) => acc + v, 0);
    const gapsFor = list => Math.max(0, list.length - 1) * _OVERVIEW_SANKEY_NODE_GAP;
    const avail = Math.max(120, h - _OVERVIEW_SANKEY_PAD * 2);
    const scale = Math.max(0.0001,
        (avail - Math.max(gapsFor(left), gapsFor(right))) / Math.max(1, sum(left), sum(right)));

    const place = (list, x) => {
        const placed = new Map();
        let y = _OVERVIEW_SANKEY_PAD;
        list.forEach(([id, total]) => {
            const nodeH = Math.max(_OVERVIEW_SANKEY_MIN_NODE_H, total * scale);
            placed.set(id, { id, x, y, h: nodeH, total, used: 0 });
            y += nodeH + _OVERVIEW_SANKEY_NODE_GAP;
        });
        return { placed, bottom: y };
    };
    const x0 = _OVERVIEW_SANKEY_PAD + _OVERVIEW_SANKEY_LABEL_W;
    const x1 = Math.max(x0 + 120, w - _OVERVIEW_SANKEY_PAD - _OVERVIEW_SANKEY_LABEL_W - _OVERVIEW_SANKEY_NODE_W);
    const L = place(left, x0);
    const R = place(right, x1);

    // Ribbon slices: order each node's links by the opposite end's position so
    // ribbons fan out without crossing inside a node.
    const links = model.links.slice().sort((a, b) =>
        (L.placed.get(a.s).y - L.placed.get(b.s).y) || (R.placed.get(a.t).y - R.placed.get(b.t).y));
    const ribbons = links.map(l => {
        const s = L.placed.get(l.s);
        const t = R.placed.get(l.t);
        const sh = (l.w / s.total) * s.h;
        const th = (l.w / t.total) * t.h;
        const r = { s: l.s, t: l.t, w: l.w, sy0: s.y + s.used, ty0: t.y + t.used };
        r.sy1 = r.sy0 + sh;
        r.ty1 = r.ty0 + th;
        s.used += sh;
        t.used += th;
        return r;
    });
    return { left: L.placed, right: R.placed, ribbons, x0, x1, height: Math.max(L.bottom, R.bottom) + _OVERVIEW_SANKEY_PAD };
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function _sankeySvgEl(tag, attrs) {
    const el = document.createElementNS(_OVERVIEW_SANKEY_SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
}

function _sankeyTooltip(html, color, event) {
    const { container } = _overviewEnsureHosts();
    if (!container) return;
    if (!_gTooltipEl) {
        _gTooltipEl = document.createElement('div');
        _gTooltipEl.className = 'galaxy-tooltip';
        container.appendChild(_gTooltipEl);
    }
    _gTooltipEl.innerHTML = html;
    _gTooltipEl.style.display = 'block';
    _gTooltipEl.style.borderColor = color;
    const bounds = container.getBoundingClientRect();
    const pad = 10;
    const width = _gTooltipEl.offsetWidth || 0;
    const height = _gTooltipEl.offsetHeight || 0;
    const lx = Math.min(Math.max(event.clientX - bounds.left + 14, pad), Math.max(pad, container.clientWidth - width - pad));
    const ty = Math.min(Math.max(event.clientY - bounds.top + 14, pad), Math.max(pad, container.clientHeight - height - pad));
    _gTooltipEl.style.left = `${lx}px`;
    _gTooltipEl.style.top = `${ty}px`;
}

function _sankeyNodeTooltip(meta, entry, side, model, event) {
    const flow = T(side === 'left' ? 'sankeyOutflow' : 'sankeyInflow', { n: entry.total, unit: model.unit });
    _sankeyTooltip(
        `<div class="gt-name" style="color:${meta.gray ? 'var(--text)' : meta.color}">${_gEsc(meta.label)}</div>` +
        `<div class="gt-loc">${_gEsc(meta.title || '')}</div>` +
        `<div class="gt-degree">${_gEsc(flow)}</div>`,
        meta.color, event);
}

function _sankeyRibbonTooltip(r, model, event) {
    const sMeta = model.nodes.get(r.s);
    const tMeta = model.nodes.get(r.t);
    _sankeyTooltip(
        `<div class="gt-name">${_gEsc(sMeta?.label || r.s)} → ${_gEsc(tMeta?.label || r.t)}</div>` +
        `<div class="gt-degree">${r.w} ${_gEsc(model.unit)}</div>`,
        sMeta?.color || _OVERVIEW_SANKEY_GRAY, event);
}

function _sankeyRenderNodes(svg, placed, side, model) {
    placed.forEach(entry => {
        const meta = model.nodes.get(entry.id) || { label: entry.id, color: _OVERVIEW_SANKEY_GRAY };
        const g = _sankeySvgEl('g', { class: `overview-sankey-node${meta.drill ? ' drillable' : ''}${meta.gray ? ' gray' : ''}` });
        g.appendChild(_sankeySvgEl('rect', {
            x: entry.x, y: entry.y, width: _OVERVIEW_SANKEY_NODE_W, height: entry.h,
            rx: 2, fill: meta.color,
        }));
        const label = _sankeySvgEl('text', {
            x: side === 'left' ? entry.x - 8 : entry.x + _OVERVIEW_SANKEY_NODE_W + 8,
            y: entry.y + entry.h / 2,
            'text-anchor': side === 'left' ? 'end' : 'start',
            'dominant-baseline': 'central',
            class: 'overview-sankey-label',
        });
        const text = String(meta.label || '');
        label.textContent = text.length > 26 ? `${text.slice(0, 25)}…` : text;
        g.appendChild(label);
        g.addEventListener('mouseenter', e => _sankeyNodeTooltip(meta, entry, side, model, e));
        g.addEventListener('mousemove', e => _sankeyNodeTooltip(meta, entry, side, model, e));
        g.addEventListener('mouseleave', _galaxyHideTooltip);
        if (meta.drill) {
            g.addEventListener('click', () => {
                _galaxyHideTooltip();
                _overviewSankeyStack.push(meta.drill);
                _overviewRenderSankey();
            });
        }
        svg.appendChild(g);
    });
}

function _sankeyRenderRibbons(svg, layout, model) {
    const sx = layout.x0 + _OVERVIEW_SANKEY_NODE_W;
    const mx = (sx + layout.x1) / 2;
    layout.ribbons.forEach(r => {
        const sMeta = model.nodes.get(r.s);
        const d = `M ${sx} ${r.sy0} C ${mx} ${r.sy0}, ${mx} ${r.ty0}, ${layout.x1} ${r.ty0}` +
                  ` L ${layout.x1} ${r.ty1} C ${mx} ${r.ty1}, ${mx} ${r.sy1}, ${sx} ${r.sy1} Z`;
        const path = _sankeySvgEl('path', {
            d, fill: sMeta?.color || _OVERVIEW_SANKEY_GRAY, class: 'overview-sankey-ribbon',
        });
        path.addEventListener('mouseenter', e => _sankeyRibbonTooltip(r, model, e));
        path.addEventListener('mousemove', e => _sankeyRibbonTooltip(r, model, e));
        path.addEventListener('mouseleave', _galaxyHideTooltip);
        svg.appendChild(path);
    });
}

function _sankeyRenderHeader(host) {
    const header = document.createElement('div');
    header.className = 'overview-sankey-header';
    if (_overviewSankeyStack.length > 1) {
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'overview-sankey-back';
        back.textContent = `← ${T('sankeyBack')}`;
        back.addEventListener('click', () => {
            _galaxyHideTooltip();
            _overviewSankeyStack.pop();
            _overviewRenderSankey();
        });
        header.appendChild(back);
    }
    const crumb = document.createElement('span');
    crumb.className = 'overview-sankey-crumb';
    crumb.textContent = _overviewSankeyStack.map(_sankeyFrameTitle).join('  ›  ');
    header.appendChild(crumb);
    host.appendChild(header);
    return header;
}

function _overviewRenderSankey() {
    const host = document.getElementById('overview-sankey-host');
    if (!host || _overviewMode !== 'sankey') return;
    host.innerHTML = '';
    _sankeyRenderHeader(host);
    const body = document.createElement('div');
    body.className = 'overview-sankey-body';
    host.appendChild(body);

    const frame = _overviewSankeyStack[_overviewSankeyStack.length - 1];
    const model = _sankeyBuildModel(frame);
    if (!model.links.length) {
        const empty = document.createElement('div');
        empty.className = 'overview-sankey-empty';
        empty.textContent = T('sankeyNoFlows');
        body.appendChild(empty);
        return;
    }
    const w = Math.max(420, body.clientWidth || host.clientWidth || 800);
    const h = Math.max(220, body.clientHeight || 480);
    const layout = _sankeyLayout(model, w, h);
    const svgH = Math.max(h, layout.height);
    const svg = _sankeySvgEl('svg', {
        width: w, height: svgH, viewBox: `0 0 ${w} ${svgH}`, class: 'overview-sankey-svg',
    });
    _sankeyRenderRibbons(svg, layout, model);
    _sankeyRenderNodes(svg, layout.left, 'left', model);
    _sankeyRenderNodes(svg, layout.right, 'right', model);
    body.appendChild(svg);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
function _overviewSankeyDisableFilterPanel() {
    const wrap = document.getElementById('sb-body-filters');
    if (wrap && _gFilterPanelSaved === null) _gFilterPanelSaved = wrap.innerHTML;
    if (wrap) {
        wrap.innerHTML = '<div id="filters-title" data-i18n="filters">Filters</div><div class="ft-filter-placeholder">Sankey uses Explorer and Search for file selection.</div>';
    }
    if (typeof _sbActiveTab !== 'undefined' && _sbActiveTab === 'filters') {
        _sbActiveTab = 'explorer';
        if (typeof _applySidebarTab === 'function') _applySidebarTab();
    }
    if (typeof updateFilterTabEnabled === 'function') updateFilterTabEnabled();
}

function _overviewSankeyInstallResize() {
    const host = document.getElementById('overview-sankey-host');
    if (!host || _overviewSankeyResizeObserver || typeof ResizeObserver !== 'function') return;
    _overviewSankeyResizeObserver = new ResizeObserver(() => {
        if (_overviewMode !== 'sankey') return;
        clearTimeout(_overviewSankeyResizeTimer);
        _overviewSankeyResizeTimer = setTimeout(_overviewRenderSankey, 80);
    });
    _overviewSankeyResizeObserver.observe(host);
}

function _overviewSankeyDestroy() {
    clearTimeout(_overviewSankeyResizeTimer);
    _overviewSankeyResizeTimer = null;
    if (_overviewSankeyResizeObserver) {
        try { _overviewSankeyResizeObserver.disconnect(); } catch (_) {}
        _overviewSankeyResizeObserver = null;
    }
    _overviewSankeyStack = [{ level: 'module' }];
    const host = document.getElementById('overview-sankey-host');
    if (host) host.innerHTML = '';
}

window.overviewSankeyOpen = function () {
    _overviewSankeyDisableFilterPanel();
    _overviewSankeyInstallResize();
    requestAnimationFrame(_overviewRenderSankey);
};

window.overviewSankeyClose = function () {
    _galaxyHideTooltip();
};

window.overviewSankeyDestroy = _overviewSankeyDestroy;

window.isOverviewSankeyActive = function () {
    return !!state?.galaxyActive && _overviewMode === 'sankey';
};
