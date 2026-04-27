// ── Symbol View — Graph renderer (V3: dagre LR flow graph + focus fade) ─
// Single unified view per file: all classes/functions/methods are laid out
// by dagre. Clicking a node focuses it (scales up, shows rich detail card);
// 1-hop neighbors stay vivid; 2-hop+ nodes fade to communicate scope without
// hiding context.

'use strict';

// ── Layout constants ──────────────────────────────────────────────────────
const _SV_CLASS_PAD_X   = 16;
const _SV_CLASS_PAD_TOP = 38;
const _SV_CLASS_PAD_BOT = 14;
const _SV_CLASS_MIN_W   = 232;
const _SV_CLASS_MAX_W   = 420;
const _SV_METHOD_W      = 200;
const _SV_METHOD_MAX_W  = 320;
const _SV_METHOD_H      = 34;
const _SV_METHOD_GAP    = 6;
const _SV_FUNC_W        = 220;
const _SV_FUNC_MAX_W    = 340;
const _SV_FUNC_H        = 42;
const _SV_FIELD_W       = 180;
const _SV_FIELD_MAX_W   = 300;
const _SV_FIELD_H       = 28;
const _SV_GHOST_W       = 220;
const _SV_GHOST_MAX_W   = 360;
const _SV_GHOST_H       = 52;

const _SV_FOCUS_SIG_H   = 36;   // detail row heights (each collapsible)
const _SV_FOCUS_DOC_H   = 46;
const _SV_FOCUS_MET_H   = 28;

const _SV_LAYOUT_NODESEP = 42;
const _SV_LAYOUT_RANKSEP = 128;
const _SV_LAYOUT_MARGIN  = 56;
const _SV_COLLISION_PAD  = 24;

const _SV_DETAIL_GAP      = 24;
const _SV_DETAIL_MIN_W    = 280;
const _SV_DETAIL_MAX_W    = 420;
const _SV_DETAIL_MIN_H    = 170;
const _SV_DETAIL_MAX_H    = 420;
const _SV_DETAIL_VIEW_PAD = 18;

const _SV_CH_W = 7.1;

function _svMeasureText(s, fontSize = 13) {
    const w = String(s || '').length * (_SV_CH_W * (fontSize / 13));
    return Math.ceil(w);
}

function _svClamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function _svMeasureMethodWidth(sym) {
    const accessW = sym && sym.is_public === false ? 48 : 44;
    const raw = _svMeasureText(sym && sym.name, 13) + accessW + 44;
    return _svClamp(raw, _SV_METHOD_W, _SV_METHOD_MAX_W);
}

function _svMeasureTopLevelWidth(sym, isField) {
    const min = isField ? _SV_FIELD_W : _SV_FUNC_W;
    const max = isField ? _SV_FIELD_MAX_W : _SV_FUNC_MAX_W;
    const badgeW = isField ? 50 : 58;
    const raw = _svMeasureText(sym && sym.name, 13) + badgeW + 40;
    return _svClamp(raw, min, max);
}

function _svMeasureGhostWidth(sym) {
    const nameW = _svMeasureText(sym && sym.name, 14) + 34;
    const path = (sym && sym.file ? sym.file : '') + (sym && sym.line ? ':' + sym.line : '');
    const pathW = _svMeasureText(path, 10) + 92;
    return _svClamp(Math.max(nameW, pathW), _SV_GHOST_W, _SV_GHOST_MAX_W);
}

function _svEstimateDetailCardHeight(sym, collapsed) {
    let height = 96;
    if (sym && sym.signature) height += collapsed.has('signature') ? 30 : _SV_FOCUS_SIG_H;
    if (sym && sym.docstring) height += collapsed.has('docstring') ? 30 : _SV_FOCUS_DOC_H;
    height += collapsed.has('metrics') ? 30 : (_SV_FOCUS_MET_H + 12);
    return _svClamp(height, _SV_DETAIL_MIN_H, _SV_DETAIL_MAX_H);
}

function _svVisibleWorldBounds() {
    const svg = _svState.svg;
    const zoom = _svState.zoom;
    if (!svg || !zoom || !zoom.k) {
        return { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    }
    const rect = svg.getBoundingClientRect();
    return {
        left:   (-zoom.x) / zoom.k,
        top:    (-zoom.y) / zoom.k,
        right:  (rect.width - zoom.x) / zoom.k,
        bottom: (rect.height - zoom.y) / zoom.k,
    };
}

function _svRectsOverlap(a, b, pad = 0) {
    return !(
        a.x + a.w + pad <= b.x ||
        b.x + b.w + pad <= a.x ||
        a.y + a.h + pad <= b.y ||
        b.y + b.h + pad <= a.y
    );
}

function _svRectOverlapArea(a, b) {
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (right <= left || bottom <= top) return 0;
    return (right - left) * (bottom - top);
}

function _svResolveRootOverlaps(items) {
    const ordered = items
        .map(item => ({ ...item }))
        .sort((a, b) => (a.x - b.x) || (a.y - b.y));
    const offsets = new Map();

    for (const item of ordered) {
        for (const id of item.shiftIds) offsets.set(id, { dx: 0, dy: 0 });
    }

    for (let pass = 0; pass < 6; pass++) {
        let moved = false;
        for (let i = 0; i < ordered.length; i++) {
            for (let j = i + 1; j < ordered.length; j++) {
                const a = ordered[i];
                const b = ordered[j];
                if (!_svRectsOverlap(a, b, _SV_COLLISION_PAD)) continue;
                const shiftY = (a.y + a.h + _SV_COLLISION_PAD) - b.y;
                if (shiftY <= 0) continue;
                b.y += shiftY;
                for (const id of b.shiftIds) {
                    const prior = offsets.get(id) || { dx: 0, dy: 0 };
                    offsets.set(id, { dx: prior.dx, dy: prior.dy + shiftY });
                }
                moved = true;
            }
        }
        if (!moved) break;
    }

    return offsets;
}

function _svGetCardPlacement(node, model, cardW, cardH) {
    const bounds = _svVisibleWorldBounds();
    const minX = Number.isFinite(bounds.left) ? bounds.left + _SV_DETAIL_VIEW_PAD : -Infinity;
    const maxX = Number.isFinite(bounds.right) ? bounds.right - cardW - _SV_DETAIL_VIEW_PAD : Infinity;
    const minY = Number.isFinite(bounds.top) ? bounds.top + _SV_DETAIL_VIEW_PAD : -Infinity;
    const maxY = Number.isFinite(bounds.bottom) ? bounds.bottom - cardH - _SV_DETAIL_VIEW_PAD : Infinity;

    const xCandidates = [
        node.x + node.w + _SV_DETAIL_GAP,
        node.x - cardW - _SV_DETAIL_GAP,
    ].map(x => _svClamp(x, minX, maxX));

    const yCandidates = [
        node.y - 10,
        node.y + node.h - cardH,
        node.y + (node.h - cardH) / 2,
    ].map(y => _svClamp(y, minY, maxY));

    let best = { x: xCandidates[0], y: yCandidates[0], overlaps: Infinity, area: Infinity, dist: Infinity };
    for (const x of xCandidates) {
        for (const y of yCandidates) {
            const rect = { x, y, w: cardW, h: cardH };
            let overlaps = 0;
            let area = 0;
            for (const other of model.nodes) {
                if (!other || other.id === node.id) continue;
                const otherRect = { x: other.x, y: other.y, w: other.w, h: other.h };
                if (_svRectsOverlap(rect, otherRect, 16)) {
                    overlaps += 1;
                    area += _svRectOverlapArea(rect, otherRect);
                }
            }
            const dist = Math.abs((node.y + node.h / 2) - (y + cardH / 2));
            if (
                overlaps < best.overlaps ||
                (overlaps === best.overlaps && area < best.area) ||
                (overlaps === best.overlaps && area === best.area && dist < best.dist)
            ) {
                best = { x, y, overlaps, area, dist };
            }
        }
    }
    return { x: best.x, y: best.y };
}

// ── Entry: load a file's graph ────────────────────────────────────────────
// opts.pendingFocus — focus this symbol as soon as the graph lands.
async function _svLoadFileGraph(fileRel, opts) {
    const svg   = _svState.svg;
    const empty = document.getElementById('sv-empty');
    if (!svg) return;
    svg.style.display = '';
    if (empty) empty.hidden = true;

    const jid = _svState.jobId || window.JOB_ID;
    if (!jid) return;

    _svShowLoading(true);
    try {
        const url  = `/symbol-file?job=${encodeURIComponent(jid)}&file=${encodeURIComponent(fileRel)}&include_external=1`;
        const resp = await fetch(url);
        const data = await resp.json();
        if (!data || !Array.isArray(data.symbols)) {
            if (empty) empty.hidden = false;
            return;
        }
        _svState.currentData = data;
        const baseModel = _svBuildFileGraphModel(data, fileRel);
        baseModel.fileRel = fileRel;
        _svUpdateBreadcrumbFile(fileRel, baseModel);

        if (opts && opts.pendingFocus && baseModel.byNodeId[opts.pendingFocus]) {
            _svState.focusId = opts.pendingFocus;
            const fNode = baseModel.byNodeId[opts.pendingFocus];
            const fSym  = fNode.sym || {};
            const cardW = _svClamp(Math.max(fNode.w + 52, 260), _SV_DETAIL_MIN_W, _SV_DETAIL_MAX_W);
            const cardH = _svEstimateDetailCardHeight(fSym, _svState.detailSectionCollapsed);
            const focusModel = _svBuildFileGraphModel(data, fileRel, { focusId: opts.pendingFocus, cardW, cardH });
            focusModel.fileRel = fileRel;
            _svUpdateBreadcrumbFile(fileRel, focusModel);
            _svRenderFileGraph(focusModel);
        } else {
            _svState.focusId = null;
            _svRenderFileGraph(baseModel);
        }
    } catch (err) {
        if (empty) {
            empty.hidden = false;
            const msg = empty.querySelector('.sv-empty-msg');
            if (msg) msg.textContent = 'Failed to load file graph';
        }
    } finally {
        _svShowLoading(false);
    }
}

// Rebuild the file graph with (or without) a focus card and re-render.
// Called whenever focusId changes within the same file.
function _svRebuildForFocus() {
    const focusId = _svState.focusId;
    const data    = _svState.currentData;
    const fileRel = _svState.fileRel;
    if (!data || !fileRel) { _svApplyFocus(); return; }

    let focusOpts = null;
    if (focusId) {
        const curModel = _svState.currentGraph;
        const curNode  = curModel && curModel.byNodeId[focusId];
        const sym  = curNode ? (curNode.sym || {}) : {};
        const refW = curNode ? curNode.w : 200;
        const cardW = _svClamp(Math.max(refW + 52, 260), _SV_DETAIL_MIN_W, _SV_DETAIL_MAX_W);
        const cardH = _svEstimateDetailCardHeight(sym, _svState.detailSectionCollapsed);
        focusOpts = { focusId, cardW, cardH };
    }
    const model = _svBuildFileGraphModel(data, fileRel, focusOpts);
    model.fileRel = fileRel;
    _svUpdateBreadcrumbFile(fileRel, model);
    _svRenderFileGraph(model);
}

function _svShowLoading(on) {
    const brd = document.getElementById('sv-breadcrumb');
    if (!brd) return;
    brd.classList.toggle('sv-loading', !!on);
}

function _svUpdateBreadcrumbFile(fileRel, model) {
    const brd = document.getElementById('sv-breadcrumb');
    if (brd) brd.textContent = fileRel || '';
    const stats = document.getElementById('sv-stats');
    if (stats && model) {
        const n = model.nodes ? model.nodes.length : 0;
        const e = model.edges ? model.edges.length : 0;
        stats.textContent = `${n} symbols · ${e} edges`;
    }
}

// ── Model: classify symbols and run dagre layout ──────────────────────────
function _svBuildFileGraphModel(resp, fileRel, focusOpts) {
    const symbols = resp.symbols || [];
    const edges   = resp.edges || [];
    const extEdges = resp.external_edges || [];
    const extSyms  = resp.external_syms  || {};

    const byId = {};
    for (const s of symbols) byId[s.id] = s;

    // Classify: classes (compound), methods (nested), top-level functions / fields.
    // When focusOpts is provided the focused node is extracted from its category:
    // it becomes a standalone focus-card in topFuncs. If it was a class, its
    // methods lose their parent and also fall into topFuncs as orphaned nodes.
    const classes  = [];
    const methods  = [];
    const topFuncs = [];
    const classById = {};
    const focusSym = focusOpts ? byId[focusOpts.focusId] : null;

    if (focusSym) {
        for (const s of symbols) {
            if (!_SV_CARD_KINDS.has(s.kind) || s.id === focusSym.id) continue;
            classes.push(s);
            classById[s.name] = s;
        }
        for (const s of symbols) {
            if (_SV_CARD_KINDS.has(s.kind)) {
                if (s.id === focusSym.id) topFuncs.push({ ...s, _isFocusCard: true });
                continue;
            }
            if (s.id === focusSym.id) {
                topFuncs.push({ ...s, _isFocusCard: true });
            } else if (s.parent && classById[s.parent]) {
                methods.push({ ...s, _parentId: classById[s.parent].id });
            } else {
                // Orphaned: parent is the focused class → standalone node.
                topFuncs.push(s);
            }
        }
    } else {
        for (const s of symbols) {
            if (_SV_CARD_KINDS.has(s.kind)) {
                classes.push(s);
                classById[s.name] = s;
            }
        }
        for (const s of symbols) {
            if (_SV_CARD_KINDS.has(s.kind)) continue;
            if (s.parent && classById[s.parent]) {
                methods.push({ ...s, _parentId: classById[s.parent].id });
            } else {
                topFuncs.push(s);
            }
        }
    }

    // Default: collapse all classes when first loading a file.
    if (_svState._collapseAllOnLoad) {
        _svState._collapseAllOnLoad = false;
        _svState.compoundCollapsed.clear();
        for (const cls of classes) _svState.compoundCollapsed.add(cls.id);
    }

    // Use dagre for positions. Compound classes contain their methods.
    const g = new dagre.graphlib.Graph({ compound: true });
    g.setGraph({
        rankdir:  'LR',
        nodesep:  _SV_LAYOUT_NODESEP,
        ranksep:  _SV_LAYOUT_RANKSEP,
        marginx:  _SV_LAYOUT_MARGIN,
        marginy:  _SV_LAYOUT_MARGIN,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Compute per-class inner layout first (methods stacked vertically).
    const classDims = {};
    for (const cls of classes) {
        const collapsed = _svState.compoundCollapsed.has(cls.id);
        const clsMethods = methods.filter(m => m._parentId === cls.id);
        const innerW = clsMethods.length
            ? Math.max(_SV_METHOD_W, ...clsMethods.map(m => _svMeasureMethodWidth(m)))
            : _SV_METHOD_W;
        const headerW = _svMeasureText(cls.name, 15) + 96;
        const w = _svClamp(
            Math.max(headerW, innerW + _SV_CLASS_PAD_X * 2),
            _SV_CLASS_MIN_W,
            _SV_CLASS_MAX_W
        );
        let h;
        if (collapsed || !clsMethods.length) {
            h = _SV_CLASS_PAD_TOP + _SV_CLASS_PAD_BOT + (clsMethods.length ? 18 : 0);
        } else {
            h = _SV_CLASS_PAD_TOP
              + clsMethods.length * (_SV_METHOD_H + _SV_METHOD_GAP)
              + _SV_CLASS_PAD_BOT;
        }
        classDims[cls.id] = {
            w,
            h,
            methods: clsMethods,
            collapsed,
            innerW: Math.max(_SV_METHOD_W, w - _SV_CLASS_PAD_X * 2),
        };
    }

    // Add class compound nodes. Dagre compounds: set the compound node with
    // width/height, then setParent(child, compound).
    for (const cls of classes) {
        const d = classDims[cls.id];
        g.setNode(cls.id, { width: d.w, height: d.h });
    }

    // Methods are NOT added to dagre — their positions are computed manually
    // from the parent class compound after dagre.layout(). This avoids dagre
    // compound height mismatch bugs where dagre expands the compound beyond our
    // pre-calculated d.h, causing methods to appear outside the SVG rect.

    // Top-level functions / fields (plus the focus card when in focus mode)
    const topLevelDims = new Map();
    for (const f of topFuncs) {
        let w, h;
        if (f._isFocusCard) {
            w = focusOpts.cardW;
            h = focusOpts.cardH;
        } else {
            const isField = f.kind === 'field' || f.kind === 'variable' || f.kind === 'constant' || f.kind === 'property';
            w = _svMeasureTopLevelWidth(f, isField);
            h = isField ? _SV_FIELD_H : _SV_FUNC_H;
        }
        topLevelDims.set(f.id, { w, h, isFocusCard: !!f._isFocusCard });
        g.setNode(f.id, { width: w, height: h });
    }

    // Ghost nodes for external endpoints (one per foreign symbol referenced).
    const ghostIds = [];
    const ghostDims = new Map();
    if (_svState.showExternal) {
        for (const gid of Object.keys(extSyms)) {
            if (byId[gid]) continue;  // skip if it somehow sits inside file_syms
            const gs = extSyms[gid];
            byId[gid] = { ...gs, _ghost: true };
            const w = _svMeasureGhostWidth(gs);
            ghostDims.set(gid, { w, h: _SV_GHOST_H });
            g.setNode(gid, { width: w, height: _SV_GHOST_H });
            ghostIds.push(gid);
        }
    }

    // Intra-file edges.
    // SVG endpoints: redirect only COLLAPSED methods → parent class.
    // Dagre endpoints: redirect ALL methods → parent class (methods aren't in dagre).
    const modelEdges = [];
    for (const e of edges) {
        const fromId = _svRedirectIfCollapsed(e.from, methods, classDims);
        const toId   = _svRedirectIfCollapsed(e.to,   methods, classDims);
        if (fromId === toId) continue;
        const dagreFrom = _svToCompoundId(fromId, methods, classDims);
        const dagreTo   = _svToCompoundId(toId,   methods, classDims);
        if (!g.hasNode(dagreFrom) || !g.hasNode(dagreTo)) continue;
        if (dagreFrom !== dagreTo) g.setEdge(dagreFrom, dagreTo);
        const id = `e|${fromId}|${toId}|${e.type}`;
        modelEdges.push({
            id, from: fromId, to: toId, type: e.type,
            origFrom: e.from, origTo: e.to, external: false,
        });
    }

    // External edges — cross-file.
    if (_svState.showExternal) {
        for (const e of extEdges) {
            const fromId = byId[e.from] ? _svRedirectIfCollapsed(e.from, methods, classDims) : e.from;
            const toId   = byId[e.to]   ? _svRedirectIfCollapsed(e.to,   methods, classDims) : e.to;
            const dagreFrom = byId[fromId] ? _svToCompoundId(fromId, methods, classDims) : fromId;
            const dagreTo   = byId[toId]   ? _svToCompoundId(toId,   methods, classDims) : toId;
            if (!g.hasNode(dagreFrom) || !g.hasNode(dagreTo)) continue;
            if (dagreFrom !== dagreTo) g.setEdge(dagreFrom, dagreTo);
            const id = `e|${fromId}|${toId}|${e.type}|ext`;
            modelEdges.push({
                id, from: fromId, to: toId, type: e.type,
                origFrom: e.from, origTo: e.to, external: true,
            });
        }
    }

    dagre.layout(g);

    const rootOffsets = _svResolveRootOverlaps([
        ...classes.map(cls => {
            const info = g.node(cls.id);
            const dim = classDims[cls.id];
            return {
                id: cls.id,
                x: info.x - dim.w / 2,
                y: info.y - dim.h / 2,
                w: dim.w,
                h: dim.h,
                shiftIds: [cls.id],  // methods derive positions from class; no separate entry
            };
        }),
        ...topFuncs.map(f => {
            const info = g.node(f.id);
            const dim = topLevelDims.get(f.id);
            return {
                id: f.id,
                x: info.x - dim.w / 2,
                y: info.y - dim.h / 2,
                w: dim.w,
                h: dim.h,
                shiftIds: [f.id],
            };
        }),
        ...ghostIds.map(gid => {
            const info = g.node(gid);
            const dim = ghostDims.get(gid);
            return {
                id: gid,
                x: info.x - dim.w / 2,
                y: info.y - dim.h / 2,
                w: dim.w,
                h: dim.h,
                shiftIds: [gid],
            };
        }),
    ]);

    // Compute method positions manually from each class compound's final position.
    // This guarantees methods always sit exactly within the class SVG rect,
    // independent of dagre's compound height algorithm.
    const methodPos = new Map();
    for (const cls of classes) {
        const d = classDims[cls.id];
        if (d.collapsed || !d.methods.length) continue;
        const info = g.node(cls.id);
        const clsOff = rootOffsets.get(cls.id) || { dx: 0, dy: 0 };
        const clsX = info.x - d.w / 2 + clsOff.dx;
        const clsY = info.y - d.h / 2 + clsOff.dy;
        d.methods.forEach((m, idx) => {
            methodPos.set(m.id, {
                x: clsX + (d.w - d.innerW) / 2,
                y: clsY + _SV_CLASS_PAD_TOP + idx * (_SV_METHOD_H + _SV_METHOD_GAP),
                w: d.innerW,
                h: _SV_METHOD_H,
            });
        });
    }

    // Collect node records with positions.
    const nodes = [];

    for (const cls of classes) {
        const info = g.node(cls.id);
        const d    = classDims[cls.id];
        const offset = rootOffsets.get(cls.id) || { dx: 0, dy: 0 };
        nodes.push({
            id:          cls.id,
            sym:         cls,
            kind:        cls.kind,
            isCompound:  true,
            collapsed:   d.collapsed,
            methods:     d.methods,
            x:           info.x - d.w / 2 + offset.dx,
            y:           info.y - d.h / 2 + offset.dy,
            w:           d.w,
            h:           d.h,
            cx:          info.x + offset.dx,
            cy:          info.y + offset.dy,
        });
    }
    for (const m of methods) {
        const parentDim = classDims[m._parentId];
        if (!parentDim || parentDim.collapsed) continue;
        const pos = methodPos.get(m.id);
        if (!pos) continue;
        nodes.push({
            id:       m.id,
            sym:      m,
            kind:     m.kind,
            isMethod: true,
            parentId: m._parentId,
            x:        pos.x,
            y:        pos.y,
            w:        pos.w,
            h:        pos.h,
            cx:       pos.x + pos.w / 2,
            cy:       pos.y + pos.h / 2,
        });
    }
    for (const f of topFuncs) {
        const info = g.node(f.id);
        const dim = topLevelDims.get(f.id);
        const isFocusCard = !!(dim && dim.isFocusCard);
        const isField = !isFocusCard && !!dim && dim.h === _SV_FIELD_H;
        const w = dim ? dim.w : (isField ? _SV_FIELD_W : _SV_FUNC_W);
        const h = dim ? dim.h : (isField ? _SV_FIELD_H : _SV_FUNC_H);
        const offset = rootOffsets.get(f.id) || { dx: 0, dy: 0 };
        nodes.push({
            id:          f.id,
            sym:         f,
            kind:        f.kind,
            isTopLevel:  !isFocusCard,
            isField:     isField,
            isFocusCard: isFocusCard,
            x:           info.x - w / 2 + offset.dx,
            y:           info.y - h / 2 + offset.dy,
            w, h,
            cx:          info.x + offset.dx,
            cy:          info.y + offset.dy,
        });
    }
    for (const gid of ghostIds) {
        const info = g.node(gid);
        const dim = ghostDims.get(gid) || { w: _SV_GHOST_W, h: _SV_GHOST_H };
        const offset = rootOffsets.get(gid) || { dx: 0, dy: 0 };
        nodes.push({
            id:       gid,
            sym:      byId[gid],
            kind:     byId[gid].kind || 'class',
            isGhost:  true,
            x:        info.x - dim.w / 2 + offset.dx,
            y:        info.y - dim.h / 2 + offset.dy,
            w:        dim.w,
            h:        dim.h,
            cx:       info.x + offset.dx,
            cy:       info.y + offset.dy,
        });
    }

    // Adjacency map for 1-hop focus scope.
    const adj = new Map();
    for (const e of modelEdges) {
        if (!adj.has(e.from)) adj.set(e.from, new Set());
        if (!adj.has(e.to))   adj.set(e.to,   new Set());
        adj.get(e.from).add(e.to);
        adj.get(e.to).add(e.from);
        // Methods also count as 1-hop from their class compound when focus is
        // the class, so mirror that relation.
        if (e.origFrom && e.origFrom !== e.from) {
            if (!adj.has(e.origFrom)) adj.set(e.origFrom, new Set());
            adj.get(e.origFrom).add(e.to);
            adj.get(e.to).add(e.origFrom);
        }
        if (e.origTo && e.origTo !== e.to) {
            if (!adj.has(e.origTo)) adj.set(e.origTo, new Set());
            adj.get(e.origTo).add(e.from);
            adj.get(e.from).add(e.origTo);
        }
    }
    // Parent-child adjacency (class ↔ its methods).
    for (const m of methods) {
        if (!adj.has(m._parentId)) adj.set(m._parentId, new Set());
        if (!adj.has(m.id))        adj.set(m.id, new Set());
        adj.get(m._parentId).add(m.id);
        adj.get(m.id).add(m._parentId);
    }

    const byNodeId = {};
    for (const n of nodes) byNodeId[n.id] = n;

    // Focus-mode: ensure the focus card is adjacent to its parent class (method)
    // or to its orphaned methods (class), for BFS scope rendering.
    if (focusSym) {
        if (!adj.has(focusSym.id)) adj.set(focusSym.id, new Set());
        if (focusSym.parent && classById[focusSym.parent]) {
            const parentId = classById[focusSym.parent].id;
            if (!adj.has(parentId)) adj.set(parentId, new Set());
            adj.get(focusSym.id).add(parentId);
            adj.get(parentId).add(focusSym.id);
        } else if (_SV_CARD_KINDS.has(focusSym.kind)) {
            for (const f of topFuncs) {
                if (!f._isFocusCard && f.parent === focusSym.name) {
                    if (!adj.has(f.id)) adj.set(f.id, new Set());
                    adj.get(focusSym.id).add(f.id);
                    adj.get(f.id).add(focusSym.id);
                }
            }
        }
    }

    return {
        fileRel,
        nodes,
        edges:       modelEdges,
        byId,
        byNodeId,
        adj,
        extSyms,
        hasFocusCard: !!(focusSym),
        focusNodeId:  focusSym ? focusSym.id : null,
    };
}

function _svRedirectIfCollapsed(symId, methods, classDims) {
    const m = methods.find(x => x.id === symId);
    if (!m) return symId;
    const dim = classDims[m._parentId];
    if (dim && dim.collapsed) return m._parentId;
    return symId;
}

// Always redirect a method id → its parent class id (used for dagre edge routing,
// since method nodes aren't added to dagre; only class compound nodes are).
function _svToCompoundId(symId, methods, classDims) {
    const m = methods.find(x => x.id === symId);
    return (m && classDims[m._parentId]) ? m._parentId : symId;
}

// ── Render + animate ──────────────────────────────────────────────────────
let _svCurRenderModel = null;  // set at start of each _svRenderFileGraph call

function _svRenderFileGraph(newModel) {
    const svg      = _svState.svg;
    const viewport = _svState.viewport;
    if (!svg || !viewport) return;

    _svCurRenderModel = newModel;
    svg.style.display = '';

    const cardsG  = viewport.querySelector('.sv-cards');
    const edgesG  = viewport.querySelector('.sv-edges');
    const labelsG = viewport.querySelector('.sv-edge-labels');
    const ghostsG = viewport.querySelector('.sv-ghosts');
    if (!cardsG || !edgesG || !ghostsG) return;

    // Remove any residual floating focus card from the old overlay approach.
    const oldFocusCard = viewport.querySelector('.sv-focus-detail');
    if (oldFocusCard) oldFocusCard.remove();

    // Detect file change before camera or DOM work.
    const prev = _svState.currentGraph;
    const sameFile = prev && prev.fileRel === newModel.fileRel;
    if (!sameFile) {
        cardsG.innerHTML  = '';
        ghostsG.innerHTML = '';
        _svState.currentGraph = null;
        _svFitViewport(newModel);           // new file → snap camera immediately
    } else {
        // Same file (focus / unfocus / re-layout) → smoothly animate camera.
        _svAnimateValue(_svState.zoom, _svComputeTargetZoom(newModel), _SV_DUR_MS, _svApplyZoom);
    }

    const oldById = new Map();
    if (sameFile && prev) {
        for (const n of prev.nodes) oldById.set(n.id, n);
    }

    // Diff nodes: create / update / fade-out.
    const live = new Map();
    for (const n of newModel.nodes) {
        const was = oldById.get(n.id);
        if (was && was.el) {
            const wasFocusCard = !!was.isFocusCard;
            const nowFocusCard = !!n.isFocusCard;
            const needRebuild = (was.isCompound !== !!n.isCompound)
                || (n.isCompound && was.collapsed !== n.collapsed)
                || (was.sym && n.sym && was.sym.name !== n.sym.name)
                || (wasFocusCard !== nowFocusCard)
                || (n.isCompound && was.methods && n.methods && was.methods.length !== n.methods.length);
            let w0 = was.w, h0 = was.h;
            let el = was.el;
            if (needRebuild) {
                const fresh = _svCreateNodeEl(n);
                // Start focus card foreignObject at old (small) node size so it grows.
                if (nowFocusCard) {
                    const fo = fresh.querySelector('.sv-focus-card-fo');
                    if (fo) {
                        fo.setAttribute('width',  String(was.w));
                        fo.setAttribute('height', String(was.h));
                    }
                }
                el.replaceWith(fresh);
                el = fresh;
            } else {
                el.setAttribute('class', _svNodeClass(n));
            }
            live.set(n.id, {
                x0: was.x, y0: was.y, x1: n.x, y1: n.y,
                w0, h0, w1: n.w, h1: n.h,
                w: n.w, h: n.h,
                fadeIn: false, el, data: n,
            });
        } else {
            const el = _svCreateNodeEl(n);
            const targetG = n.isGhost ? ghostsG : cardsG;
            targetG.appendChild(el);
            el.style.opacity = '0';
            live.set(n.id, {
                x0: n.x, y0: n.y, x1: n.x, y1: n.y,
                w0: n.w, h0: n.h, w1: n.w, h1: n.h,
                w: n.w, h: n.h,
                fadeIn: true, el, data: n,
            });
        }
    }

    const exits = [];
    if (prev) {
        const newIds = new Set(newModel.nodes.map(n => n.id));
        for (const o of prev.nodes) {
            if (!newIds.has(o.id) && o.el) {
                exits.push({ el: o.el, startOpacity: parseFloat(o.el.style.opacity) || 1 });
            }
        }
    }

    // Clear stale edges immediately — must not appear during card animation.
    edgesG.innerHTML  = '';
    labelsG.innerHTML = '';

    const DUR = _SV_DUR_MS;
    const t0  = performance.now();
    function frame(now) {
        const t = Math.min(1, (now - t0) / DUR);
        const e = _svEase(t);
        for (const [, L] of live) {
            const x = L.x0 + (L.x1 - L.x0) * e;
            const y = L.y0 + (L.y1 - L.y0) * e;
            L.currentX = x;
            L.currentY = y;
            L.el.setAttribute('transform', `translate(${x},${y})`);
            if (L.fadeIn) L.el.style.opacity = String(e);
            // Animate foreignObject size for focus card morphing.
            if (L.data.isFocusCard && L.w0 !== L.w1) {
                const fw = L.w0 + (L.w1 - L.w0) * e;
                const fh = L.h0 + (L.h1 - L.h0) * e;
                const fo = L.el.querySelector('.sv-focus-card-fo');
                if (fo) {
                    fo.setAttribute('width',  String(fw));
                    fo.setAttribute('height', String(fh));
                }
            }
        }
        for (const X of exits) {
            X.el.style.opacity = String(X.startOpacity * (1 - e));
        }
        if (t < 1) {
            requestAnimationFrame(frame);
        } else {
            for (const X of exits) X.el.remove();
            for (const [, L] of live) {
                L.el.setAttribute('transform', `translate(${L.x1},${L.y1})`);
                L.el.style.opacity = '1';
                L.data.el = L.el;
                // Snap focus card foreignObject to final size.
                if (L.data.isFocusCard) {
                    const fo = L.el.querySelector('.sv-focus-card-fo');
                    if (fo) {
                        fo.setAttribute('width',  String(L.w1));
                        fo.setAttribute('height', String(L.h1));
                    }
                }
            }
            _svState.currentGraph = newModel;
            for (const n of newModel.nodes) {
                const L = live.get(n.id);
                if (L) n.el = L.el;
            }
            _svBindNodeClicks();
            _svApplyFocus({ noHistory: true });

            // Build edges at final, stable positions and fade them in.
            edgesG.innerHTML  = '';
            labelsG.innerHTML = '';
            for (const ed of newModel.edges) {
                const from = live.get(ed.from);
                const to   = live.get(ed.to);
                if (!from || !to) continue;
                _svAppendEdge(edgesG, labelsG, ed, from, to);
            }
            _svApplyFocus({ noHistory: true });
            const EDGE_DUR = 220;
            const edgeT0 = performance.now();
            edgesG.style.opacity  = '0';
            labelsG.style.opacity = '0';
            function edgeFade(eNow) {
                const et = Math.min(1, (eNow - edgeT0) / EDGE_DUR);
                const ee = _svEase(et);
                edgesG.style.opacity  = String(ee);
                labelsG.style.opacity = String(ee);
                if (et < 1) requestAnimationFrame(edgeFade);
                else {
                    edgesG.style.opacity  = '';
                    labelsG.style.opacity = '';
                }
            }
            requestAnimationFrame(edgeFade);
        }
    }
    requestAnimationFrame(frame);
    _svBindNodeClicks();
}

function _svFitViewport(model) {
    const svg = _svState.svg;
    if (!svg || !model || !model.nodes.length) return;
    const rect = svg.getBoundingClientRect();

    let minX =  Infinity, minY =  Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (const n of model.nodes) {
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x + n.w > maxX) maxX = n.x + n.w;
        if (n.y + n.h > maxY) maxY = n.y + n.h;
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const margin = 40;
    const k = Math.min(
        1,
        (rect.width  - margin * 2) / w,
        (rect.height - margin * 2) / h,
    );
    _svState.zoom.k = Math.max(0.15, k);
    _svState.zoom.x = rect.width  / 2 - (minX + w / 2) * _svState.zoom.k;
    _svState.zoom.y = rect.height / 2 - (minY + h / 2) * _svState.zoom.k;
    _svApplyZoom();
}

function _svComputeTargetZoom(model) {
    const svg = _svState.svg;
    if (!svg || !model || !model.nodes.length) return { ..._svState.zoom };
    const rect   = svg.getBoundingClientRect();
    const margin = 64;

    if (model.hasFocusCard && model.focusNodeId) {
        const focusId  = model.focusNodeId;
        const scopeIds = new Set([focusId]);
        const near = model.adj.get(focusId);
        if (near) for (const id of near) scopeIds.add(id);

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of model.nodes) {
            if (!scopeIds.has(n.id)) continue;
            if (n.x < minX) minX = n.x;         if (n.y < minY) minY = n.y;
            if (n.x + n.w > maxX) maxX = n.x + n.w;
            if (n.y + n.h > maxY) maxY = n.y + n.h;
        }
        if (!Number.isFinite(minX)) return _svComputeFitAllZoom(model, rect, margin);
        const k = Math.min(2.5,
            (rect.width  - margin * 2) / Math.max(1, maxX - minX),
            (rect.height - margin * 2) / Math.max(1, maxY - minY)
        );
        return { k,
            x: rect.width  / 2 - ((minX + maxX) / 2) * k,
            y: rect.height / 2 - ((minY + maxY) / 2) * k };
    }
    return _svComputeFitAllZoom(model, rect, margin);
}

function _svComputeFitAllZoom(model, rect, margin) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of model.nodes) {
        if (n.x < minX) minX = n.x;         if (n.y < minY) minY = n.y;
        if (n.x + n.w > maxX) maxX = n.x + n.w;
        if (n.y + n.h > maxY) maxY = n.y + n.h;
    }
    const w = maxX - minX, h = maxY - minY;
    const k = Math.max(0.15, Math.min(1,
        (rect.width  - margin * 2) / Math.max(1, w),
        (rect.height - margin * 2) / Math.max(1, h)
    ));
    return { k, x: rect.width / 2 - (minX + w / 2) * k, y: rect.height / 2 - (minY + h / 2) * k };
}

// ── Focus system ──────────────────────────────────────────────────────────

// BFS hop distances from startId through the adjacency map.
function _svBfsDistances(adj, startId) {
    const dist = new Map([[startId, 0]]);
    const q = [startId];
    while (q.length) {
        const id = q.shift();
        const d = dist.get(id);
        for (const nb of (adj.get(id) || [])) {
            if (!dist.has(nb)) { dist.set(nb, d + 1); q.push(nb); }
        }
    }
    return dist;
}

// Opacity by BFS hop distance: 0/1-hop = full, 2-hop = dim, 3-hop = dimmer, 4+= ghost.
const _SV_OPACITY_BY_DIST = [1, 1, 0.35, 0.18, 0.08];

function _svApplyFocus(_opts) {
    const model = _svState.currentGraph;
    const viewport = _svState.viewport;
    if (!model || !viewport) return;
    const focusId = _svState.focusId;

    let dist = null;
    const inScope = new Set();
    if (focusId) {
        dist = _svBfsDistances(model.adj, focusId);
        for (const [id, d] of dist) {
            if (d <= 1) inScope.add(id);
        }
    }

    // Apply node classes + BFS-based inline opacity.
    for (const n of model.nodes) {
        if (!n.el) continue;
        n.el.classList.remove('sv-focus', 'sv-in-focus-scope', 'sv-faded');
        if (!focusId) {
            n.el.style.opacity = '';  // clear inline → CSS default (1)
            continue;
        }
        if (n.id === focusId) {
            // Focus card IS the visible card — keep fully opaque.
            n.el.style.opacity = '';
            n.el.classList.add('sv-focus');
        } else {
            const d = dist ? dist.get(n.id) : undefined;
            const op = d === undefined
                ? _SV_OPACITY_BY_DIST[4]
                : (_SV_OPACITY_BY_DIST[Math.min(d, 4)] ?? _SV_OPACITY_BY_DIST[4]);
            n.el.style.opacity = String(op);
            if (inScope.has(n.id)) n.el.classList.add('sv-in-focus-scope');
            else n.el.classList.add('sv-faded');
        }
    }

    // Apply edge classes.
    const edgesG = viewport.querySelector('.sv-edges');
    if (edgesG) {
        edgesG.querySelectorAll('path.sv-edge').forEach(p => {
            p.classList.remove('sv-edge-in-scope', 'sv-edge-faded');
            if (!focusId) return;
            const eid = p.dataset.edgeid;
            const ed = model.edges.find(e => e.id === eid);
            if (!ed) return;
            const touchesFocus = (ed.from === focusId) || (ed.to === focusId)
                || (ed.origFrom === focusId) || (ed.origTo === focusId);
            if (touchesFocus) p.classList.add('sv-edge-in-scope');
            else if (inScope.has(ed.from) && inScope.has(ed.to)) p.classList.add('sv-edge-in-scope');
            else p.classList.add('sv-edge-faded');
        });
    }

    _svSyncNavBtns();
}

function _svDocExcerpt(doc) {
    const lines = String(doc || '').trim().split(/\r?\n/).filter(Boolean).slice(0, 2);
    return lines.map(l => `<div>${_svEsc(l)}</div>`).join('');
}

// ── Node creation (SVG) ───────────────────────────────────────────────────
function _svNodeClass(n) {
    const kind = n.kind || 'default';
    const classes = ['sv-node', `sv-kind-${kind}`];
    if (n.isCompound)   classes.push('sv-compound');
    if (n.isMethod)     classes.push('sv-method');
    if (n.isTopLevel)   classes.push('sv-top');
    if (n.isField)      classes.push('sv-field');
    if (n.isGhost)      classes.push('sv-ghost');
    if (n.isFocusCard)  classes.push('sv-focus-card');
    if (n.sym && n.sym.is_static) classes.push('sv-static');
    if (n.sym && Array.isArray(n.sym.decorators) && n.sym.decorators.includes('override')) {
        classes.push('sv-override');
    }
    return classes.join(' ');
}

function _svCreateFocusCardEl(n) {
    const NS  = 'http://www.w3.org/2000/svg';
    const g   = document.createElementNS(NS, 'g');
    g.setAttribute('class', _svNodeClass(n));
    g.dataset.symid = n.id;
    g.setAttribute('transform', `translate(${n.x},${n.y})`);

    const sym     = n.sym || {};
    const focusId = n.id;
    const model   = _svCurRenderModel;

    let callers = 0, callees = 0;
    if (model) {
        for (const e of model.edges) {
            const hits = e.from === focusId || e.origFrom === focusId
                      || e.to   === focusId || e.origTo   === focusId;
            if (!hits) continue;
            if (e.from === focusId || e.origFrom === focusId) callees++;
            else callers++;
        }
    }
    const lineCount = Math.max(1, (sym.end_line || sym.line || 1) - (sym.line || 1) + 1);

    const fo = document.createElementNS(NS, 'foreignObject');
    fo.setAttribute('class', 'sv-focus-card-fo');
    fo.setAttribute('x', '0'); fo.setAttribute('y', '0');
    fo.setAttribute('width',  String(n.w));
    fo.setAttribute('height', String(n.h));

    const collapsed = _svState.detailSectionCollapsed;
    const sigHidden = collapsed.has('signature');
    const docHidden = collapsed.has('docstring');
    const metHidden = collapsed.has('metrics');

    fo.innerHTML = `
      <div xmlns="http://www.w3.org/1999/xhtml" class="sv-fd-card">
        <div class="sv-fd-header">
          <span class="sv-kind-dot" style="background:${_svKindColor(sym.kind)}"></span>
          <span class="sv-fd-name">${_svEsc(sym.name || '')}</span>
          <span class="sv-fd-kind">${_svEsc(sym.kind || '')}</span>
        </div>
        <div class="sv-fd-sub">
          ${_svEsc(sym.file || '')}${sym.line ? ':' + sym.line : ''}
          ${sym.module ? ' · ' + _svEsc(sym.module) : ''}
        </div>
        ${sym.signature ? `
          <div class="sv-fd-section ${sigHidden ? 'sv-fd-collapsed' : ''}" data-section="signature">
            <div class="sv-fd-section-hd" data-section="signature">
              <span class="sv-fd-chev">${sigHidden ? '▸' : '▾'}</span>
              <span class="sv-fd-section-title">signature</span>
            </div>
            <div class="sv-fd-section-body"><code>${_svEsc(sym.signature)}</code></div>
          </div>` : ''}
        ${sym.docstring ? `
          <div class="sv-fd-section ${docHidden ? 'sv-fd-collapsed' : ''}" data-section="docstring">
            <div class="sv-fd-section-hd" data-section="docstring">
              <span class="sv-fd-chev">${docHidden ? '▸' : '▾'}</span>
              <span class="sv-fd-section-title">docstring</span>
            </div>
            <div class="sv-fd-section-body">${_svDocExcerpt(sym.docstring)}</div>
          </div>` : ''}
        <div class="sv-fd-section ${metHidden ? 'sv-fd-collapsed' : ''}" data-section="metrics">
          <div class="sv-fd-section-hd" data-section="metrics">
            <span class="sv-fd-chev">${metHidden ? '▸' : '▾'}</span>
            <span class="sv-fd-section-title">metrics</span>
          </div>
          <div class="sv-fd-section-body">
            <span class="sv-fd-metric">${lineCount} lines</span>
            <span class="sv-fd-metric">↓ ${callers} callers</span>
            <span class="sv-fd-metric">↑ ${callees} callees</span>
          </div>
        </div>
      </div>`;

    fo.querySelectorAll('.sv-fd-section-hd').forEach(hd => {
        hd.addEventListener('click', ev => {
            ev.stopPropagation();
            const key = hd.dataset.section;
            if (!key) return;
            if (_svState.detailSectionCollapsed.has(key)) _svState.detailSectionCollapsed.delete(key);
            else _svState.detailSectionCollapsed.add(key);
            _svRebuildForFocus();
        });
    });

    g.appendChild(fo);
    return g;
}

function _svCreateNodeEl(n) {
    if (n.isFocusCard) return _svCreateFocusCardEl(n);

    const NS = 'http://www.w3.org/2000/svg';
    const g  = document.createElementNS(NS, 'g');
    g.setAttribute('class', _svNodeClass(n));
    g.dataset.symid = n.id;
    g.setAttribute('transform', `translate(${n.x},${n.y})`);

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('class', 'sv-node-bg');
    rect.setAttribute('x', '0'); rect.setAttribute('y', '0');
    rect.setAttribute('width',  String(n.w));
    rect.setAttribute('height', String(n.h));
    rect.setAttribute('rx', n.isField ? '14' : n.isCompound ? '10' : '8');
    if (n.isGhost) {
        // Ghost node backgrounds are nearly transparent in CSS (rgba(...,0.05)),
        // which lets edge lines show through even though sv-ghosts is a higher
        // z-layer. Override fill inline with enough opacity to occlude edges.
        rect.style.fill        = 'var(--sv-ghost-bg, #141e30)';
        rect.style.fillOpacity = '0.92';
        // Capture pointer events even on transparent area (Bug 2: click-through fix).
        rect.setAttribute('pointer-events', 'all');
    }
    g.appendChild(rect);

    // Colored accent bar on the left
    const bar = document.createElementNS(NS, 'rect');
    bar.setAttribute('class', 'sv-node-accent');
    bar.setAttribute('x', '0'); bar.setAttribute('y', '0');
    bar.setAttribute('width', '4'); bar.setAttribute('height', String(n.h));
    bar.setAttribute('fill', _svKindColor(n.kind));
    g.appendChild(bar);

    const sym = n.sym || {};

    if (n.isGhost) {
        const nameEl = document.createElementNS(NS, 'text');
        nameEl.setAttribute('class', 'sv-node-name');
        nameEl.setAttribute('x', '12'); nameEl.setAttribute('y', '20');
        nameEl.textContent = _svClipText(sym.name, n.w - 20);
        g.appendChild(nameEl);

        const sub = document.createElementNS(NS, 'text');
        sub.setAttribute('class', 'sv-ghost-path');
        sub.setAttribute('x', '12'); sub.setAttribute('y', '38');
        sub.textContent = _svClipText((sym.file || '') + (sym.line ? ':' + sym.line : ''), n.w - 20);
        g.appendChild(sub);

        const tag = document.createElementNS(NS, 'text');
        tag.setAttribute('class', 'sv-ghost-tag');
        tag.setAttribute('x', String(n.w - 8)); tag.setAttribute('y', '16');
        tag.setAttribute('text-anchor', 'end');
        tag.textContent = 'EXTERNAL';
        g.appendChild(tag);
    } else if (n.isCompound) {
        // Class header
        const nameEl = document.createElementNS(NS, 'text');
        nameEl.setAttribute('class', 'sv-node-name');
        nameEl.setAttribute('x', '14'); nameEl.setAttribute('y', '22');
        nameEl.textContent = _svClipText(sym.name, n.w - 80);
        g.appendChild(nameEl);

        const kindEl = document.createElementNS(NS, 'text');
        kindEl.setAttribute('class', 'sv-node-kind');
        kindEl.setAttribute('x', String(n.w - 10)); kindEl.setAttribute('y', '20');
        kindEl.setAttribute('text-anchor', 'end');
        kindEl.textContent = (sym.kind || '').toUpperCase();
        g.appendChild(kindEl);

        // Collapse/expand chip for the compound class methods
        if (n.methods && n.methods.length) {
            const chip = document.createElementNS(NS, 'g');
            chip.setAttribute('class', 'sv-compound-toggle');
            chip.setAttribute('transform', `translate(${n.w - 24}, 34)`);
            chip.dataset.classid = n.id;
            const chipBg = document.createElementNS(NS, 'rect');
            chipBg.setAttribute('x', '-18'); chipBg.setAttribute('y', '-9');
            chipBg.setAttribute('width', '32'); chipBg.setAttribute('height', '18');
            chipBg.setAttribute('rx', '9');
            chip.appendChild(chipBg);
            const chipTx = document.createElementNS(NS, 'text');
            chipTx.setAttribute('x', '-2'); chipTx.setAttribute('y', '4');
            chipTx.setAttribute('text-anchor', 'middle');
            chipTx.textContent = n.collapsed
                ? `+${n.methods.length}`
                : `−${n.methods.length}`;
            chip.appendChild(chipTx);
            chip.addEventListener('click', (ev) => {
                ev.stopPropagation();
                _svToggleCompound(n.id);
            });
            g.appendChild(chip);

            if (n.collapsed) {
                const hint = document.createElementNS(NS, 'text');
                hint.setAttribute('class', 'sv-compound-hint');
                hint.setAttribute('x', '14');
                hint.setAttribute('y', String(n.h - 14));
                hint.textContent = `${n.methods.length} members hidden`;
                g.appendChild(hint);
            }
        }
    } else if (n.isMethod) {
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('class', 'sv-node-dot');
        dot.setAttribute('cx', '14'); dot.setAttribute('cy', String(n.h / 2));
        dot.setAttribute('r', '4');
        dot.setAttribute('fill', _svKindColor(n.kind));
        g.appendChild(dot);

        const name = document.createElementNS(NS, 'text');
        name.setAttribute('class', 'sv-node-name sv-mono');
        name.setAttribute('x', '24'); name.setAttribute('y', String(n.h / 2));
        name.setAttribute('dominant-baseline', 'middle');
        name.textContent = _svClipText(sym.name, n.w - 80);
        g.appendChild(name);

        const access = sym.is_public === false ? 'PRIV' : 'PUB';
        const accessEl = document.createElementNS(NS, 'text');
        accessEl.setAttribute('class', `sv-access sv-access-${access.toLowerCase()}`);
        accessEl.setAttribute('x', String(n.w - 10));
        accessEl.setAttribute('y', String(n.h / 2));
        accessEl.setAttribute('dominant-baseline', 'middle');
        accessEl.setAttribute('text-anchor', 'end');
        accessEl.textContent = access;
        g.appendChild(accessEl);
    } else {
        // Top-level function or field
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('class', 'sv-node-dot');
        dot.setAttribute('cx', '14'); dot.setAttribute('cy', String(n.h / 2));
        dot.setAttribute('r', '5');
        dot.setAttribute('fill', _svKindColor(n.kind));
        g.appendChild(dot);

        const name = document.createElementNS(NS, 'text');
        name.setAttribute('class', 'sv-node-name sv-mono');
        name.setAttribute('x', '26'); name.setAttribute('y', String(n.h / 2));
        name.setAttribute('dominant-baseline', 'middle');
        name.textContent = _svClipText(sym.name, n.w - 60);
        g.appendChild(name);

        const kindEl = document.createElementNS(NS, 'text');
        kindEl.setAttribute('class', 'sv-pill-kind');
        kindEl.setAttribute('x', String(n.w - 8)); kindEl.setAttribute('y', String(n.h / 2));
        kindEl.setAttribute('dominant-baseline', 'middle');
        kindEl.setAttribute('text-anchor', 'end');
        kindEl.textContent = (sym.kind || '').slice(0, 4).toUpperCase();
        g.appendChild(kindEl);
    }

    if (sym.has_error || sym.parse_error) {
        const badge = document.createElementNS(NS, 'g');
        badge.setAttribute('class', 'sv-error-badge');
        badge.setAttribute('transform', `translate(${n.w - 10},${n.h - 10})`);
        const disc = document.createElementNS(NS, 'circle');
        disc.setAttribute('r', '8');
        disc.setAttribute('fill', '#ef4444');
        disc.setAttribute('stroke', '#1b1c19');
        disc.setAttribute('stroke-width', '1.4');
        badge.appendChild(disc);
        const xm = document.createElementNS(NS, 'text');
        xm.setAttribute('class', 'sv-error-x');
        xm.setAttribute('text-anchor', 'middle');
        xm.setAttribute('y', '4');
        xm.setAttribute('fill', '#fff');
        xm.textContent = '✕';
        badge.appendChild(xm);
        const title = document.createElementNS(NS, 'title');
        title.textContent = sym.parse_error || 'Parse issue — symbols may be incomplete';
        badge.appendChild(title);
        g.appendChild(badge);
    }

    return g;
}

function _svClipText(s, maxPx) {
    if (!s) return '';
    const maxChars = Math.max(4, Math.floor(maxPx / _SV_CH_W));
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars - 1) + '…';
}

// ── Edge drawing ──────────────────────────────────────────────────────────
function _svAppendEdge(edgesG, labelsG, ed, from, to) {
    const NS = 'http://www.w3.org/2000/svg';
    const fromBox = { x: from.currentX + from.w / 2, y: from.currentY + from.h / 2, w: from.w, h: from.h };
    const toBox   = { x: to.currentX   + to.w   / 2, y: to.currentY   + to.h   / 2, w: to.w,   h: to.h };
    const endpoints = _svComputeEndpoints(fromBox, toBox);
    const color = _svEdgeColor(ed.type);

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', `sv-edge sv-edge-${ed.type}` + (ed.external ? ' sv-edge-external' : ''));
    path.dataset.edgeid = ed.id;
    path.setAttribute('d', _svBuildEdgePath(endpoints));
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', ed.external ? '1.3' : '1.6');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#sv-arrow)');
    if (ed.external) path.setAttribute('stroke-dasharray', '5 3');
    path.style.color = color;
    path.addEventListener('click', (e) => {
        e.stopPropagation();
        _svHandleEdgeClick(ed);
    });
    path.addEventListener('mouseenter', (e) => _svShowEdgeTip(e, ed));
    path.addEventListener('mousemove',  (e) => _svMoveEdgeTip(e));
    path.addEventListener('mouseleave', () => _svHideEdgeTip());
    edgesG.appendChild(path);
}

function _svComputeEndpoints(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const fromSide = absDx > absDy ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
    const toSide   = absDx > absDy ? (dx > 0 ? 'left'  : 'right') : (dy > 0 ? 'top'    : 'bottom');
    const sx = from.x + _svSideOffsetX(fromSide, from.w);
    const sy = from.y + _svSideOffsetY(fromSide, from.h);
    const ex = to.x   + _svSideOffsetX(toSide,   to.w);
    const ey = to.y   + _svSideOffsetY(toSide,   to.h);
    return { sx, sy, ex, ey, fromSide, toSide };
}
function _svSideOffsetX(side, w) {
    if (side === 'left')  return -w / 2;
    if (side === 'right') return  w / 2;
    return 0;
}
function _svSideOffsetY(side, h) {
    if (side === 'top')    return -h / 2;
    if (side === 'bottom') return  h / 2;
    return 0;
}
function _svBuildEdgePath({ sx, sy, ex, ey, fromSide, toSide }) {
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const curve = Math.min(120, Math.max(32, dist * 0.35));
    let cx1 = sx, cy1 = sy, cx2 = ex, cy2 = ey;
    if (fromSide === 'left')   cx1 = sx - curve;
    if (fromSide === 'right')  cx1 = sx + curve;
    if (fromSide === 'top')    cy1 = sy - curve;
    if (fromSide === 'bottom') cy1 = sy + curve;
    if (toSide === 'left')     cx2 = ex - curve;
    if (toSide === 'right')    cx2 = ex + curve;
    if (toSide === 'top')      cy2 = ey - curve;
    if (toSide === 'bottom')   cy2 = ey + curve;
    return `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${ex} ${ey}`;
}

// ── Edge tooltip (reused from V2 Feature 5) ──────────────────────────────
function _svShowEdgeTip(e, ed) {
    const tip = document.getElementById('sv-edge-tip');
    if (!tip) return;
    tip.innerHTML = `<span class="sv-tip-type" style="color:${_svEdgeColor(ed.type)}">${_svEsc(ed.type)}</span>
        ${ed.external ? '<span class="sv-tip-sites">cross-file</span>' : ''}
        <div class="sv-tip-hint">Click to jump or switch file</div>`;
    tip.hidden = false;
    _svMoveEdgeTip(e);
}
function _svMoveEdgeTip(e) {
    const tip = document.getElementById('sv-edge-tip');
    if (!tip || tip.hidden) return;
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY + 14) + 'px';
}
function _svHideEdgeTip() {
    const tip = document.getElementById('sv-edge-tip');
    if (tip) tip.hidden = true;
}

// ── Click handlers ────────────────────────────────────────────────────────
function _svBindNodeClicks() {
    const viewport = _svState.viewport;
    if (!viewport) return;
    viewport.querySelectorAll('.sv-node').forEach(el => {
        if (el.dataset.boundClick === '1') return;
        el.dataset.boundClick = '1';
        el.addEventListener('click', (e) => {
            // Compound toggle and in-card method hits propagate via stopPropagation.
            const sid = el.dataset.symid;
            if (!sid) return;
            _svHandleNodeClick(sid, el);
        });
    });
}

function _svHandleNodeClick(symId, el) {
    const model = _svState.currentGraph;
    if (!model) return;
    const node = model.byNodeId[symId];
    if (!node) return;

    if (node.isGhost) {
        // Switch to that file and focus the ghost symbol
        symViewActivate(symId);
        return;
    }

    // Jump code panel to this symbol's definition
    const sym = node.sym || {};
    if (sym.file && typeof loadFileInPanel === 'function') {
        loadFileInPanel(sym.file, null);
        if (sym.line && typeof jumpToLine === 'function') {
            setTimeout(() => jumpToLine(sym.line), 150);
        }
    }

    // If this node is already focused, do nothing extra (avoid flicker).
    if (_svState.focusId === symId) return;
    _svState.focusId = symId;
    _svState.detailSectionCollapsed.clear();
    _svState.edgeJumpCursor.clear();
    _svRebuildForFocus();
}

function _svHandleEdgeClick(ed) {
    if (!ed) return;
    const model = _svState.currentGraph;
    if (!model) return;
    // Prefer the target of the edge as navigation anchor. For external edges,
    // activate the foreign symbol (switches file).
    const targetId = ed.origTo || ed.to;
    const tNode = model.byNodeId[targetId];
    if (tNode && tNode.isGhost) {
        symViewActivate(targetId);
    } else if (tNode) {
        _svHandleNodeClick(targetId);
    }
}

// Compound class toggle (expand/collapse methods)
function _svToggleCompound(classId) {
    if (_svState.compoundCollapsed.has(classId)) {
        _svState.compoundCollapsed.delete(classId);
    } else {
        _svState.compoundCollapsed.add(classId);
    }
    if (_svState.fileRel) {
        _svLoadFileGraph(_svState.fileRel, { pendingFocus: _svState.focusId });
    }
}

function _svExpandAll() {
    _svState.compoundCollapsed.clear();
    if (_svState.fileRel) _svLoadFileGraph(_svState.fileRel, { pendingFocus: _svState.focusId });
}

function _svCollapseAll() {
    const model = _svState.currentGraph;
    if (model) {
        for (const n of model.nodes) {
            if (n.isCompound) _svState.compoundCollapsed.add(n.id);
        }
    }
    if (_svState.fileRel) _svLoadFileGraph(_svState.fileRel, { pendingFocus: _svState.focusId });
}

function _svToggleExternal() {
    _svState.showExternal = !_svState.showExternal;
    const btn = document.getElementById('sv-ext-btn');
    if (btn) btn.classList.toggle('sv-btn-active', _svState.showExternal);
    if (_svState.fileRel) _svLoadFileGraph(_svState.fileRel, { pendingFocus: _svState.focusId });
}
