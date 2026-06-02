// ── Symbol View — Graph renderer (V3: dagre LR flow graph + focus fade) ─
// Single unified view per file: all classes/functions/methods are laid out
// by dagre. Clicking a node focuses it (scales up, shows rich detail card);
// 1-hop neighbors stay vivid; 2-hop+ nodes fade to communicate scope without
// hiding context.

'use strict';

// ── Layout constants ──────────────────────────────────────────────────────
const _SV_CLASS_PAD_X = 16;
const _SV_CLASS_PAD_TOP = 46;
const _SV_CLASS_PAD_BOT = 14;
const _SV_CLASS_INNER_LEFT = 14;
const _SV_CLASS_MIN_W = 232;
const _SV_CLASS_MAX_W = 560;
const _SV_METHOD_W = 112;
const _SV_METHOD_MAX_W = 320;
const _SV_METHOD_H = 34;
const _SV_METHOD_GAP = 6;
const _SV_SECTION_LABEL_H = 14;
const _SV_SECTION_GAP = 8;
const _SV_SECTION_BODY_GAP = 10;
const _SV_SECTION_DIVIDER_GAP = 8;
const _SV_SECTION_SPLIT_GAP = 14;
const _SV_PILL_H = 30;
const _SV_PILL_MIN_W = 64;
const _SV_PILL_MAX_W = 220;
const _SV_FUNC_W = 220;
const _SV_FUNC_MAX_W = 340;
const _SV_FUNC_H = 42;
const _SV_FIELD_W = 180;
const _SV_FIELD_MAX_W = 300;
const _SV_FIELD_H = 28;
const _SV_GHOST_W = 220;
const _SV_GHOST_MAX_W = 360;
const _SV_GHOST_H = 52;

const _SV_FOCUS_SIG_H = 36;   // detail row heights (each collapsible)
const _SV_FOCUS_DOC_H = 46;
const _SV_FOCUS_MET_H = 28;

const _SV_LAYOUT_NODESEP = 42;
const _SV_LAYOUT_RANKSEP = 128;
const _SV_LAYOUT_MARGIN = 56;
const _SV_COLLISION_PAD = 24;

const _SV_DETAIL_GAP = 24;
const _SV_DETAIL_MIN_W = 280;
const _SV_DETAIL_MAX_W = 420;
const _SV_DETAIL_MIN_H = 170;
const _SV_DETAIL_MAX_H = 560;
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
    const raw = _svMeasureText(sym && sym.name, 13) + 42;
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

function _svMeasurePillWidth(sym) {
    const raw = _svMeasureText(sym && sym.name, 13) + 34;
    return _svClamp(raw, _SV_PILL_MIN_W, _SV_PILL_MAX_W);
}

function _svBuildMethodSections(methods) {
    const publicNodes = [];
    const privateNodes = [];
    for (const method of (methods || [])) {
        if (method && method.is_public === false) privateNodes.push(method);
        else publicNodes.push(method);
    }

    const sections = [];
    if (publicNodes.length) sections.push({ key: 'public', label: 'PUBLIC', methods: publicNodes });
    if (privateNodes.length) sections.push({ key: 'private', label: 'PRIVATE', methods: privateNodes });
    return sections;
}

function _svSectionDisplayLabel(section) {
    if (!section) return '';
    const total = Array.isArray(section.methods) ? section.methods.length : 0;
    const visible = Array.isArray(section.visibleMethods) ? section.visibleMethods.length : 0;
    const hidden = Math.max(0, total - visible);
    const marker = section.expanded ? `-${total}` : `+${hidden || total}`;
    const related = !section.expanded && visible ? ` · ${visible} linked` : '';
    return `${section.label} ${marker}${related}`;
}

function _svAccessGroup(sym) {
    if (!sym || typeof sym.is_public !== 'boolean') return '';
    return sym.is_public ? 'public' : 'private';
}

function _svAccessStroke(access) {
    if (access === 'public') return '#fbbf24';
    if (access === 'private') return '#60a5fa';
    return '';
}

function _svResolveEdgeStroke(ed, fromNode) {
    // Access-based coloring (public=yellow / private=blue) is only meaningful
    // for call edges, where it conveys the caller's visibility. Structural
    // edges (inheritance, implements, type_usage, …) are colored by their type
    // so they're distinguishable on the canvas and match the sidebar legend.
    if (ed && ed.type && ed.type !== 'call') return _svEdgeColor(ed.type);
    const sourceAccess = ed && ed.sourceAccess ? ed.sourceAccess : _svAccessGroup(fromNode && fromNode.sym);
    return _svAccessStroke(sourceAccess) || _svEdgeColor(ed.type);
}

function _svResolveSelectedEdgeStroke(ed, fromNode) {
    if (ed && ed.type && ed.type !== 'call') return _svEdgeColor(ed.type);
    const sourceAccess = ed && ed.sourceAccess ? ed.sourceAccess : _svAccessGroup(fromNode && fromNode.sym);
    if (sourceAccess === 'public') return '#ffd76a';
    if (sourceAccess === 'private') return '#8cc7ff';
    return '#f0b060';
}

function _svAccessTitle(access) {
    if (access === 'public') return 'PUBLIC';
    if (access === 'private') return 'PRIVATE';
    return 'UNKNOWN';
}

function _svEdgeVerb(type) {
    if (type === 'call') return 'calls';
    if (type === 'inheritance') return 'inherits from';
    if (type === 'implements') return 'implements';
    if (type === 'mixin_include') return 'includes mixin';
    if (type === 'mixin_extend') return 'extends with mixin';
    if (type === 'mixin_prepend') return 'prepends mixin';
    if (type === 'behaviour_impl') return 'implements behaviour';
    if (type === 'protocol_impl') return 'implements protocol';
    if (type === 'override') return 'overrides';
    if (type === 'import') return 'imports';
    if (type === 'include') return 'includes';
    if (type === 'type_usage') return 'uses type';
    if (type === 'member') return 'references member';
    return String(type || 'connects to').replace(/_/g, ' ');
}

function _svEdgeAccessSummary(ed) {
    if (!ed || !ed.sourceAccess || !ed.targetAccess) return '';
    return `${_svAccessTitle(ed.sourceAccess)} ${_svEdgeVerb(ed.type)} ${_svAccessTitle(ed.targetAccess)}`;
}

// ── Card content enrichment (layout-locked: no new sections) ─────────────────
// Richer L3 detail is folded into the EXISTING signature and metrics sections.
function _svSymHasSig(sym) {
    return !!(sym && (sym.signature
        || (Array.isArray(sym.decorators) && sym.decorators.length)
        || (Array.isArray(sym.bases) && sym.bases.length)));
}

// Decorators (@dec) + bases (: Base1, Base2) folded into the signature line.
function _svSymSigText(sym) {
    const parts = [];
    if (sym && Array.isArray(sym.decorators) && sym.decorators.length) {
        parts.push(sym.decorators.map(d => '@' + d).join(' '));
    }
    let core = (sym && sym.signature) || '';
    if (sym && Array.isArray(sym.bases) && sym.bases.length) {
        core = (core ? core + ' ' : '') + ': ' + sym.bases.join(', ');
    }
    if (core) parts.push(core);
    return parts.join('  ');
}

// Extra metric chips ([key, label]) folded into the existing metrics section.
// Note: the data model overloads `is_static` to mean "private/internal", so we
// surface visibility via `is_public` and never emit a separate (misleading)
// "static" chip. True `@staticmethod`/static markers appear in the decorators.
function _svSymMetaChips(sym) {
    const chips = [];
    if (sym && sym.complexity != null) chips.push(['complexity', 'cx ' + sym.complexity]);
    if (sym && typeof sym.is_public === 'boolean') chips.push(['visibility', sym.is_public ? 'public' : 'private']);
    return chips;
}

function _svEstimateDetailCardHeight(sym, collapsed) {
    let height = 96;
    if (_svSymHasSig(sym)) height += collapsed.has('signature') ? 30 : _SV_FOCUS_SIG_H;
    if (sym && sym.docstring) height += collapsed.has('docstring') ? 30 : _SV_FOCUS_DOC_H;
    height += collapsed.has('metrics') ? 30 : (_SV_FOCUS_MET_H + 12);
    return _svClamp(height, _SV_DETAIL_MIN_H, _SV_DETAIL_MAX_H);
}

function _svDetailCardStateKey(focusId, collapsed) {
    const hidden = Array.from(collapsed || []).sort().join(',');
    return `${focusId || ''}|${hidden}`;
}

function _svGetDetailCardHeight(sym, focusId, cardW) {
    const estimated = _svEstimateDetailCardHeight(sym, _svState.detailSectionCollapsed);
    const key = _svDetailCardStateKey(focusId, _svState.detailSectionCollapsed);
    let override = _svState.focusCardHeightOverrides.get(key) || 0;
    if (!override && sym && cardW && _svState.measureHost) {
        const lineCount = Math.max(1, (sym.end_line || sym.line || 1) - (sym.line || 1) + 1);
        const host = _svState.measureHost;
        host.style.width = `${cardW}px`;
        host.innerHTML = _svFocusCardMarkup(sym, {
            callers: 0,
            callees: 0,
            lineCount,
            collapsed: _svState.detailSectionCollapsed,
        });
        const card = host.firstElementChild;
        if (card) {
            override = _svClamp(Math.ceil(card.scrollHeight + 2), _SV_DETAIL_MIN_H, _SV_DETAIL_MAX_H);
            _svState.focusCardHeightOverrides.set(key, override);
        }
        host.innerHTML = '';
    }
    return _svClamp(Math.max(estimated, override), _SV_DETAIL_MIN_H, _SV_DETAIL_MAX_H);
}

function _svVisibleWorldBounds() {
    const svg = _svState.svg;
    const zoom = _svState.zoom;
    if (!svg || !zoom || !zoom.k) {
        return { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    }
    const rect = svg.getBoundingClientRect();
    return {
        left: (-zoom.x) / zoom.k,
        top: (-zoom.y) / zoom.k,
        right: (rect.width - zoom.x) / zoom.k,
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

const _SV_FOCUS_RING_GAP = 46;
const _SV_FOCUS_LANE_GAP = 14;
const _SV_FOCUS_REPEL_PAD = 28;
const _SV_CAMERA_PAD = 96;
const _SV_FOCUS_BOTTOM_WRAP = 5;

function _svIsFieldKind(kind) {
    return kind === 'field' || kind === 'variable' || kind === 'constant' || kind === 'property';
}

function _svCloneAdj(adj) {
    const copy = new Map();
    for (const [id, links] of (adj || new Map())) {
        copy.set(id, new Set(links || []));
    }
    return copy;
}

function _svCloneGraphModel(model) {
    const nodes = (model.nodes || []).map(n => ({
        ...n,
        methods: Array.isArray(n.methods) ? n.methods.slice() : n.methods,
        el: null,
    }));
    const byNodeId = {};
    for (const n of nodes) byNodeId[n.id] = n;
    return {
        ...model,
        nodes,
        edges: (model.edges || []).map(e => ({ ...e })),
        byId: { ...(model.byId || {}) },
        adj: _svCloneAdj(model.adj),
        byNodeId,
        cameraBounds: model.cameraBounds ? { ...model.cameraBounds } : null,
    };
}

function _svUpdateNodeCenter(node) {
    node.cx = node.x + node.w / 2;
    node.cy = node.y + node.h / 2;
    return node;
}

function _svRectFromNode(node) {
    return { x: node.x, y: node.y, w: node.w, h: node.h };
}

function _svComputeRectBounds(items, pad = 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of (items || [])) {
        if (!item) continue;
        const x = item.x;
        const y = item.y;
        const w = item.w || 0;
        const h = item.h || 0;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    }
    if (!Number.isFinite(minX)) return null;
    return {
        minX: minX - pad,
        minY: minY - pad,
        maxX: maxX + pad,
        maxY: maxY + pad,
    };
}

function _svFocusNodeSort(nodes) {
    return nodes.slice().sort((a, b) => {
        const ay = Number.isFinite(a.y) ? a.y : 0;
        const by = Number.isFinite(b.y) ? b.y : 0;
        if (ay !== by) return ay - by;
        const ax = Number.isFinite(a.x) ? a.x : 0;
        const bx = Number.isFinite(b.x) ? b.x : 0;
        if (ax !== bx) return ax - bx;
        const al = a.sym && a.sym.line ? a.sym.line : 0;
        const bl = b.sym && b.sym.line ? b.sym.line : 0;
        if (al !== bl) return al - bl;
        return String((a.sym && a.sym.name) || a.id).localeCompare(String((b.sym && b.sym.name) || b.id));
    });
}

function _svEnsureAdjLink(model, a, b) {
    if (!a || !b) return;
    if (!model.adj.has(a)) model.adj.set(a, new Set());
    if (!model.adj.has(b)) model.adj.set(b, new Set());
    model.adj.get(a).add(b);
    model.adj.get(b).add(a);
}

function _svFindOwnerNode(model, node) {
    if (!node) return null;
    if (node.parentId && model.byNodeId[node.parentId]) return model.byNodeId[node.parentId];
    const sym = node.sym || {};
    if (!sym.parent || !sym.file) return null;
    return model.nodes.find(n =>
        _SV_CARD_KINDS.has(n.kind) &&
        n.sym &&
        n.sym.name === sym.parent &&
        n.sym.file === sym.file
    ) || null;
}

function _svIsCompoundSymbol(sym) {
    return !!(sym && _SV_CARD_KINDS.has(sym.kind));
}

function _svIsCompoundSymbolId(symId) {
    const model = _svState.currentGraph || _svState.baseLayoutSnapshot;
    const node = model && model.byNodeId ? model.byNodeId[symId] : null;
    if (node && (node.isCompound || _svIsCompoundSymbol(node.sym))) return true;
    const sym = (window.DATA && DATA.symbol_index && DATA.symbol_index[symId]) || null;
    return _svIsCompoundSymbol(sym);
}

function _svSectionKey(classId, sectionKey) {
    return `${classId}:${sectionKey}`;
}

function _svClearCompoundSections(classId) {
    if (!classId || !_svState.compoundSectionExpanded) return;
    for (const key of Array.from(_svState.compoundSectionExpanded)) {
        if (key.startsWith(`${classId}:`)) _svState.compoundSectionExpanded.delete(key);
    }
}

// Section keys for a class, in canonical render order (PUBLIC before PRIVATE).
function _svOrderedSectionKeys(classId) {
    const ordered = [];
    const seen = new Set();
    const addKey = (k) => { if (k && !seen.has(k)) { seen.add(k); ordered.push(k); } };

    const models = [_svState.currentGraph, _svState.baseLayoutSnapshot, _svState.focusLayoutSnapshot];
    for (const model of models) {
        const node = model && model.byNodeId ? model.byNodeId[classId] : null;
        if (!node || !Array.isArray(node.sections)) continue;
        for (const section of node.sections) addKey(section && section.key);
    }

    if (!ordered.length && _svState.currentData && Array.isArray(_svState.currentData.symbols)) {
        const symbols = _svState.currentData.symbols;
        const cls = symbols.find(s => s && s.id === classId);
        if (cls) {
            const methods = symbols.filter(s =>
                s && !_SV_CARD_KINDS.has(s.kind) && s.parent === cls.name && s.file === cls.file
            );
            for (const section of _svBuildMethodSections(methods)) addKey(section && section.key);
        }
    }
    return ordered;
}

// Accordion invariant: open at most ONE section per class. When a class is
// expanded we default to its first section (PUBLIC when present) so the card
// shows content immediately while staying contained within its boundaries.
function _svSetCompoundSectionsExpanded(classId) {
    if (!classId || !_svState.compoundSectionExpanded) return;
    _svClearCompoundSections(classId);
    const ordered = _svOrderedSectionKeys(classId);
    if (ordered.length) {
        _svState.compoundSectionExpanded.add(_svSectionKey(classId, ordered[0]));
    }
}

function _svOpenCompoundInline(classId, opts = {}) {
    if (!classId || !_svState.fileRel) return;
    const toggle = opts.toggle !== false;
    if (toggle && !_svState.compoundCollapsed.has(classId)) {
        _svState.compoundCollapsed.add(classId);
        _svClearCompoundSections(classId);
    } else {
        _svState.compoundCollapsed.delete(classId);
        if (opts.expandSections !== false) _svSetCompoundSectionsExpanded(classId);
        else if (opts.resetSections !== false) _svClearCompoundSections(classId);
    }
    _svState.focusId = null;
    _svState.detailSectionCollapsed.clear();
    _svState.edgeJumpCursor.clear();
    _svState.selectedEdgeId = null;
    _svState.metricHighlight = null;
    _svLoadFileGraph(_svState.fileRel);
}

function _svToggleCompoundSection(classId, sectionKey) {
    if (!classId || !sectionKey || !_svState.fileRel) return;
    _svState.compoundCollapsed.delete(classId);
    const key = _svSectionKey(classId, sectionKey);
    if (_svState.compoundSectionExpanded.has(key)) {
        // Clicking the open section collapses it.
        _svState.compoundSectionExpanded.delete(key);
    } else {
        // Accordion: open this section and collapse any sibling section of the
        // same class so only one (PUBLIC or PRIVATE) is ever expanded at a time.
        _svClearCompoundSections(classId);
        _svState.compoundSectionExpanded.add(key);
    }
    _svState.focusId = null;
    _svState.edgeJumpCursor.clear();
    _svState.selectedEdgeId = null;
    _svLoadFileGraph(_svState.fileRel);
}

function _svPlaceVerticalLane(nodes, x, centerY) {
    if (!nodes.length) return [];
    const totalH = nodes.reduce((sum, n) => sum + n.h, 0) + _SV_FOCUS_LANE_GAP * (nodes.length - 1);
    let y = centerY - totalH / 2;
    const rects = [];
    for (const node of nodes) {
        node.x = x;
        node.y = y;
        _svUpdateNodeCenter(node);
        rects.push(_svRectFromNode(node));
        y += node.h + _SV_FOCUS_LANE_GAP;
    }
    return rects;
}

function _svPlaceHorizontalLane(nodes, y, centerX) {
    if (!nodes.length) return [];
    const totalW = nodes.reduce((sum, n) => sum + n.w, 0) + _SV_FOCUS_LANE_GAP * (nodes.length - 1);
    let x = centerX - totalW / 2;
    const rects = [];
    for (const node of nodes) {
        node.x = x;
        node.y = y;
        _svUpdateNodeCenter(node);
        rects.push(_svRectFromNode(node));
        x += node.w + _SV_FOCUS_LANE_GAP;
    }
    return rects;
}

function _svPlaceHorizontalWrappedLane(nodes, startY, centerX, wrapCount) {
    if (!nodes.length) return [];
    const rows = [];
    for (let i = 0; i < nodes.length; i += wrapCount) {
        rows.push(nodes.slice(i, i + wrapCount));
    }

    const rects = [];
    let y = startY;
    for (const rowNodes of rows) {
        const totalW = rowNodes.reduce((sum, n) => sum + n.w, 0) + _SV_FOCUS_LANE_GAP * (rowNodes.length - 1);
        let x = centerX - totalW / 2;
        let rowH = 0;
        for (const node of rowNodes) {
            node.x = x;
            node.y = y;
            _svUpdateNodeCenter(node);
            rects.push(_svRectFromNode(node));
            x += node.w + _SV_FOCUS_LANE_GAP;
            rowH = Math.max(rowH, node.h);
        }
        y += rowH + _SV_FOCUS_LANE_GAP;
    }
    return rects;
}

function _svGetCompoundGroupNodes(model, rootNode, fixedIds) {
    if (!rootNode || !rootNode.isCompound) return [rootNode].filter(Boolean);
    return model.nodes.filter(n => n.id === rootNode.id || (n.parentId === rootNode.id && !fixedIds.has(n.id)));
}

function _svFocusLaneNode(model, node, focusId) {
    if (!node || node.id === focusId) return node;
    if (!node.parentId) return node;
    const owner = model && model.byNodeId ? model.byNodeId[node.parentId] : null;
    return owner || node;
}

function _svRectFromBounds(bounds) {
    return bounds ? {
        x: bounds.minX,
        y: bounds.minY,
        w: bounds.maxX - bounds.minX,
        h: bounds.maxY - bounds.minY,
    } : null;
}

function _svTranslateNodes(nodes, dx, dy) {
    for (const node of nodes) {
        node.x += dx;
        node.y += dy;
        _svUpdateNodeCenter(node);
    }
}

function _svPushNodeGroupAwayFromRects(groupNodes, rects, focusCx, focusCy) {
    let rect = _svRectFromBounds(_svComputeRectBounds(groupNodes, 0));
    if (!rect) return null;
    for (let pass = 0; pass < 10; pass++) {
        let moved = false;
        for (const blocker of rects) {
            if (!_svRectsOverlap(rect, blocker, _SV_FOCUS_REPEL_PAD)) continue;
            const rcx = blocker.x + blocker.w / 2;
            const rcy = blocker.y + blocker.h / 2;
            let dx = rect.x + rect.w / 2 - rcx;
            let dy = rect.y + rect.h / 2 - rcy;
            if (dx === 0 && dy === 0) {
                dx = rect.x + rect.w / 2 - focusCx;
                dy = rect.y + rect.h / 2 - focusCy;
                if (dx === 0 && dy === 0) dx = 1;
            }
            let nextRect = { ...rect };
            if (Math.abs(dx) >= Math.abs(dy)) {
                nextRect.x = dx >= 0
                    ? blocker.x + blocker.w + _SV_FOCUS_REPEL_PAD
                    : blocker.x - rect.w - _SV_FOCUS_REPEL_PAD;
            } else {
                nextRect.y = dy >= 0
                    ? blocker.y + blocker.h + _SV_FOCUS_REPEL_PAD
                    : blocker.y - rect.h - _SV_FOCUS_REPEL_PAD;
            }
            _svTranslateNodes(groupNodes, nextRect.x - rect.x, nextRect.y - rect.y);
            rect = nextRect;
            moved = true;
        }
        if (!moved) break;
    }
    return rect;
}

function _svCollectFocusBuckets(model, resp, focusId) {
    const focusNode = model.byNodeId[focusId];
    const buckets = {
        parents: [],
        children: [],
        incoming: [],
        outgoing: [],
        related: [],
    };
    const priority = { related: 0, outgoing: 1, incoming: 2, children: 3, parents: 4 };
    const assigned = new Map();

    function removeFromBucket(bucketName, nodeId) {
        const arr = buckets[bucketName];
        const idx = arr.findIndex(n => n.id === nodeId);
        if (idx >= 0) arr.splice(idx, 1);
    }

    function assign(node, bucketName) {
        node = _svFocusLaneNode(model, node, focusId);
        if (!node || node.id === focusId) return;
        const nextPrio = priority[bucketName];
        const prev = assigned.get(node.id);
        if (prev && prev.priority >= nextPrio) return;
        if (prev) removeFromBucket(prev.bucket, node.id);
        assigned.set(node.id, { bucket: bucketName, priority: nextPrio });
        buckets[bucketName].push(node);
    }

    const owner = _svFindOwnerNode(model, focusNode);
    if (owner) assign(owner, 'parents');

    for (const ed of model.edges) {
        const touchesOut = ed.from === focusId || ed.origFrom === focusId;
        const touchesIn = ed.to === focusId || ed.origTo === focusId;
        if (touchesOut && ed.to !== focusId) assign(model.byNodeId[ed.to], 'outgoing');
        if (touchesIn && ed.from !== focusId) assign(model.byNodeId[ed.from], 'incoming');
    }

    for (const linkedId of (model.adj.get(focusId) || [])) {
        assign(model.byNodeId[linkedId], 'related');
    }

    return {
        parents: _svFocusNodeSort(buckets.parents),
        children: _svFocusNodeSort(buckets.children),
        incoming: _svFocusNodeSort(buckets.incoming),
        outgoing: _svFocusNodeSort(buckets.outgoing),
        related: _svFocusNodeSort(buckets.related),
    };
}

// Recompute a class compound's interior (section labelY/dividerY/methodRows and
// its height) from its sections' visibleMethods — mirrors the per-class layout in
// _svBuildFileGraphModel. Used by focus mode to re-flow a class after one of its
// methods is extracted into a standalone focus card, so the card stays contained
// and the remaining rows pack cleanly with no holes.
function _svLayoutCompoundSections(node) {
    const sections = node.sections || [];
    const hasMethods = sections.some(s => (s.methods || []).length);
    if (node.collapsed || !hasMethods) {
        node.h = _SV_CLASS_PAD_TOP + _SV_CLASS_PAD_BOT + 18;
        return node.h;
    }
    let cursorY = _SV_CLASS_PAD_TOP;   // relative to the node's top-left
    sections.forEach((section, idx) => {
        cursorY += _SV_SECTION_GAP;
        section.labelY = cursorY;
        section.dividerY = cursorY + _SV_SECTION_DIVIDER_GAP;
        cursorY += _SV_SECTION_LABEL_H + _SV_SECTION_BODY_GAP + _SV_SECTION_DIVIDER_GAP;
        section.methodRows = [];
        const vis = section.visibleMethods || [];
        vis.forEach((m, mi) => {
            const methodW = _svMeasureMethodWidth(m);
            section.methodRows.push({
                id: m.id, sym: m, kind: m.kind, isMethod: true, parentId: node.id,
                x: _SV_CLASS_INNER_LEFT, y: cursorY, w: methodW, h: _SV_METHOD_H,
            });
            cursorY += _SV_METHOD_H;
            if (mi !== vis.length - 1) cursorY += _SV_METHOD_GAP;
        });
        if (idx !== sections.length - 1) cursorY += _SV_SECTION_SPLIT_GAP;
    });
    node.h = cursorY + _SV_CLASS_PAD_BOT;
    return node.h;
}

// Remove a method from its parent compound's rendered rows (deep-cloning the shared
// section objects first so the base snapshot is never mutated) and re-flow the
// compound. Returns the parent node, or null when the method has no compound parent.
function _svExtractMethodFromCompound(model, methodId) {
    const method = model.byNodeId[methodId];
    if (!method || !method.parentId) return null;
    const parent = model.byNodeId[method.parentId];
    if (!parent || !parent.isCompound || !Array.isArray(parent.sections)) return null;
    parent.sections = parent.sections.map(s => ({
        ...s,
        visibleMethods: (s.visibleMethods || []).filter(m => m.id !== methodId),
        methodRows: undefined,
    }));
    _svLayoutCompoundSections(parent);
    return parent;
}

function _svBuildFocusLayoutModel(baseModel, resp, focusOpts) {
    const model = _svCloneGraphModel(baseModel);
    for (const node of model.nodes) {
        node.baseX = node.x;
        node.baseY = node.y;
        node.baseCx = node.cx;
        node.baseCy = node.cy;
    }
    const focusNode = model.byNodeId[focusOpts.focusId];
    if (!focusNode) return model;

    // If the focused node is a method, pull it out of its class card so it renders
    // only as the standalone detail card (re-flow the class to its new height first
    // so lane placement below uses the corrected geometry).
    _svExtractMethodFromCompound(model, focusOpts.focusId);

    const centerCx = focusNode.cx;
    const centerCy = focusNode.cy;
    focusNode.isFocusCard = true;
    focusNode.isCompound = false;
    focusNode.isTopLevel = false;
    focusNode.isField = false;
    focusNode.x = centerCx - focusOpts.cardW / 2;
    focusNode.y = centerCy - focusOpts.cardH / 2;
    focusNode.w = focusOpts.cardW;
    focusNode.h = focusOpts.cardH;
    _svUpdateNodeCenter(focusNode);

    const buckets = _svCollectFocusBuckets(model, resp, focusOpts.focusId);
    const leftNodes = buckets.incoming;
    const rightNodes = buckets.outgoing;
    const topNodes = buckets.parents;
    const bottomNodes = buckets.children.concat(buckets.related.filter(n =>
        !buckets.children.some(child => child.id === n.id)
    ));

    const laneRects = [];
    laneRects.push(_svRectFromNode(focusNode));

    if (leftNodes.length) {
        const maxW = Math.max(...leftNodes.map(n => n.w));
        _svPlaceVerticalLane(
            leftNodes,
            focusNode.x - _SV_FOCUS_RING_GAP - maxW,
            centerCy
        );
    }
    if (rightNodes.length) {
        _svPlaceVerticalLane(
            rightNodes,
            focusNode.x + focusNode.w + _SV_FOCUS_RING_GAP,
            centerCy
        );
    }
    if (topNodes.length) {
        const maxH = Math.max(...topNodes.map(n => n.h));
        _svPlaceHorizontalLane(
            topNodes,
            focusNode.y - _SV_FOCUS_RING_GAP - maxH,
            centerCx
        );
    }
    if (bottomNodes.length) {
        _svPlaceHorizontalWrappedLane(
            bottomNodes,
            focusNode.y + focusNode.h + _SV_FOCUS_RING_GAP,
            centerCx,
            _SV_FOCUS_BOTTOM_WRAP
        );
    }

    const fixedIds = new Set([
        focusOpts.focusId,
        ...leftNodes.map(n => n.id),
        ...rightNodes.map(n => n.id),
        ...topNodes.map(n => n.id),
        ...bottomNodes.map(n => n.id),
    ]);

    const fixedGroups = [focusNode, ...leftNodes, ...rightNodes, ...topNodes, ...bottomNodes];
    for (const node of fixedGroups) {
        if (!node || !node.isCompound) continue;
        const dx = node.x - (Number.isFinite(node.baseX) ? node.baseX : node.x);
        const dy = node.y - (Number.isFinite(node.baseY) ? node.baseY : node.y);
        for (const member of model.nodes) {
            if (member.parentId !== node.id || fixedIds.has(member.id)) continue;
            member.x = (Number.isFinite(member.baseX) ? member.baseX : member.x) + dx;
            member.y = (Number.isFinite(member.baseY) ? member.baseY : member.y) + dy;
            _svUpdateNodeCenter(member);
        }
    }

    for (const node of fixedGroups) {
        laneRects.push(..._svGetCompoundGroupNodes(model, node, fixedIds).map(_svRectFromNode));
    }

    const movable = model.nodes
        .filter(n => !fixedIds.has(n.id))
        .filter(n => !(n.parentId && model.byNodeId[n.parentId]))
        .sort((a, b) => {
            const da = Math.hypot((a.cx || 0) - centerCx, (a.cy || 0) - centerCy);
            const db = Math.hypot((b.cx || 0) - centerCx, (b.cy || 0) - centerCy);
            return da - db;
        });
    const blockers = laneRects.slice();
    for (const node of movable) {
        const groupNodes = _svGetCompoundGroupNodes(model, node, fixedIds);
        const rect = _svPushNodeGroupAwayFromRects(groupNodes, blockers, centerCx, centerCy);
        if (rect) blockers.push(rect);
    }

    model.layoutMode = 'focus';
    model.hasFocusCard = true;
    model.focusNodeId = focusOpts.focusId;
    const cameraNodes = [];
    for (const node of fixedGroups) {
        cameraNodes.push(..._svGetCompoundGroupNodes(model, node, fixedIds));
    }
    model.cameraBounds = _svComputeRectBounds(
        cameraNodes,
        _SV_CAMERA_PAD
    );
    return model;
}

// ── Entry: load a file's graph ────────────────────────────────────────────
// opts.pendingFocus — focus this symbol as soon as the graph lands.
async function _svLoadFileGraph(fileRel, opts) {
    const svg = _svState.svg;
    const empty = document.getElementById('sv-empty');
    if (!svg) return;
    svg.style.display = '';
    if (empty) empty.hidden = true;

    const jid = _svState.jobId || window.JOB_ID;
    if (!jid) return;

    _svShowLoading(true);
    try {
        const url = `/symbol-file?job=${encodeURIComponent(jid)}&file=${encodeURIComponent(fileRel)}&include_external=1`;
        const resp = await fetch(url);
        const data = await resp.json();
        if (!data || !Array.isArray(data.symbols)) {
            if (empty) empty.hidden = false;
            return;
        }
        _svState.currentData = data;
        const baseModel = _svBuildFileGraphModel(data, fileRel);
        baseModel.fileRel = fileRel;
        baseModel.layoutMode = 'base';
        _svUpdateBreadcrumbFile(fileRel, baseModel);
        _svState.baseLayoutSnapshot = _svCloneGraphModel(baseModel);
        _svState.focusLayoutSnapshot = null;

        if (opts && opts.pendingFocus && _svState.baseLayoutSnapshot.byNodeId[opts.pendingFocus]) {
            const pendingNode = _svState.baseLayoutSnapshot.byNodeId[opts.pendingFocus];
            if (pendingNode && (pendingNode.isCompound || _svIsCompoundSymbol(pendingNode.sym))) {
                _svState.focusId = null;
                _svState.compoundCollapsed.delete(opts.pendingFocus);
                _svSetCompoundSectionsExpanded(opts.pendingFocus);
                _svState.detailSectionCollapsed.clear();
                const expandedModel = _svBuildFileGraphModel(data, fileRel);
                expandedModel.fileRel = fileRel;
                expandedModel.layoutMode = 'base';
                _svState.baseLayoutSnapshot = _svCloneGraphModel(expandedModel);
                _svUpdateBreadcrumbFile(fileRel, expandedModel);
                _svRenderFileGraph(_svCloneGraphModel(_svState.baseLayoutSnapshot));
                return;
            }
            _svState.focusId = opts.pendingFocus;
            const fNode = _svState.baseLayoutSnapshot.byNodeId[opts.pendingFocus];
            const fSym = fNode.sym || {};
            const cardW = _svClamp(Math.max(fNode.w + 52, 260), _SV_DETAIL_MIN_W, _SV_DETAIL_MAX_W);
            const cardH = _svGetDetailCardHeight(fSym, opts.pendingFocus, cardW);
            const focusModel = _svBuildFocusLayoutModel(
                _svState.baseLayoutSnapshot,
                data,
                { focusId: opts.pendingFocus, cardW, cardH }
            );
            focusModel.fileRel = fileRel;
            _svState.focusLayoutSnapshot = _svCloneGraphModel(focusModel);
            _svUpdateBreadcrumbFile(fileRel, focusModel);
            _svRenderFileGraph(focusModel);
        } else {
            _svState.focusId = null;
            _svRenderFileGraph(_svCloneGraphModel(_svState.baseLayoutSnapshot));
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
    const data = _svState.currentData;
    const fileRel = _svState.fileRel;
    if (!data || !fileRel) { _svApplyFocus(); return; }
    if (_svIsCompoundSymbolId(focusId)) {
        _svOpenCompoundInline(focusId, { toggle: false });
        return;
    }

    let baseModel = _svState.baseLayoutSnapshot;
    if (!baseModel || baseModel.fileRel !== fileRel) {
        baseModel = _svBuildFileGraphModel(data, fileRel);
        baseModel.fileRel = fileRel;
        baseModel.layoutMode = 'base';
        _svState.baseLayoutSnapshot = _svCloneGraphModel(baseModel);
    }

    if (!focusId) {
        _svState.focusLayoutSnapshot = null;
        const model = _svCloneGraphModel(_svState.baseLayoutSnapshot);
        model.fileRel = fileRel;
        _svUpdateBreadcrumbFile(fileRel, model);
        _svRenderFileGraph(model);
        return;
    }

    const baseNode = _svState.baseLayoutSnapshot.byNodeId[focusId];
    if (!baseNode) {
        const fallback = _svCloneGraphModel(_svState.baseLayoutSnapshot);
        fallback.fileRel = fileRel;
        _svUpdateBreadcrumbFile(fileRel, fallback);
        _svRenderFileGraph(fallback);
        return;
    }

    const sym = baseNode.sym || {};
    const cardW = _svClamp(Math.max(baseNode.w + 52, 260), _SV_DETAIL_MIN_W, _SV_DETAIL_MAX_W);
    const cardH = _svGetDetailCardHeight(sym, focusId, cardW);
    const model = _svBuildFocusLayoutModel(
        _svState.baseLayoutSnapshot,
        data,
        { focusId, cardW, cardH }
    );
    model.fileRel = fileRel;
    _svState.focusLayoutSnapshot = _svCloneGraphModel(model);
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
    if (typeof updateBreadcrumb === 'function') {
        updateBreadcrumb();
    } else if (brd) {
        brd.textContent = fileRel || '';
    }
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
    const edges = resp.edges || [];
    const extEdges = resp.external_edges || [];
    const extSyms = resp.external_syms || {};

    const byId = {};
    for (const s of symbols) byId[s.id] = s;

    // Classify: classes (compound), methods (nested), top-level functions / fields.
    // When focusOpts is provided the focused node is extracted from its category:
    // it becomes a standalone focus-card in topFuncs. If it was a class, its
    // methods lose their parent and also fall into topFuncs as orphaned nodes.
    const classes = [];
    const methods = [];
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

    const methodParentById = new Map(methods.map(m => [m.id, m._parentId]));
    const externallyLinkedMethods = new Set();
    function markLinkedMethod(a, b) {
        const parentA = methodParentById.get(a);
        if (!parentA) return;
        const parentB = methodParentById.get(b);
        if (parentB !== parentA) externallyLinkedMethods.add(a);
    }
    for (const e of edges) {
        markLinkedMethod(e.from, e.to);
        markLinkedMethod(e.to, e.from);
    }
    for (const e of extEdges) {
        markLinkedMethod(e.from, e.to);
        markLinkedMethod(e.to, e.from);
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
        rankdir: 'LR',
        nodesep: _SV_LAYOUT_NODESEP,
        ranksep: _SV_LAYOUT_RANKSEP,
        marginx: _SV_LAYOUT_MARGIN,
        marginy: _SV_LAYOUT_MARGIN,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Compute per-class inner layout first (methods stacked vertically).
    const classDims = {};
    for (const cls of classes) {
        const collapsed = _svState.compoundCollapsed.has(cls.id);
        const clsMethods = methods.filter(m => m._parentId === cls.id);
        const sections = _svBuildMethodSections(clsMethods).map(section => {
            const expanded = _svState.compoundSectionExpanded.has(_svSectionKey(cls.id, section.key));
            const visibleMethods = collapsed
                ? []
                : section.methods.filter(m => expanded || externallyLinkedMethods.has(m.id));
            return {
                ...section,
                expanded,
                visibleMethods,
                hiddenCount: Math.max(0, section.methods.length - visibleMethods.length),
                relatedCount: section.methods.filter(m => externallyLinkedMethods.has(m.id)).length,
            };
        });
        const visibleClsMethods = sections.flatMap(section => section.visibleMethods);
        const methodWidths = new Map(clsMethods.map(m => [m.id, _svMeasureMethodWidth(m)]));
        const innerW = visibleClsMethods.length
            ? Math.max(...visibleClsMethods.map(m => methodWidths.get(m.id) || _SV_METHOD_W))
            : _SV_METHOD_W;
        const headerW = _svMeasureText(cls.name, 15) + 96;
        const sectionLabelW = sections.length
            ? Math.max(...sections.map(section => _svMeasureText(_svSectionDisplayLabel(section), 10) + 44))
            : 0;
        const w = _svClamp(
            Math.max(headerW, innerW + _SV_CLASS_PAD_X * 2, sectionLabelW + _SV_CLASS_PAD_X * 2),
            _SV_CLASS_MIN_W,
            _SV_CLASS_MAX_W
        );
        let h;
        if (collapsed) {
            h = _SV_CLASS_PAD_TOP + _SV_CLASS_PAD_BOT + 18;
        } else if (!clsMethods.length) {
            h = _SV_CLASS_PAD_TOP + _SV_CLASS_PAD_BOT + 18;
        } else {
            h = _SV_CLASS_PAD_TOP + _SV_CLASS_PAD_BOT;
            sections.forEach((section, idx) => {
                h += _SV_SECTION_GAP;           // matches position calc: added per section
                h += _SV_SECTION_LABEL_H;
                h += _SV_SECTION_BODY_GAP;
                h += _SV_SECTION_DIVIDER_GAP;   // matches position calc: was missing
                h += section.visibleMethods.length * _SV_METHOD_H;
                h += Math.max(0, section.visibleMethods.length - 1) * _SV_METHOD_GAP;
                h += idx === sections.length - 1 ? 0 : _SV_SECTION_SPLIT_GAP;
            });
        }
        classDims[cls.id] = {
            w,
            h,
            methods: clsMethods,
            sections,
            collapsed,
            visibleMethodIds: new Set(visibleClsMethods.map(m => m.id)),
            methodWidths,
            innerW: Math.max(innerW, Math.min(_SV_METHOD_MAX_W, w - _SV_CLASS_PAD_X * 2)),
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

    // Intra-file edges. Deduplicate same from/to/type into one edge with callCount.
    // SVG endpoints: redirect only COLLAPSED methods → parent class.
    // Dagre endpoints: redirect ALL methods → parent class (methods aren't in dagre).
    const edgeMap = new Map();
    for (const e of edges) {
        const fromId = _svRedirectIfCollapsed(e.from, methods, classDims);
        const toId = _svRedirectIfCollapsed(e.to, methods, classDims);
        if (fromId === toId) continue;
        const dagreFrom = _svToCompoundId(fromId, methods, classDims);
        const dagreTo = _svToCompoundId(toId, methods, classDims);
        if (!g.hasNode(dagreFrom) || !g.hasNode(dagreTo)) continue;
        if (dagreFrom !== dagreTo) g.setEdge(dagreFrom, dagreTo);
        const sourceAccess = _svAccessGroup(byId[fromId] || byId[e.from]);
        const targetAccess = _svAccessGroup(byId[toId] || byId[e.to]);
        const id = `e|${fromId}|${toId}|${e.type}`;
        if (edgeMap.has(id)) {
            edgeMap.get(id).callCount++;
        } else {
            edgeMap.set(id, {
                id, from: fromId, to: toId, type: e.type,
                origFrom: e.from, origTo: e.to, external: false,
                sourceAccess, targetAccess, callCount: 1,
            });
        }
    }
    const modelEdges = Array.from(edgeMap.values());

    // External edges — cross-file.
    if (_svState.showExternal) {
        for (const e of extEdges) {
            const fromId = byId[e.from] ? _svRedirectIfCollapsed(e.from, methods, classDims) : e.from;
            const toId = byId[e.to] ? _svRedirectIfCollapsed(e.to, methods, classDims) : e.to;
            const dagreFrom = byId[fromId] ? _svToCompoundId(fromId, methods, classDims) : fromId;
            const dagreTo = byId[toId] ? _svToCompoundId(toId, methods, classDims) : toId;
            if (!g.hasNode(dagreFrom) || !g.hasNode(dagreTo)) continue;
            if (dagreFrom !== dagreTo) g.setEdge(dagreFrom, dagreTo);
            const sourceAccess = _svAccessGroup(byId[fromId] || byId[e.from]);
            const targetAccess = _svAccessGroup(byId[toId] || byId[e.to]);
            const id = `e|${fromId}|${toId}|${e.type}|ext`;
            const existing = modelEdges.find(x => x.id === id);
            if (existing) { existing.callCount++; }
            else {
                modelEdges.push({
                    id, from: fromId, to: toId, type: e.type,
                    origFrom: e.from, origTo: e.to, external: true,
                    sourceAccess, targetAccess, callCount: 1,
                });
            }
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
        let cursorY = clsY + _SV_CLASS_PAD_TOP;
        d.sections.forEach((section, sectionIdx) => {
            cursorY += _SV_SECTION_GAP;
            // labelY / dividerY must be relative to the class node's top-left (SVG
            // renders them inside translate(clsX, clsY), so absolute coords double-offset).
            section.labelY = cursorY - clsY;
            section.dividerY = cursorY - clsY + _SV_SECTION_DIVIDER_GAP;
            cursorY += _SV_SECTION_LABEL_H + _SV_SECTION_BODY_GAP + _SV_SECTION_DIVIDER_GAP;
            section.visibleMethods.forEach((m, methodIdx) => {
                const methodW = d.methodWidths.get(m.id) || _SV_METHOD_W;
                const relY = cursorY - clsY;
                if (!section.methodRows) section.methodRows = [];
                section.methodRows.push({
                    id: m.id,
                    sym: m,
                    kind: m.kind,
                    isMethod: true,
                    parentId: cls.id,
                    x: _SV_CLASS_INNER_LEFT,
                    y: relY,
                    w: methodW,
                    h: _SV_METHOD_H,
                });
                methodPos.set(m.id, {
                    x: clsX + _SV_CLASS_INNER_LEFT,
                    y: cursorY,
                    w: methodW,
                    h: _SV_METHOD_H,
                });
                cursorY += _SV_METHOD_H;
                if (methodIdx !== section.visibleMethods.length - 1) cursorY += _SV_METHOD_GAP;
            });
            if (sectionIdx !== d.sections.length - 1) cursorY += _SV_SECTION_SPLIT_GAP;
        });
    }

    // Collect node records with positions.
    const nodes = [];

    for (const cls of classes) {
        const info = g.node(cls.id);
        const d = classDims[cls.id];
        const offset = rootOffsets.get(cls.id) || { dx: 0, dy: 0 };
        nodes.push({
            id: cls.id,
            sym: cls,
            kind: cls.kind,
            isCompound: true,
            collapsed: d.collapsed,
            methods: d.methods,
            sections: d.sections,
            x: info.x - d.w / 2 + offset.dx,
            y: info.y - d.h / 2 + offset.dy,
            w: d.w,
            h: d.h,
            cx: info.x + offset.dx,
            cy: info.y + offset.dy,
        });
    }
    for (const m of methods) {
        const parentDim = classDims[m._parentId];
        if (!parentDim || parentDim.collapsed) continue;
        const pos = methodPos.get(m.id);
        if (!pos) continue;
        nodes.push({
            id: m.id,
            sym: m,
            kind: m.kind,
            isMethod: true,
            parentId: m._parentId,
            x: pos.x,
            y: pos.y,
            w: pos.w,
            h: pos.h,
            cx: pos.x + pos.w / 2,
            cy: pos.y + pos.h / 2,
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
            id: f.id,
            sym: f,
            kind: f.kind,
            isTopLevel: !isFocusCard,
            isField: isField,
            isFocusCard: isFocusCard,
            x: info.x - w / 2 + offset.dx,
            y: info.y - h / 2 + offset.dy,
            w, h,
            cx: info.x + offset.dx,
            cy: info.y + offset.dy,
        });
    }
    for (const gid of ghostIds) {
        const info = g.node(gid);
        const dim = ghostDims.get(gid) || { w: _SV_GHOST_W, h: _SV_GHOST_H };
        const offset = rootOffsets.get(gid) || { dx: 0, dy: 0 };
        nodes.push({
            id: gid,
            sym: byId[gid],
            kind: byId[gid].kind || 'class',
            isGhost: true,
            x: info.x - dim.w / 2 + offset.dx,
            y: info.y - dim.h / 2 + offset.dy,
            w: dim.w,
            h: dim.h,
            cx: info.x + offset.dx,
            cy: info.y + offset.dy,
        });
    }

    // Adjacency map for 1-hop focus scope.
    const adj = new Map();
    function addAdjLink(a, b) {
        if (!a || !b || a === b) return;
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a).add(b);
        adj.get(b).add(a);
    }
    for (const e of modelEdges) {
        addAdjLink(e.from, e.to);
        if (e.origFrom && e.origFrom !== e.from) {
            addAdjLink(e.origFrom, e.to);
        }
        if (e.origTo && e.origTo !== e.to) {
            addAdjLink(e.origTo, e.from);
        }
        const fromParent = methodParentById.get(e.from) || methodParentById.get(e.origFrom);
        const toParent = methodParentById.get(e.to) || methodParentById.get(e.origTo);
        addAdjLink(fromParent, e.to);
        addAdjLink(toParent, e.from);
        addAdjLink(fromParent, toParent);
    }
    // Parent-child adjacency (class ↔ its methods).
    for (const m of methods) {
        if (!adj.has(m._parentId)) adj.set(m._parentId, new Set());
        if (!adj.has(m.id)) adj.set(m.id, new Set());
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
        edges: modelEdges,
        byId,
        byNodeId,
        adj,
        extSyms,
        layoutMode: focusSym ? 'focus' : 'base',
        cameraBounds: _svComputeRectBounds(nodes, focusSym ? _SV_CAMERA_PAD : 64),
        hasFocusCard: !!(focusSym),
        focusNodeId: focusSym ? focusSym.id : null,
    };
}

function _svRedirectIfCollapsed(symId, methods, classDims) {
    const m = methods.find(x => x.id === symId);
    if (!m) return symId;
    const dim = classDims[m._parentId];
    if (dim && dim.collapsed) return m._parentId;
    if (dim && dim.visibleMethodIds && !dim.visibleMethodIds.has(symId)) return m._parentId;
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

function _svCompoundSectionRenderKey(node) {
    if (!node || !Array.isArray(node.sections)) return '';
    return node.sections.map(section => {
        const visibleIds = (section.visibleMethods || []).map(m => m.id).join(',');
        return [
            section.key,
            section.expanded ? '1' : '0',
            section.hiddenCount || 0,
            section.relatedCount || 0,
            visibleIds,
            _svSectionDisplayLabel(section),
        ].join(':');
    }).join('|');
}

function _svAnimateCameraToModel(model, token, immediate) {
    const targetZoom = _svComputeTargetZoom(model);
    if (immediate) {
        _svState.zoom.k = targetZoom.k;
        _svState.zoom.x = targetZoom.x;
        _svState.zoom.y = targetZoom.y;
        _svApplyZoom();
        return;
    }
    const start = { k: _svState.zoom.k, x: _svState.zoom.x, y: _svState.zoom.y };
    const t0 = performance.now();
    function frame(now) {
        if (token !== _svState.activeAnimationToken) return;
        const t = Math.min(1, (now - t0) / _SV_DUR_MS);
        const e = _svEase(t);
        _svState.zoom.k = start.k + (targetZoom.k - start.k) * e;
        _svState.zoom.x = start.x + (targetZoom.x - start.x) * e;
        _svState.zoom.y = start.y + (targetZoom.y - start.y) * e;
        _svApplyZoom();
        if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

function _svRenderFileGraph(newModel) {
    const svg = _svState.svg;
    const viewport = _svState.viewport;
    if (!svg || !viewport) return;

    _svCurRenderModel = newModel;
    svg.style.display = '';

    const cardsG = viewport.querySelector('.sv-cards');
    const edgesG = viewport.querySelector('.sv-edges');
    const labelsG = viewport.querySelector('.sv-edge-labels');
    const ghostsG = viewport.querySelector('.sv-ghosts');
    if (!cardsG || !edgesG || !ghostsG) return;

    // Remove any residual floating focus card from the old overlay approach.
    const oldFocusCard = viewport.querySelector('.sv-focus-detail');
    if (oldFocusCard) oldFocusCard.remove();

    // Detect file change before camera or DOM work.
    const prev = _svState.currentGraph;
    const sameFile = prev && prev.fileRel === newModel.fileRel;
    const canReusePrev = !!(sameFile && prev && prev.nodes.every(n => !n.el || n.el.isConnected));
    const animToken = ++_svState.activeAnimationToken;
    if (!canReusePrev) {
        cardsG.innerHTML = '';
        ghostsG.innerHTML = '';
        _svState.currentGraph = null;
    }
    if (!sameFile) {
        _svAnimateCameraToModel(newModel, animToken, true);
    } else {
        _svAnimateCameraToModel(newModel, animToken, false);
    }

    const oldById = new Map();
    if (canReusePrev && prev) {
        for (const n of prev.nodes) oldById.set(n.id, n);
    }

    // Diff nodes: create / update / fade-out.
    const live = new Map();
    for (const n of newModel.nodes) {
        const inlineInCompound = !!(n.parentId && newModel.byNodeId[n.parentId] && !n.isFocusCard);
        if (inlineInCompound) {
            const was = oldById.get(n.id);
            if (was && was.el && was.el.parentNode === cardsG) was.el.remove();
            live.set(n.id, {
                x0: was ? was.x : n.x,
                y0: was ? was.y : n.y,
                x1: n.x,
                y1: n.y,
                w0: was ? was.w : n.w,
                h0: was ? was.h : n.h,
                w1: n.w,
                h1: n.h,
                w: n.w,
                h: n.h,
                currentX: n.x,
                currentY: n.y,
                fadeIn: false,
                el: null,
                data: n,
                inlineInCompound: true,
            });
            continue;
        }
        const was = oldById.get(n.id);
        if (was && was.el) {
            const wasFocusCard = !!was.isFocusCard;
            const nowFocusCard = !!n.isFocusCard;
            const needRebuild = (was.isCompound !== !!n.isCompound)
                || (n.isCompound && was.collapsed !== n.collapsed)
                || (n.isCompound && _svCompoundSectionRenderKey(was) !== _svCompoundSectionRenderKey(n))
                || (was.sym && n.sym && was.sym.name !== n.sym.name)
                || (wasFocusCard !== nowFocusCard)
                || (was.w !== n.w || was.h !== n.h)
                || (n.isCompound && was.methods && n.methods && was.methods.length !== n.methods.length);
            let w0 = was.w, h0 = was.h;
            let el = was.el;
            if (needRebuild) {
                const fresh = _svCreateNodeEl(n);
                // The old element may have been an inline row nested inside a class
                // compound <g> (e.g. a method promoted to a standalone focus card).
                // Replacing in place would leave the standalone card parented to the
                // compound, rendering it far outside the class boundary. Re-home it to
                // the correct top-level group instead.
                const targetG = n.isGhost ? ghostsG : cardsG;
                if (el.parentNode === targetG) {
                    el.replaceWith(fresh);
                } else {
                    el.remove();
                    targetG.appendChild(fresh);
                }
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
            const startCx = Number.isFinite(n.enterCx) ? n.enterCx : (n.cx || (n.x + n.w / 2));
            const startCy = Number.isFinite(n.enterCy) ? n.enterCy : (n.cy || (n.y + n.h / 2));
            live.set(n.id, {
                x0: startCx - n.w / 2, y0: startCy - n.h / 2, x1: n.x, y1: n.y,
                w0: n.w, h0: n.h, w1: n.w, h1: n.h,
                w: n.w, h: n.h,
                fadeIn: true, el, data: n,
            });
        }
    }

    const exits = [];
    if (canReusePrev && prev) {
        const newIds = new Set(newModel.nodes.map(n => n.id));
        for (const o of prev.nodes) {
            if (o.parentId && newModel.byNodeId[o.parentId]) continue;
            if (!newIds.has(o.id) && o.el) {
                exits.push({ el: o.el, startOpacity: parseFloat(o.el.style.opacity) || 1 });
            }
        }
    }

    // Clear stale edges immediately — must not appear during card animation.
    edgesG.innerHTML = '';
    labelsG.innerHTML = '';

    const DUR = _SV_DUR_MS;
    const t0 = performance.now();
    function frame(now) {
        if (animToken !== _svState.activeAnimationToken) return;
        const t = Math.min(1, (now - t0) / DUR);
        const e = _svEase(t);
        for (const [, L] of live) {
            if (!L.el) {
                L.currentX = L.x1;
                L.currentY = L.y1;
                continue;
            }
            const x = L.x0 + (L.x1 - L.x0) * e;
            const y = L.y0 + (L.y1 - L.y0) * e;
            L.currentX = x;
            L.currentY = y;
            L.el.setAttribute('transform', `translate(${x},${y})`);
            if (L.fadeIn) L.el.style.opacity = String(e);
        }
        for (const X of exits) {
            X.el.style.opacity = String(X.startOpacity * (1 - e));
        }
        if (t < 1) {
            requestAnimationFrame(frame);
        } else {
            if (animToken !== _svState.activeAnimationToken) return;
            for (const X of exits) X.el.remove();
            for (const [, L] of live) {
                if (!L.el) continue;
                L.el.setAttribute('transform', `translate(${L.x1},${L.y1})`);
                L.el.style.opacity = '1';
                L.data.el = L.el;
            }
            _svState.currentGraph = newModel;
            for (const n of newModel.nodes) {
                const L = live.get(n.id);
                if (L && L.el) n.el = L.el;
            }
            cardsG.querySelectorAll('.sv-node[data-symid]').forEach(el => {
                const node = newModel.byNodeId[el.dataset.symid];
                if (!node) return;
                node.el = el;
                const L = live.get(node.id);
                if (L) L.el = el;
            });
            ghostsG.querySelectorAll('.sv-node[data-symid]').forEach(el => {
                const node = newModel.byNodeId[el.dataset.symid];
                if (!node) return;
                node.el = el;
                const L = live.get(node.id);
                if (L) L.el = el;
            });
            _svBindNodeClicks();
            _svApplyFocus({ noHistory: true });

            // Build edges at final, stable positions and fade them in.
            edgesG.innerHTML = '';
            labelsG.innerHTML = '';
            // Collect all node live-positions for obstacle-aware routing.
            const nodeRects = new Map();
            for (const [nid, L] of live) nodeRects.set(nid, L);
            for (const ed of newModel.edges) {
                const from = live.get(ed.from);
                const to = live.get(ed.to);
                if (!from || !to) continue;
                _svAppendEdge(edgesG, labelsG, ed, from, to, nodeRects);
            }
            // Re-apply the persisted edge-type + symbol-kind filters to the freshly
            // built graph and refresh the sidebar rows to match what's present here.
            _svApplyEdgeTypeFilter();
            _svApplyKindFilter();
            if (window._sv && window._sv.active) {
                if (typeof buildEdgeFilter === 'function') buildEdgeFilter();
                if (typeof buildNodeLegend === 'function') buildNodeLegend();
                if (typeof buildFtFilter === 'function') buildFtFilter();
            }
            _svApplyFocus({ noHistory: true });
            const EDGE_DUR = 220;
            const edgeT0 = performance.now();
            edgesG.style.opacity = '0';
            labelsG.style.opacity = '0';
            function edgeFade(eNow) {
                if (animToken !== _svState.activeAnimationToken) return;
                const et = Math.min(1, (eNow - edgeT0) / EDGE_DUR);
                const ee = _svEase(et);
                edgesG.style.opacity = String(ee);
                labelsG.style.opacity = String(ee);
                if (et < 1) requestAnimationFrame(edgeFade);
                else {
                    edgesG.style.opacity = '';
                    labelsG.style.opacity = '';
                }
            }
            requestAnimationFrame(edgeFade);
            if (typeof applyPendingGlobalNavRestore === 'function') {
                applyPendingGlobalNavRestore('l3');
            }
        }
    }
    requestAnimationFrame(frame);
    _svBindNodeClicks();
}

function _svFitViewport(model) {
    _svAnimateCameraToModel(model, ++_svState.activeAnimationToken, true);
}

function _svComputeTargetZoom(model) {
    const svg = _svState.svg;
    if (!svg || !model || !model.nodes.length) return { ..._svState.zoom };
    const rect = svg.getBoundingClientRect();
    const bounds = model.cameraBounds || _svComputeRectBounds(model.nodes, model.hasFocusCard ? _SV_CAMERA_PAD : 64);
    if (!bounds) return { ..._svState.zoom };
    const w = Math.max(1, bounds.maxX - bounds.minX);
    const h = Math.max(1, bounds.maxY - bounds.minY);
    const maxScale = 1.6;
    const k = Math.max(0.15, Math.min(maxScale, rect.width / w, rect.height / h));
    return {
        k,
        x: rect.width / 2 - (bounds.minX + w / 2) * k,
        y: rect.height / 2 - (bounds.minY + h / 2) * k,
    };
}

function _svComputeFitAllZoom(model, rect, margin) {
    const bounds = model.cameraBounds || _svComputeRectBounds(model.nodes, margin);
    if (!bounds) return { ..._svState.zoom };
    const w = Math.max(1, bounds.maxX - bounds.minX);
    const h = Math.max(1, bounds.maxY - bounds.minY);
    const k = Math.max(0.15, Math.min(1, rect.width / w, rect.height / h));
    return {
        k,
        x: rect.width / 2 - (bounds.minX + w / 2) * k,
        y: rect.height / 2 - (bounds.minY + h / 2) * k,
    };
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
    const metricHL = _svState.metricHighlight;
    if (edgesG) {
        edgesG.querySelectorAll('path.sv-edge').forEach(p => {
            p.classList.remove('sv-edge-in-scope', 'sv-edge-faded', 'sv-edge-selected');
            const eid = p.dataset.edgeid;
            const ed = model.edges.find(e => e.id === eid);

            // selectedEdgeId and metricHighlight apply regardless of whether a node is focused.
            const metricMatch = metricHL && ed && focusId && (
                (metricHL === 'callers' && (ed.to === focusId || ed.origTo === focusId)) ||
                (metricHL === 'callees' && (ed.from === focusId || ed.origFrom === focusId))
            );
            const selected = (ed && _svState.selectedEdgeId && eid === _svState.selectedEdgeId) || !!metricMatch;
            if (selected) {
                p.setAttribute('stroke', p.dataset.selectedColor || p.dataset.baseColor || '');
                p.style.color = p.dataset.selectedColor || p.dataset.baseColor || '';
                p.classList.add('sv-edge-selected');
            } else {
                p.setAttribute('stroke', p.dataset.baseColor || '');
                p.style.color = p.dataset.baseColor || '';
            }

            if (!focusId || !ed) return;
            const touchesFocus = (ed.from === focusId) || (ed.to === focusId)
                || (ed.origFrom === focusId) || (ed.origTo === focusId);
            if (touchesFocus) p.classList.add('sv-edge-in-scope');
            else if (inScope.has(ed.from) && inScope.has(ed.to)) p.classList.add('sv-edge-in-scope');
            else p.classList.add('sv-edge-faded');
        });
    }

    _svSyncNavBtns();
    _svApplyHideUnrelated();
}

function _svDocExcerpt(doc) {
    const lines = String(doc || '').trim().split(/\r?\n/).filter(Boolean).slice(0, 2);
    return lines.map(l => `<div>${_svEsc(l)}</div>`).join('');
}

// ── Node creation (SVG) ───────────────────────────────────────────────────
function _svNodeClass(n) {
    const kind = n.kind || 'default';
    const classes = ['sv-node', `sv-kind-${kind}`];
    if (n.isCompound) classes.push('sv-compound');
    if (n.isMethod) classes.push('sv-method');
    if (n.isMethod && n.sym) classes.push(n.sym.is_public === false ? 'sv-method-private' : 'sv-method-public');
    if (n.isTopLevel) classes.push('sv-top');
    if (n.isField) classes.push('sv-field');
    if (n.isGhost) classes.push('sv-ghost');
    if (n.isFocusCard) classes.push('sv-focus-card');
    if (n.isFocusPill) classes.push('sv-focus-pill');
    if (n.focusPillGroup) classes.push(`sv-focus-pill-${n.focusPillGroup}`);
    if (n.sym && n.sym.is_static) classes.push('sv-static');
    if (n.sym && Array.isArray(n.sym.decorators) && n.sym.decorators.includes('override')) {
        classes.push('sv-override');
    }
    return classes.join(' ');
}

function _svFocusCardMarkupLegacy(sym, opts = {}) {
    const callers = opts.callers || 0;
    const callees = opts.callees || 0;
    const lineCount = opts.lineCount || 1;
    const collapsed = opts.collapsed || _svState.detailSectionCollapsed;
    const sigHidden = collapsed.has('signature');
    const docHidden = collapsed.has('docstring');
    const metHidden = collapsed.has('metrics');
    const dotColor = _svSymDotColor(sym, opts.isMethod);
    return `
      <div xmlns="http://www.w3.org/1999/xhtml" class="sv-fd-card" style="border-color:${dotColor}">
        <div class="sv-fd-header">
          <span class="sv-kind-dot" style="background:${dotColor}"></span>
          <span class="sv-fd-name">${_svEsc(sym.name || '')}</span>
          <span class="sv-fd-kind">${_svEsc(sym.kind || '')}</span>
        </div>
        <div class="sv-fd-sub">
          ${_svEsc(sym.file || '')}${sym.line ? ':' + sym.line : ''}
          ${sym.module ? ' 繚 ' + _svEsc(sym.module) : ''}
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
            <span class="sv-fd-metric">${callers} callers</span>
            <span class="sv-fd-metric">${callees} callees</span>
          </div>
        </div>
      </div>`;
}

function _svFocusCardMarkup(sym, opts = {}) {
    const callers = opts.callers || 0;
    const callees = opts.callees || 0;
    const lineCount = opts.lineCount || 1;
    const collapsed = opts.collapsed || _svState.detailSectionCollapsed;
    const sigHidden = collapsed.has('signature');
    const docHidden = collapsed.has('docstring');
    const metHidden = collapsed.has('metrics');
    const dotColor = _svSymDotColor(sym, opts.isMethod);
    return `
      <div xmlns="http://www.w3.org/1999/xhtml" class="sv-fd-card" style="border-color:${dotColor}">
        <div class="sv-fd-header">
          <span class="sv-kind-dot" style="background:${dotColor}"></span>
          <span class="sv-fd-name">${_svEsc(sym.name || '')}</span>
          <span class="sv-fd-kind">${_svEsc(sym.kind || '')}</span>
        </div>
        <div class="sv-fd-sub">
          ${_svEsc(sym.file || '')}${sym.line ? ':' + sym.line : ''}
          ${sym.module ? ' &middot; ' + _svEsc(sym.module) : ''}
        </div>
        ${_svSymHasSig(sym) ? `
          <div class="sv-fd-section ${sigHidden ? 'sv-fd-collapsed' : ''}" data-section="signature">
            <div class="sv-fd-section-hd" data-section="signature">
              <span class="sv-fd-chev">${sigHidden ? '&#9656;' : '&#9662;'}</span>
              <span class="sv-fd-section-title">signature</span>
            </div>
            <div class="sv-fd-section-body"><code>${_svEsc(_svSymSigText(sym))}</code></div>
          </div>` : ''}
        ${sym.docstring ? `
          <div class="sv-fd-section ${docHidden ? 'sv-fd-collapsed' : ''}" data-section="docstring">
            <div class="sv-fd-section-hd" data-section="docstring">
              <span class="sv-fd-chev">${docHidden ? '&#9656;' : '&#9662;'}</span>
              <span class="sv-fd-section-title">docstring</span>
            </div>
            <div class="sv-fd-section-body">${_svDocExcerpt(sym.docstring)}</div>
          </div>` : ''}
        <div class="sv-fd-section ${metHidden ? 'sv-fd-collapsed' : ''}" data-section="metrics">
          <div class="sv-fd-section-hd" data-section="metrics">
            <span class="sv-fd-chev">${metHidden ? '&#9656;' : '&#9662;'}</span>
            <span class="sv-fd-section-title">metrics</span>
          </div>
          <div class="sv-fd-section-body">
            <span class="sv-fd-metric" data-metric="lines">${lineCount} lines</span>
            <span class="sv-fd-metric sv-fd-metric-clickable" data-metric="callers">${callers} callers</span>
            <span class="sv-fd-metric sv-fd-metric-clickable" data-metric="callees">${callees} callees</span>
            ${_svSymMetaChips(sym).map(([k, label]) => `<span class="sv-fd-metric" data-metric="${k}">${_svEsc(label)}</span>`).join('')}
          </div>
        </div>
      </div>`;
}

function _svSvgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

function _svAppendSvgText(parent, text, attrs = {}) {
    const el = _svSvgEl('text', attrs);
    el.textContent = text == null ? '' : String(text);
    parent.appendChild(el);
    return el;
}

function _svTextLines(text, maxPx, maxLines) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return [];
    const maxChars = Math.max(8, Math.floor(maxPx / _SV_CH_W));
    const words = raw.split(' ');
    const lines = [];
    let cur = '';
    for (const word of words) {
        const next = cur ? `${cur} ${word}` : word;
        if (next.length <= maxChars) {
            cur = next;
            continue;
        }
        if (cur) lines.push(cur);
        cur = word.length > maxChars ? word.slice(0, Math.max(0, maxChars - 1)) + '…' : word;
        if (lines.length >= maxLines) break;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    return lines;
}

function _svFocusCardCounts(focusId) {
    const model = _svCurRenderModel || _svState.currentGraph;
    let callers = 0, callees = 0;
    if (model) {
        for (const e of model.edges) {
            const hits = e.from === focusId || e.origFrom === focusId
                || e.to === focusId || e.origTo === focusId;
            if (!hits) continue;
            if (e.from === focusId || e.origFrom === focusId) callees++;
            else callers++;
        }
    }
    return { callers, callees };
}

function _svAppendFocusSection(g, key, title, bodyLines, y, opts = {}) {
    const collapsed = _svState.detailSectionCollapsed.has(key);
    const section = _svSvgEl('g', { class: 'sv-fd-svg-section', 'data-section': key });
    section.style.cursor = 'pointer';
    section.addEventListener('click', ev => {
        ev.stopPropagation();
        if (_svState.detailSectionCollapsed.has(key)) _svState.detailSectionCollapsed.delete(key);
        else _svState.detailSectionCollapsed.add(key);
        _svRebuildForFocus();
    });
    g.appendChild(section);

    section.appendChild(_svSvgEl('line', {
        class: 'sv-fd-svg-rule',
        x1: 12,
        y1: y,
        x2: opts.w - 12,
        y2: y,
    }));
    y += 16;
    _svAppendSvgText(section, collapsed ? '▸' : '▾', {
        class: 'sv-fd-svg-chev',
        x: 14,
        y,
    });
    _svAppendSvgText(section, title, {
        class: 'sv-fd-svg-section-title',
        x: 30,
        y,
    });
    y += 12;
    if (!collapsed) {
        for (const line of bodyLines) {
            _svAppendSvgText(section, line, {
                class: opts.mono ? 'sv-fd-svg-body sv-fd-svg-mono' : 'sv-fd-svg-body',
                x: 30,
                y,
            });
            y += 15;
        }
    }
    return y + 4;
}

function _svCreateFocusCardEl(n) {
    const g = _svSvgEl('g', { class: _svNodeClass(n), transform: `translate(${n.x},${n.y})` });
    g.dataset.symid = n.id;

    const sym = n.sym || {};
    const focusId = n.id;
    const { callers, callees } = _svFocusCardCounts(focusId);
    const lineCount = Math.max(1, (sym.end_line || sym.line || 1) - (sym.line || 1) + 1);
    const dotColor = _svSymDotColor(sym, n.isMethod);

    const rect = _svSvgEl('rect', {
        class: 'sv-node-bg sv-fd-svg-bg',
        x: 0,
        y: 0,
        width: n.w,
        height: n.h,
        rx: 10,
    });
    rect.style.stroke = dotColor;
    g.appendChild(rect);

    g.appendChild(_svSvgEl('circle', {
        class: 'sv-node-dot',
        cx: 18,
        cy: 20,
        r: 4,
        fill: dotColor,
    }));
    _svAppendSvgText(g, _svClipText(sym.name || '', n.w - 92), {
        class: 'sv-fd-svg-name',
        x: 30,
        y: 25,
    });
    _svAppendSvgText(g, (sym.kind || '').toUpperCase(), {
        class: 'sv-fd-svg-kind',
        x: n.w - 12,
        y: 24,
        'text-anchor': 'end',
    });

    const sub = `${sym.file || ''}${sym.line ? ':' + sym.line : ''}${sym.module ? ' · ' + sym.module : ''}`;
    _svAppendSvgText(g, _svClipText(sub, n.w - 24), {
        class: 'sv-fd-svg-sub',
        x: 12,
        y: 48,
    });

    let y = 66;
    const maxBodyW = n.w - 48;
    if (_svSymHasSig(sym)) {
        y = _svAppendFocusSection(
            g,
            'signature',
            'SIGNATURE',
            _svTextLines(_svSymSigText(sym), maxBodyW, 3),
            y,
            { w: n.w, mono: true }
        );
    }
    if (sym.docstring) {
        y = _svAppendFocusSection(
            g,
            'docstring',
            'DOCSTRING',
            _svTextLines(sym.docstring, maxBodyW, 3),
            y,
            { w: n.w, mono: false }
        );
    }
    const metricsStartY = y;
    const metricsBody = [`${lineCount} lines   ${callers} callers   ${callees} callees`];
    const metaChips = _svSymMetaChips(sym);
    if (metaChips.length) metricsBody.push(metaChips.map(([, label]) => label).join('   ·   '));
    y = _svAppendFocusSection(
        g,
        'metrics',
        'METRICS',
        metricsBody,
        metricsStartY,
        { w: n.w, mono: false }
    );

    // Hit-rects anchor to the first metrics body line (stable regardless of the
    // optional second extras line), matching the legacy single-line offset.
    const metricHitY = Math.max(80, metricsStartY + 19);
    const metricHits = [
        { key: 'callers', x: 110, y: metricHitY, w: 70 },
        { key: 'callees', x: 184, y: metricHitY, w: 70 },
    ];
    for (const hit of metricHits) {
        const h = _svSvgEl('rect', {
            class: 'sv-fd-svg-hit',
            x: hit.x,
            y: hit.y,
            width: hit.w,
            height: 20,
            rx: 10,
            'data-metric': hit.key,
        });
        h.addEventListener('click', ev => {
            ev.stopPropagation();
            _svState.metricHighlight = _svState.metricHighlight === hit.key ? null : hit.key;
            _svApplyFocus();
        });
        g.appendChild(h);
    }
    return g;
}

function _svCreateInlineMethodEl(row) {
    const NS = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', _svNodeClass(row));
    g.dataset.symid = row.id;
    g.setAttribute('transform', `translate(${row.x},${row.y})`);

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('class', 'sv-node-bg');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(row.w));
    rect.setAttribute('height', String(row.h));
    rect.setAttribute('rx', '15');
    g.appendChild(rect);

    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('class', 'sv-node-dot');
    dot.setAttribute('cx', '14');
    dot.setAttribute('cy', String(row.h / 2));
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', _svSymDotColor(row.sym, true));
    g.appendChild(dot);

    const name = document.createElementNS(NS, 'text');
    name.setAttribute('class', 'sv-node-name sv-mono');
    name.setAttribute('x', '24');
    name.setAttribute('y', String(row.h / 2));
    name.setAttribute('dominant-baseline', 'middle');
    name.textContent = _svClipText(row.sym && row.sym.name, row.w - 38);
    g.appendChild(name);

    return g;
}

function _svCreateNodeEl(n) {
    if (n.isFocusCard) return _svCreateFocusCardEl(n);

    const NS = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', _svNodeClass(n));
    g.dataset.symid = n.id;
    g.setAttribute('transform', `translate(${n.x},${n.y})`);

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('class', 'sv-node-bg');
    rect.setAttribute('x', '0'); rect.setAttribute('y', '0');
    rect.setAttribute('width', String(n.w));
    rect.setAttribute('height', String(n.h));
    rect.setAttribute('rx', n.isField ? '14' : n.isCompound ? '10' : (n.isMethod || n.isFocusPill) ? '15' : '8');
    if (n.isGhost) {
        // Ghost node backgrounds are nearly transparent in CSS (rgba(...,0.05)),
        // which lets edge lines show through even though sv-ghosts is a higher
        // z-layer. Override fill inline with enough opacity to occlude edges.
        rect.style.fill = 'var(--sv-ghost-bg, #141e30)';
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
    // Accent bar — shown only on ghost (external) nodes
    if (n.isGhost) g.appendChild(bar);

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
        nameEl.textContent = _svClipText(sym.name, n.w - 108);
        g.appendChild(nameEl);

        const kindEl = document.createElementNS(NS, 'text');
        kindEl.setAttribute('class', 'sv-node-kind');
        kindEl.setAttribute('x', String(n.w - 10)); kindEl.setAttribute('y', '20');
        kindEl.setAttribute('text-anchor', 'end');
        kindEl.style.fill = _svKindColor(sym.kind);   // tint the kind label by kind
        kindEl.textContent = (sym.kind || '').toUpperCase();
        g.appendChild(kindEl);

        if (!n.collapsed && n.sections && n.sections.length) {
            for (const section of n.sections) {
                const hot = document.createElementNS(NS, 'rect');
                hot.setAttribute('class', 'sv-section-toggle-hit');
                hot.setAttribute('x', String(_SV_CLASS_INNER_LEFT - 6));
                hot.setAttribute('y', String(section.labelY - 3));
                hot.setAttribute('width', String(n.w - _SV_CLASS_INNER_LEFT * 2 + 12));
                hot.setAttribute('height', String(_SV_SECTION_LABEL_H + 8));
                hot.setAttribute('rx', '7');
                hot.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    _svToggleCompoundSection(n.id, section.key);
                });
                g.appendChild(hot);

                const labelEl = document.createElementNS(NS, 'text');
                labelEl.setAttribute('class', `sv-section-label sv-section-label-${section.key}`);
                labelEl.setAttribute('x', String(_SV_CLASS_INNER_LEFT));
                labelEl.setAttribute('y', String(section.labelY));
                labelEl.setAttribute('dominant-baseline', 'hanging');
                labelEl.textContent = _svSectionDisplayLabel(section);
                g.appendChild(labelEl);

                const lineX = _SV_CLASS_INNER_LEFT + _svMeasureText(_svSectionDisplayLabel(section), 10) + 12;
                const divider = document.createElementNS(NS, 'line');
                divider.setAttribute('class', `sv-section-divider sv-section-divider-${section.key}`);
                divider.setAttribute('x1', String(lineX));
                divider.setAttribute('y1', String(section.dividerY));
                divider.setAttribute('x2', String(n.w - 16));
                divider.setAttribute('y2', String(section.dividerY));
                g.appendChild(divider);

                for (const row of (section.methodRows || [])) {
                    g.appendChild(_svCreateInlineMethodEl(row));
                }
            }
        }

        // Collapse/expand chip for the compound class methods
        if (n.methods && n.methods.length) {
            const chip = document.createElementNS(NS, 'g');
            chip.setAttribute('class', 'sv-compound-toggle');
            chip.setAttribute('transform', `translate(${n.w - 32}, 34)`);
            chip.dataset.classid = n.id;
            const chipHalo = document.createElementNS(NS, 'rect');
            chipHalo.setAttribute('class', 'sv-compound-toggle-halo');
            chipHalo.setAttribute('x', '-24'); chipHalo.setAttribute('y', '-14');
            chipHalo.setAttribute('width', '48'); chipHalo.setAttribute('height', '28');
            chipHalo.setAttribute('rx', '14');
            chip.appendChild(chipHalo);
            const chipBg = document.createElementNS(NS, 'rect');
            chipBg.setAttribute('x', '-21'); chipBg.setAttribute('y', '-11');
            chipBg.setAttribute('width', '42'); chipBg.setAttribute('height', '22');
            chipBg.setAttribute('rx', '11');
            chip.appendChild(chipBg);
            const chipTx = document.createElementNS(NS, 'text');
            chipTx.setAttribute('x', '0'); chipTx.setAttribute('y', '5');
            chipTx.setAttribute('text-anchor', 'middle');
            chipTx.textContent = n.collapsed
                ? `+${n.methods.length}`
                : `−${n.methods.length}`;
            chip.appendChild(chipTx);
            if (!n.collapsed) chipTx.textContent = `-${n.methods.length}`;
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
    } else if (n.isFocusPill) {
        const pillRect = g.querySelector('.sv-node-bg');
        if (pillRect) pillRect.setAttribute('rx', '15');

        const name = document.createElementNS(NS, 'text');
        name.setAttribute('class', 'sv-node-name sv-mono sv-pill-name');
        name.setAttribute('x', String(n.w / 2));
        name.setAttribute('y', String(n.h / 2));
        name.setAttribute('dominant-baseline', 'middle');
        name.setAttribute('text-anchor', 'middle');
        name.textContent = _svClipText(sym.name, n.w - 20);
        g.appendChild(name);
    } else if (n.isMethod) {
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('class', 'sv-node-dot');
        dot.setAttribute('cx', '14'); dot.setAttribute('cy', String(n.h / 2));
        dot.setAttribute('r', '4');
        dot.setAttribute('fill', _svSymDotColor(n.sym, n.isMethod));
        g.appendChild(dot);

        const name = document.createElementNS(NS, 'text');
        name.setAttribute('class', 'sv-node-name sv-mono');
        name.setAttribute('x', '24'); name.setAttribute('y', String(n.h / 2));
        name.setAttribute('dominant-baseline', 'middle');
        name.textContent = _svClipText(sym.name, n.w - 38);
        g.appendChild(name);
    } else {
        // Top-level function or field
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('class', 'sv-node-dot');
        dot.setAttribute('cx', '14'); dot.setAttribute('cy', String(n.h / 2));
        dot.setAttribute('r', '5');
        dot.setAttribute('fill', _svSymDotColor(n.sym, n.isMethod));
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
        kindEl.style.fill = _svKindColor(sym.kind);   // tint the kind label by kind
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
function _svAppendEdge(edgesG, labelsG, ed, from, to, nodeRects) {
    const NS = 'http://www.w3.org/2000/svg';
    const fromNode = from.data || {};
    const toNode = to.data || {};
    const forcedFromSide = (fromNode.isMethod || fromNode.isFocusPill) ? 'right' : null;
    const forcedToSide = (toNode.isMethod || toNode.isFocusPill) ? 'left' : null;
    const fromBox = { x: from.currentX + from.w / 2, y: from.currentY + from.h / 2, w: from.w, h: from.h };
    const toBox = { x: to.currentX + to.w / 2, y: to.currentY + to.h / 2, w: to.w, h: to.h };
    const endpoints = _svComputeEndpoints(fromBox, toBox, forcedFromSide, forcedToSide);
    // Build obstacle list for routing: every node except the two endpoints.
    const obstacles = [];
    if (nodeRects) {
        const skipObstacles = new Set([ed.from, ed.to]);
        if (fromNode.parentId) skipObstacles.add(fromNode.parentId);
        if (toNode.parentId) skipObstacles.add(toNode.parentId);
        for (const [nid, nr] of nodeRects) {
            if (skipObstacles.has(nid)) continue;
            obstacles.push({ x: nr.currentX, y: nr.currentY, w: nr.w, h: nr.h });
        }
    }
    const color = _svResolveEdgeStroke(ed, from);
    const selectedColor = _svResolveSelectedEdgeStroke(ed, from);
    const { path: pathData, mx: edgeMx, my: edgeMy } = _svBuildEdgePath(endpoints, obstacles);

    function bindEdgeEvents(el) {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            _svHandleEdgeClick(ed);
        });
        el.addEventListener('mouseenter', (e) => _svShowEdgeTip(e, ed));
        el.addEventListener('mousemove', (e) => _svMoveEdgeTip(e));
        el.addEventListener('mouseleave', () => _svHideEdgeTip());
    }

    const hitPath = document.createElementNS(NS, 'path');
    hitPath.setAttribute('class', 'sv-edge-hit');
    hitPath.dataset.edgeid = ed.id;
    hitPath.setAttribute('d', pathData);
    hitPath.setAttribute('stroke', 'transparent');
    hitPath.setAttribute('stroke-width', ed.external ? '14' : '16');
    hitPath.setAttribute('fill', 'none');
    hitPath.setAttribute('pointer-events', 'stroke');
    bindEdgeEvents(hitPath);
    edgesG.appendChild(hitPath);

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', `sv-edge sv-edge-${ed.type}` + (ed.external ? ' sv-edge-external' : ''));
    path.dataset.edgeid = ed.id;
    path.dataset.baseColor = color;
    path.dataset.selectedColor = selectedColor;
    if (ed.sourceAccess) path.dataset.sourceAccess = ed.sourceAccess;
    if (ed.targetAccess) path.dataset.targetAccess = ed.targetAccess;
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', ed.external ? '1.4' : '1.85');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#sv-arrow)');
    path.setAttribute('pointer-events', 'none');  // hit area is the invisible hitPath
    if (ed.external) path.setAttribute('stroke-dasharray', '5 3');
    path.style.color = color;
    edgesG.appendChild(path);

    if (ed.callCount > 1 && labelsG) {
        const lbl = document.createElementNS(NS, 'text');
        lbl.setAttribute('class', 'sv-edge-count');
        lbl.dataset.edgeid = ed.id;
        lbl.setAttribute('x', String(edgeMx));
        lbl.setAttribute('y', String(edgeMy - 7));
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('pointer-events', 'none');
        lbl.textContent = `×${ed.callCount}`;
        labelsG.appendChild(lbl);
    }
}

function _svComputeEndpoints(from, to, forcedFromSide, forcedToSide) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const fromSide = forcedFromSide || (absDx > absDy ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top'));
    const toSide = forcedToSide || (absDx > absDy ? (dx > 0 ? 'left' : 'right') : (dy > 0 ? 'top' : 'bottom'));
    const sx = from.x + _svSideOffsetX(fromSide, from.w);
    const sy = from.y + _svSideOffsetY(fromSide, from.h);
    const ex = to.x + _svSideOffsetX(toSide, to.w);
    const ey = to.y + _svSideOffsetY(toSide, to.h);
    return { sx, sy, ex, ey, fromSide, toSide };
}
function _svSideOffsetX(side, w) {
    if (side === 'left') return -w / 2;
    if (side === 'right') return w / 2;
    return 0;
}
function _svSideOffsetY(side, h) {
    if (side === 'top') return -h / 2;
    if (side === 'bottom') return h / 2;
    return 0;
}
function _svBuildEdgePath(endpoints, obstacles) {
    const style = (typeof _PREFS !== 'undefined') ? _PREFS.get('svEdgeStyle') : 'bezier';
    if (style === 'orthogonal') return _svBuildOrthogonalPath(endpoints, obstacles);
    return _svBuildBezierPath(endpoints);
}

function _svBuildBezierPath({ sx, sy, ex, ey, fromSide, toSide }) {
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const curve = Math.min(120, Math.max(32, dist * 0.35));
    let cx1 = sx, cy1 = sy, cx2 = ex, cy2 = ey;
    if (fromSide === 'left') cx1 = sx - curve;
    if (fromSide === 'right') cx1 = sx + curve;
    if (fromSide === 'top') cy1 = sy - curve;
    if (fromSide === 'bottom') cy1 = sy + curve;
    if (toSide === 'left') cx2 = ex - curve;
    if (toSide === 'right') cx2 = ex + curve;
    if (toSide === 'top') cy2 = ey - curve;
    if (toSide === 'bottom') cy2 = ey + curve;
    // Cubic bezier midpoint at t=0.5
    const mx = 0.125 * sx + 0.375 * cx1 + 0.375 * cx2 + 0.125 * ex;
    const my = 0.125 * sy + 0.375 * cy1 + 0.375 * cy2 + 0.125 * ey;
    return { path: `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${ex} ${ey}`, mx, my };
}

// ── Orthogonal routing with obstacle avoidance ──────────
// Routing: H → clear vertical bus → H with rounded corners (R=14).
// The bus X is chosen to avoid all obstacle node rects.
function _svBuildOrthogonalPath({ sx, sy, ex, ey }, obstacles) {
    const R = 14;   // corner rounding radius (larger = smoother)
    const CLEAR = 14;   // clearance padding around obstacle rects

    const yLo = Math.min(sy, ey);
    const yHi = Math.max(sy, ey);

    // Nearly flat — straight line, no elbow needed.
    if (Math.abs(ey - sy) < 2) {
        return { path: `M ${sx} ${sy} H ${ex}`, mx: (sx + ex) / 2, my: sy };
    }

    // ── Candidate bus X positions ────────────────────────────────────
    // Try: midpoint first, then left/right edges of every obstacle.
    // Sort by proximity to midpoint so routing stays natural.
    const midX = (sx + ex) / 2;
    const cands = new Set();
    cands.add(midX);
    if (obstacles) {
        for (const o of obstacles) {
            cands.add(o.x - CLEAR - R);
            cands.add(o.x + o.w + CLEAR + R);
        }
    }
    // For back-edges (ex < sx), also try far-right beyond all nodes.
    const lo = Math.min(sx, ex);
    const hi = Math.max(sx, ex);
    if (ex < sx && obstacles && obstacles.length) {
        const farRight = Math.max(...obstacles.map(o => o.x + o.w), sx) + CLEAR + R * 2;
        cands.add(farRight);
    }

    // Check whether a vertical line at bx clears all obstacles.
    function busXClear(bx) {
        if (!obstacles || !obstacles.length) return true;
        for (const o of obstacles) {
            if (bx <= o.x - CLEAR || bx >= o.x + o.w + CLEAR) continue;
            if (yHi <= o.y - CLEAR || yLo >= o.y + o.h + CLEAR) continue;
            return false;
        }
        return true;
    }

    // Prefer candidates inside [lo, hi]; fallback to outside.
    const inside = [...cands].filter(x => x > lo + R && x < hi - R)
        .sort((a, b) => Math.abs(a - midX) - Math.abs(b - midX));
    const outside = [...cands].filter(x => x <= lo + R || x >= hi - R)
        .sort((a, b) => Math.abs(a - midX) - Math.abs(b - midX));

    let busX = midX;
    for (const c of [...inside, ...outside]) {
        if (busXClear(c)) { busX = c; break; }
    }

    // ── Build path ───────────────────────────────────────────────
    // Shape: sx → busX (H), elbow (Q), ey level (V), elbow (Q), ex (H).
    const goDown = ey >= sy;
    const vs = goDown ? R : -R;   // vertical sign for arc tangent

    const path = [
        `M ${sx} ${sy}`,
        `H ${busX - R}`,
        `Q ${busX} ${sy} ${busX} ${sy + vs}`,
        `V ${ey - vs}`,
        `Q ${busX} ${ey} ${busX + R} ${ey}`,
        `H ${ex}`,
    ].join(' ');

    return { path, mx: busX, my: (sy + ey) / 2 };
}


// ── Edge tooltip (reused from V2 Feature 5) ──────────────────────────────
function _svShowEdgeTip(e, ed) {
    const tip = document.getElementById('sv-edge-tip');
    if (!tip) return;
    const accessSummary = _svEdgeAccessSummary(ed);
    tip.innerHTML = `<span class="sv-tip-type" style="color:${_svResolveEdgeStroke(ed)}">${_svEsc(ed.type)}</span>
        ${accessSummary ? `<div class="sv-tip-access">${_svEsc(accessSummary)}</div>` : ''}
        ${ed.external ? '<span class="sv-tip-sites">cross-file</span>' : ''}
        <div class="sv-tip-hint">Click to jump or switch file</div>`;
    tip.hidden = false;
    _svMoveEdgeTip(e);
}
function _svMoveEdgeTip(e) {
    const tip = document.getElementById('sv-edge-tip');
    if (!tip || tip.hidden) return;
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
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
            // Nested member rows live inside class cards; stop before the class handles it.
            e.stopPropagation();
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

    if (node.isCompound || _svIsCompoundSymbol(node.sym)) {
        if (!isGlobalNavRestoring()) pushGlobalNavSnapshot('sv-compound-toggle');
        _svOpenCompoundInline(symId, { toggle: true });
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
    if (!isGlobalNavRestoring()) pushGlobalNavSnapshot('sv-node-focus');
    _svState.focusId = symId;
    _svState.detailSectionCollapsed.clear();
    _svState.edgeJumpCursor.clear();
    _svState.selectedEdgeId = null;
    _svState.metricHighlight = null;
    _svRebuildForFocus();
}

async function _svHandleEdgeClick(ed) {
    if (!ed) return;
    const model = _svState.currentGraph;
    if (!model) return;
    if (!isGlobalNavRestoring()) pushGlobalNavSnapshot('sv-edge');
    _svState.selectedEdgeId = ed.id || null;
    _svApplyFocus();

    const sourceId = ed.origFrom || ed.from;
    const targetId = ed.origTo || ed.to;
    const sNode = model.byNodeId[sourceId];
    const tNode = model.byNodeId[targetId];
    const sourceSym = (sNode && sNode.sym) || model.byId[sourceId] || null;
    const targetSym = (tNode && tNode.sym) || model.byId[targetId] || null;

    if (sourceSym && sourceSym.file && typeof loadFileInPanel === 'function') {
        await loadFileInPanel(sourceSym.file, null);
        if (sourceSym.name && typeof jumpToFunc === 'function') {
            requestAnimationFrame(() => jumpToFunc(sourceSym.name, targetSym && targetSym.name ? targetSym.name : null));
            return;
        }
        if (sourceSym.line && typeof jumpToLine === 'function') {
            requestAnimationFrame(() => jumpToLine(sourceSym.line));
            return;
        }
    }

    if (tNode && tNode.isGhost) {
        symViewActivate(targetId);
        return;
    }
    if (targetSym && targetSym.file && typeof loadFileInPanel === 'function') {
        await loadFileInPanel(targetSym.file, null);
        if (targetSym.line && typeof jumpToLine === 'function') {
            requestAnimationFrame(() => jumpToLine(targetSym.line));
            return;
        }
    }
    if (tNode) {
        _svHandleNodeClick(targetId);
    }
}

// Compound class toggle (expand/collapse methods)
function _svToggleCompound(classId) {
    _svOpenCompoundInline(classId, { toggle: true });
}

function _svExpandAll() {
    _svState.compoundCollapsed.clear();
    _svState.compoundSectionExpanded.clear();
    const model = _svState.currentGraph;
    if (model) {
        for (const n of model.nodes) {
            if (!n.isCompound || !Array.isArray(n.sections) || !n.sections.length) continue;
            // Accordion invariant: at most one section open per class (the first / PUBLIC).
            const first = n.sections[0];
            if (first && first.key) _svState.compoundSectionExpanded.add(_svSectionKey(n.id, first.key));
        }
    }
    if (_svState.fileRel) _svLoadFileGraph(_svState.fileRel, { pendingFocus: _svState.focusId });
}

function _svCollapseAll() {
    _svState.compoundSectionExpanded.clear();
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

// ── Focus-only filter (hides unrelated nodes/edges when a node is focused) ─
// Completely independent of the opacity-based focus system. Uses display:none
// via CSS class sv-hidden-by-filter so it never conflicts with _svApplyFocus.

function _svToggleHideUnrelated() {
    if (!_svState.focusId) return;
    _svState.hideUnrelated = !_svState.hideUnrelated;
    const btn = document.getElementById('sv-hide-unrelated-btn');
    if (btn) btn.classList.toggle('sv-btn-active', _svState.hideUnrelated);
    _svApplyHideUnrelated();
}

function _svApplyHideUnrelated() {
    const model = _svState.currentGraph;
    const viewport = _svState.viewport;
    if (!model || !viewport) return;

    const focusId = _svState.focusId;

    // Auto-reset when no focus
    if (!focusId && _svState.hideUnrelated) {
        _svState.hideUnrelated = false;
        const btn = document.getElementById('sv-hide-unrelated-btn');
        if (btn) btn.classList.remove('sv-btn-active');
    }

    const active = !!_svState.hideUnrelated && !!focusId;

    // Compute 1-hop scope from focus node
    let inScope = new Set();
    if (active) {
        const dist = _svBfsDistances(model.adj, focusId);
        for (const [id, d] of dist) {
            if (d <= 1) inScope.add(id);
        }
    }

    // Hide/show nodes
    for (const n of model.nodes) {
        if (!n.el) continue;
        n.el.classList.toggle('sv-hidden-by-filter', active && !inScope.has(n.id));
    }

    // Hide/show edges (both visible path and hit-area path)
    const edgesG = viewport.querySelector('.sv-edges');
    if (edgesG) {
        edgesG.querySelectorAll('[data-edgeid]').forEach(p => {
            const eid = p.dataset.edgeid;
            const ed = model.edges.find(e => e.id === eid);
            if (!active || !ed) { p.classList.remove('sv-hidden-by-filter'); return; }
            const touchesFocus = ed.from === focusId || ed.to === focusId
                || ed.origFrom === focusId || ed.origTo === focusId;
            const edgeInScope = touchesFocus || (inScope.has(ed.from) && inScope.has(ed.to));
            p.classList.toggle('sv-hidden-by-filter', !edgeInScope);
        });
    }

    // Hide/show edge count labels
    const labelsG = viewport.querySelector('.sv-edge-labels');
    if (labelsG) {
        labelsG.querySelectorAll('.sv-edge-count').forEach(el => {
            el.classList.toggle('sv-hidden-by-filter', active);
        });
    }
}

// ── Edge-type filter (sidebar Filters tab → hide/show L3 edges by type) ──────
// Mirrors the L1/L2 edge filters but drives the L3 SVG canvas. The hidden set
// lives in _svState.hiddenEdgeTypes and persists across files/focus changes,
// like the L1/L2 filters. Uses its own CSS class (sv-hidden-by-edgetype) so it
// composes with the focus-only "hide unrelated" filter (sv-hidden-by-filter).
const _SV_EDGE_TYPE_DEFS = [
    { key: 'call',        label: 'Calls' },
    { key: 'inheritance', label: 'Inheritance' },
    { key: 'implements',  label: 'Implements' },
    { key: 'mixin_include', label: 'Mixin Include' },
    { key: 'mixin_extend',  label: 'Mixin Extend' },
    { key: 'mixin_prepend', label: 'Mixin Prepend' },
    { key: 'behaviour_impl', label: 'Behaviour Impl' },
    { key: 'protocol_impl',  label: 'Protocol Impl' },
    { key: 'override',    label: 'Override' },
    { key: 'type_usage',  label: 'Type Usage' },
    { key: 'member',      label: 'Member' },
    { key: 'import',      label: 'Import' },
    { key: 'include',     label: 'Include' },
];

// Ordered {key,label,color} defs for edge types actually present in the current
// file graph — consumed by the sidebar to build interactive filter rows.
function _svPresentEdgeTypeDefs() {
    const model = _svState.currentGraph;
    if (!model || !Array.isArray(model.edges)) return [];
    const present = new Set();
    for (const e of model.edges) if (e && e.type) present.add(e.type);
    const defs = [];
    const seen = new Set();
    for (const d of _SV_EDGE_TYPE_DEFS) {
        if (present.has(d.key)) { defs.push({ ...d, color: _svEdgeColor(d.key) }); seen.add(d.key); }
    }
    // Any present type not in the canonical list → append with its raw key.
    for (const t of present) {
        if (!seen.has(t)) defs.push({ key: t, label: t, color: _svEdgeColor(t) });
    }
    return defs;
}

// Re-apply _svState.hiddenEdgeTypes to the rendered edges + count labels.
// Idempotent: re-reads the DOM each call, so it's safe to invoke after every
// render and on each sidebar toggle.
function _svApplyEdgeTypeFilter() {
    const model = _svState.currentGraph;
    const viewport = _svState.viewport;
    if (!model || !viewport) return;
    const hidden = _svState.hiddenEdgeTypes;
    const typeById = new Map();
    for (const e of model.edges) typeById.set(e.id, e.type);

    const edgesG = viewport.querySelector('.sv-edges');
    if (edgesG) {
        edgesG.querySelectorAll('[data-edgeid]').forEach(p => {
            const t = typeById.get(p.dataset.edgeid);
            p.classList.toggle('sv-hidden-by-edgetype', !!t && hidden.has(t));
        });
    }
    const labelsG = viewport.querySelector('.sv-edge-labels');
    if (labelsG) {
        labelsG.querySelectorAll('.sv-edge-count').forEach(el => {
            const t = typeById.get(el.dataset.edgeid);
            el.classList.toggle('sv-hidden-by-edgetype', !!t && hidden.has(t));
        });
    }
}

// Ordered {key,label,color} defs for the symbol kinds present in the current
// file graph — consumed by the sidebar to build the L3 "Node Colors" legend.
// Mirrors _svPresentEdgeTypeDefs but for node kinds.
function _svPresentKindDefs() {
    const model = _svState.currentGraph;
    if (!model || !Array.isArray(model.nodes)) return [];
    const present = new Set();
    for (const n of model.nodes) {
        if (!n || n.isFocusCard) continue;          // focus card mirrors a real node
        const k = n.kind;
        if (k) present.add(k);
    }
    const defs = [];
    for (const k of present) {
        defs.push({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1), color: _svKindColor(k) });
    }
    // Stable, readable order: by label.
    defs.sort((a, b) => a.label.localeCompare(b.label));
    return defs;
}

// Re-apply _svState.hiddenKinds to the rendered nodes + the edges touching them.
// Mirrors _svApplyEdgeTypeFilter but for node kinds. Uses its own CSS class
// (sv-hidden-by-kind) so it composes with the focus-only "hide unrelated" filter
// and the edge-type filter. Idempotent — safe to call after every render.
function _svApplyKindFilter() {
    const model = _svState.currentGraph;
    const viewport = _svState.viewport;
    if (!model || !viewport) return;
    const hidden = _svState.hiddenKinds;

    // Hide/show nodes whose kind is filtered out (skip the focus card mirror).
    const kindById = new Map();
    for (const n of model.nodes) {
        kindById.set(n.id, n.kind);
        if (!n.el || n.isFocusCard) continue;
        n.el.classList.toggle('sv-hidden-by-kind', !!n.kind && hidden.has(n.kind));
    }

    // An edge is hidden when either endpoint's kind is hidden.
    const edgeHidden = (ed) => {
        const kf = kindById.get(ed.from), kt = kindById.get(ed.to);
        return (!!kf && hidden.has(kf)) || (!!kt && hidden.has(kt));
    };
    const edgesG = viewport.querySelector('.sv-edges');
    if (edgesG) {
        const edgeById = new Map();
        for (const e of model.edges) edgeById.set(e.id, e);
        edgesG.querySelectorAll('[data-edgeid]').forEach(p => {
            const ed = edgeById.get(p.dataset.edgeid);
            p.classList.toggle('sv-hidden-by-kind', !!ed && edgeHidden(ed));
        });
        const labelsG = viewport.querySelector('.sv-edge-labels');
        if (labelsG) {
            labelsG.querySelectorAll('.sv-edge-count').forEach(el => {
                const ed = edgeById.get(el.dataset.edgeid);
                el.classList.toggle('sv-hidden-by-kind', !!ed && edgeHidden(ed));
            });
        }
    }
}

// Cross-module: viz_sidebar.js reads present defs + re-applies the filters.
window._svPresentEdgeTypeDefs = _svPresentEdgeTypeDefs;
window._svApplyEdgeTypeFilter = _svApplyEdgeTypeFilter;
window._svPresentKindDefs = _svPresentKindDefs;
window._svApplyKindFilter = _svApplyKindFilter;
