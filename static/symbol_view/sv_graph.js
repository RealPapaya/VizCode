// ── Symbol View — Graph renderer (SVG + requestAnimationFrame tween) ────
//   5-direction layout:
//   center | up = base class (parent)          | down = derived class (child)
//          | left = incoming (callers)         | right = outgoing (callees)
// Class members render inside the center card. Animated keyed enter/update/exit.

'use strict';

// ── Layout constants ──────────────────────────────────────────────────────
const _SV_CARD_MIN_W   = 280;
const _SV_CARD_MAX_W   = 420;
const _SV_CARD_PAD_X   = 16;
const _SV_CARD_PAD_TOP = 68;    // header + section-chip row
const _SV_CARD_PAD_BOT = 14;
const _SV_MEMBER_H     = 26;
const _SV_MEMBER_GAP   = 2;
const _SV_COLUMN_GAP   = 14;    // gap between public/private columns in two-column mode
const _SV_TWO_COL_TRIGGER = 8;  // switch to two-column layout above this total member count
const _SV_TWO_COL_MIN_SIDE = 3; // both public and private need at least this many members
const _SV_COL_MIN_W    = 180;   // single column min width in two-column mode
const _SV_PILL_H       = 40;
const _SV_PILL_PAD_X   = 14;
const _SV_NEIGHBOR_GAP_V = 56;  // vertical spacing between stacked neighbors
const _SV_NEIGHBOR_GAP_H = 160; // horizontal spread for up/down rows
const _SV_MARGIN_LR    = 300;   // distance from center card edge to left/right neighbors
const _SV_MARGIN_TB    = 110;   // distance from center card edge to up/down neighbors
const _SV_MAX_PER_SIDE = 24;
const _SV_EXPAND_GAP   = 220;   // extra distance from primary pill to its own expansions

// Approximate character width for monospace rendering.
const _SV_CH_W = 7.1;

function _svMeasureText(s, fontSize = 13) {
    // Simple measurement: use char count × approx width scaled by font size.
    const w = String(s || '').length * (_SV_CH_W * (fontSize / 13));
    return Math.ceil(w);
}

function _svPillWidthFor(entry) {
    return Math.min(_SV_CARD_MAX_W, Math.max(140, _svMeasureText(entry.name, 13) + _SV_PILL_PAD_X * 2 + 24));
}

// ── Entry: fetch + render ─────────────────────────────────────────────────
// opts.preserveView = true keeps the current pan/zoom (used for collapse toggles
// and other in-place re-renders where jumping back to (0,0) would be disorienting).
async function _svFetchAndRender(symId, opts) {
    const ov  = document.getElementById('sv-overview');
    const svg = _svState.svg;
    const empty = document.getElementById('sv-empty');
    if (ov) ov.hidden = true;
    if (svg) svg.style.display = '';
    if (empty) empty.hidden = true;

    const jid = _svState.jobId || window.JOB_ID;
    if (!jid) return;

    _svShowLoading(true);
    try {
        const resp = await fetch(`/symbol-graph?job=${encodeURIComponent(jid)}&sym=${encodeURIComponent(symId)}`);
        const data = await resp.json();
        if (data && !data.error) {
            const model = _svBuildModel(data);
            _svUpdateBreadcrumb(data.center);
            _svRenderModel(model, opts);
        } else if (empty) {
            empty.hidden = false;
        }
    } catch (err) {
        // Show empty placeholder on failure
        if (empty) {
            empty.hidden = false;
            empty.querySelector('.sv-empty-msg').textContent = 'Failed to load symbol graph';
        }
    } finally {
        _svShowLoading(false);
    }
}

function _svShowLoading(on) {
    const tb = document.getElementById('sv-breadcrumb');
    if (!tb) return;
    if (on) tb.classList.add('sv-loading');
    else    tb.classList.remove('sv-loading');
}

function _svUpdateBreadcrumb(center) {
    const brd = document.getElementById('sv-breadcrumb');
    if (!brd || !center) return;
    const kind = center.kind || 'symbol';
    const dot  = `<span class="sv-kind-dot" style="background:${_svKindColor(kind)}"></span>`;
    brd.innerHTML = `${dot}<span class="sv-bc-kind">${_svEsc(kind)}</span>
      <span class="sv-bc-name">${_svEsc(center.name || '')}</span>
      <span class="sv-bc-file">${_svEsc(center.file || '')}${center.line ? ':' + center.line : ''}</span>`;
}

// ── Model builder: /symbol-graph response → normalized layout model ───────
function _svBuildModel(resp) {
    const center = resp.center || {};
    const centerKind = center.kind || '';
    const isCard = _SV_CARD_KINDS.has(centerKind);

    const children = Array.isArray(center.children) ? center.children : [];

    // Classify incoming/outgoing into 5 buckets.
    // "up = base class" means the center extends base.
    // In server edges, `from=sub, to=base, type=inheritance`. So from the center's
    // perspective:  outgoing inheritance → base (up);   incoming inheritance → derived (down).
    const up    = [];
    const down  = [];
    const left  = [];
    const right = [];
    const seenIds = new Set();

    for (const item of (resp.outgoing || [])) {
        if (!item || !item.sym) continue;
        const neighbor = item.sym;
        if (seenIds.has(neighbor.id + '|out|' + item.edge_type)) continue;
        seenIds.add(neighbor.id + '|out|' + item.edge_type);
        const entry = {
            id:        neighbor.id,
            name:      neighbor.name,
            kind:      neighbor.kind,
            file:      neighbor.file,
            line:      neighbor.line,
            edgeType:  item.edge_type,
            edgeCount: item.count,
            edgeFile:  item.edge_file,
            edgeLine:  item.edge_line,
            edgeLines: Array.isArray(item.edge_lines) && item.edge_lines.length ? item.edge_lines : [item.edge_line],
            direction: 'out',
            hasError:  !!neighbor.has_error,
            parseError: neighbor.parse_error || '',
        };
        if (item.edge_type === 'inheritance' || item.edge_type === 'implements') {
            up.push(entry);
        } else {
            right.push(entry);
        }
    }

    for (const item of (resp.incoming || [])) {
        if (!item || !item.sym) continue;
        const neighbor = item.sym;
        if (seenIds.has(neighbor.id + '|in|' + item.edge_type)) continue;
        seenIds.add(neighbor.id + '|in|' + item.edge_type);
        const entry = {
            id:        neighbor.id,
            name:      neighbor.name,
            kind:      neighbor.kind,
            file:      neighbor.file,
            line:      neighbor.line,
            edgeType:  item.edge_type,
            edgeCount: item.count,
            edgeFile:  item.edge_file,
            edgeLine:  item.edge_line,
            edgeLines: Array.isArray(item.edge_lines) && item.edge_lines.length ? item.edge_lines : [item.edge_line],
            direction: 'in',
            hasError:  !!neighbor.has_error,
            parseError: neighbor.parse_error || '',
        };
        if (item.edge_type === 'inheritance' || item.edge_type === 'implements') {
            down.push(entry);
        } else {
            left.push(entry);
        }
    }

    // Sort each bucket by edge count desc then by name.
    const cmp = (a, b) => (b.edgeCount - a.edgeCount) || a.name.localeCompare(b.name);
    [up, down, left, right].forEach(arr => arr.sort(cmp));

    // Cap per side.
    const truncate = (arr, cap) => {
        if (arr.length <= cap) return { list: arr, extra: 0 };
        return { list: arr.slice(0, cap), extra: arr.length - cap };
    };
    const U = truncate(up, _SV_MAX_PER_SIDE);
    const D = truncate(down, _SV_MAX_PER_SIDE);
    const L = truncate(left, _SV_MAX_PER_SIDE);
    const R = truncate(right, _SV_MAX_PER_SIDE);

    // Compute center card dimensions.
    const centerId = center.id || '__center__';
    const nameLen   = _svMeasureText(center.name || '', 15) + 40;
    const fileLen   = _svMeasureText(center.file || '', 11) + 40;

    // Split members by access; track collapse state.
    const pubMembers  = isCard ? children.filter(c => c.is_public !== false) : [];
    const privMembers = isCard ? children.filter(c => c.is_public === false) : [];
    const pubCollapsed  = _svState.collapsedSections.has(centerId + '|public');
    const privCollapsed = _svState.collapsedSections.has(centerId + '|private');

    // Decide single vs two-column layout.
    const totalMembers = pubMembers.length + privMembers.length;
    const useTwoCol = isCard
        && totalMembers >= _SV_TWO_COL_TRIGGER
        && pubMembers.length >= _SV_TWO_COL_MIN_SIDE
        && privMembers.length >= _SV_TWO_COL_MIN_SIDE;

    const memberLen = isCard ? Math.max(
        0,
        ...children.map(c => _svMeasureText(c.name || '', 13) + 60)
    ) : 0;

    let cardW;
    let cardH;
    if (isCard) {
        if (useTwoCol) {
            const colW = Math.max(_SV_COL_MIN_W, memberLen);
            cardW = colW * 2 + _SV_COLUMN_GAP + _SV_CARD_PAD_X * 2;
            const pubCount  = pubCollapsed  ? 0 : pubMembers.length;
            const privCount = privCollapsed ? 0 : privMembers.length;
            const rows = Math.max(1, pubCount, privCount);
            cardH = _SV_CARD_PAD_TOP + rows * (_SV_MEMBER_H + _SV_MEMBER_GAP) + _SV_CARD_PAD_BOT;
        } else {
            cardW = Math.min(_SV_CARD_MAX_W, Math.max(_SV_CARD_MIN_W, nameLen, fileLen, memberLen));
            const visiblePub  = pubCollapsed  ? 0 : pubMembers.length;
            const visiblePriv = privCollapsed ? 0 : privMembers.length;
            const visibleRows = visiblePub + visiblePriv;
            cardH = _SV_CARD_PAD_TOP + Math.max(_SV_MEMBER_H, visibleRows * (_SV_MEMBER_H + _SV_MEMBER_GAP)) + _SV_CARD_PAD_BOT;
        }
    } else {
        cardW = Math.max(_SV_CARD_MIN_W, nameLen);
        cardH = _SV_PILL_H;
    }

    // Position everything (center at 0,0).
    const model = {
        center: {
            id:       centerId,
            name:     center.name || '',
            kind:     centerKind,
            file:     center.file || '',
            line:     center.line || 0,
            end_line: center.end_line || center.line || 0,
            isCard,
            w:        cardW,
            h:        cardH,
            x:        0,
            y:        0,
            children,
            pubMembers,
            privMembers,
            pubCollapsed,
            privCollapsed,
            useTwoCol,
            hasError:  !!center.parse_error,
            parseError: center.parse_error || '',
            activeMemberId: resp.active_member_id || null,
        },
        neighbors: [],
        edges:     [],
    };

    // Helper to build a neighbor pill.
    function pillOf(entry, group) {
        const w = Math.min(_SV_CARD_MAX_W, Math.max(140, _svMeasureText(entry.name, 13) + _SV_PILL_PAD_X * 2 + 24));
        return {
            id:        entry.id,
            name:      entry.name,
            kind:      entry.kind,
            file:      entry.file,
            line:      entry.line,
            group,
            edgeType:  entry.edgeType,
            edgeCount: entry.edgeCount,
            edgeFile:  entry.edgeFile,
            edgeLine:  entry.edgeLine,
            direction: entry.direction,
            w,
            h:         _SV_PILL_H,
            x:         0,
            y:         0,
            isPill:    true,
            hasError:  !!entry.hasError,
            parseError: entry.parseError || '',
        };
    }

    const halfW = cardW / 2;
    const halfH = cardH / 2;

    // Keep track of placed pills keyed by id so we can build secondary expansions.
    const placed = new Map();
    function addPill(entry, group, x, y) {
        const p = pillOf(entry, group);
        p.x = x; p.y = y;
        p.expanded = _svState.expansions.has(p.id);
        model.neighbors.push(p);
        placed.set(p.id, p);
        return p;
    }

    // UP row (base classes)
    U.list.forEach((entry, i) => {
        const n = U.list.length;
        const totalW = (n - 1) * _SV_NEIGHBOR_GAP_H;
        addPill(entry, 'up', -totalW / 2 + i * _SV_NEIGHBOR_GAP_H, -halfH - _SV_MARGIN_TB);
    });
    // DOWN row (derived classes)
    D.list.forEach((entry, i) => {
        const n = D.list.length;
        const totalW = (n - 1) * _SV_NEIGHBOR_GAP_H;
        addPill(entry, 'down', -totalW / 2 + i * _SV_NEIGHBOR_GAP_H, halfH + _SV_MARGIN_TB);
    });
    // LEFT column (incoming)
    L.list.forEach((entry, i) => {
        const n = L.list.length;
        const totalH = (n - 1) * _SV_NEIGHBOR_GAP_V;
        const w = _svPillWidthFor(entry);
        addPill(entry, 'left', -halfW - _SV_MARGIN_LR - w / 2, -totalH / 2 + i * _SV_NEIGHBOR_GAP_V);
    });
    // RIGHT column (outgoing)
    R.list.forEach((entry, i) => {
        const n = R.list.length;
        const totalH = (n - 1) * _SV_NEIGHBOR_GAP_V;
        const w = _svPillWidthFor(entry);
        addPill(entry, 'right', halfW + _SV_MARGIN_LR + w / 2, -totalH / 2 + i * _SV_NEIGHBOR_GAP_V);
    });

    // ── Secondary (expanded) neighbors ───────────────────────────────────────
    // For each 1-hop pill marked as expanded, place its extra neighbors one
    // step further out along the same axis. Dedup against existing ids so we
    // don't draw the center or already-visible neighbors twice.
    const existingIds = new Set([centerId, ...model.neighbors.map(n => n.id)]);
    for (const [pillId, exp] of _svState.expansions.entries()) {
        const parent = placed.get(pillId);
        if (!parent || !exp || !Array.isArray(exp.neighbors)) continue;
        const filtered = exp.neighbors.filter(e => !existingIds.has(e.id));
        if (!filtered.length) continue;
        const group = parent.group;
        let bx = parent.x, by = parent.y;
        filtered.forEach((entry, i) => {
            const w = _svPillWidthFor(entry);
            let x, y;
            if (group === 'right') {
                x = bx + parent.w / 2 + _SV_EXPAND_GAP + w / 2;
                const n = filtered.length;
                y = by + (-((n - 1) * _SV_NEIGHBOR_GAP_V) / 2) + i * _SV_NEIGHBOR_GAP_V;
            } else if (group === 'left') {
                x = bx - parent.w / 2 - _SV_EXPAND_GAP - w / 2;
                const n = filtered.length;
                y = by + (-((n - 1) * _SV_NEIGHBOR_GAP_V) / 2) + i * _SV_NEIGHBOR_GAP_V;
            } else if (group === 'up') {
                y = by - _SV_MARGIN_TB - _SV_PILL_H;
                const n = filtered.length;
                x = bx + (-((n - 1) * _SV_NEIGHBOR_GAP_H) / 2) + i * _SV_NEIGHBOR_GAP_H;
            } else {  // down
                y = by + _SV_MARGIN_TB + _SV_PILL_H;
                const n = filtered.length;
                x = bx + (-((n - 1) * _SV_NEIGHBOR_GAP_H) / 2) + i * _SV_NEIGHBOR_GAP_H;
            }
            const sec = pillOf(entry, group);
            sec.x = x; sec.y = y;
            sec.isSecondary = true;
            sec.parentPillId = pillId;
            sec.expanded = _svState.expansions.has(sec.id);
            model.neighbors.push(sec);
            existingIds.add(sec.id);
        });
    }

    // Build edge entries. Direction convention: "in" edges point from neighbor to center;
    // "out" edges point from center to neighbor.
    for (const nb of model.neighbors) {
        if (nb.isSecondary) {
            const expandedSide = nb.group;
            const fromId = expandedSide === 'left' || expandedSide === 'down' ? nb.id : nb.parentPillId;
            const toId   = expandedSide === 'left' || expandedSide === 'down' ? nb.parentPillId : nb.id;
            model.edges.push({
                id:         `e|${fromId}|${toId}|${nb.edgeType}|sec`,
                from:       fromId,
                to:         toId,
                type:       nb.edgeType,
                count:      nb.edgeCount,
                edgeFile:   nb.edgeFile,
                edgeLine:   nb.edgeLine,
                edgeLines:  nb.edgeLines,
                secondary:  true,
            });
            continue;
        }
        if (nb.direction === 'out') {
            model.edges.push({
                id:        `e|${model.center.id}|${nb.id}|${nb.edgeType}|out`,
                from:      model.center.id,
                to:        nb.id,
                type:      nb.edgeType,
                count:     nb.edgeCount,
                edgeFile:  nb.edgeFile,
                edgeLine:  nb.edgeLine,
                edgeLines: nb.edgeLines,
            });
        } else {
            model.edges.push({
                id:        `e|${nb.id}|${model.center.id}|${nb.edgeType}|in`,
                from:      nb.id,
                to:        model.center.id,
                type:      nb.edgeType,
                count:     nb.edgeCount,
                edgeFile:  nb.edgeFile,
                edgeLine:  nb.edgeLine,
                edgeLines: nb.edgeLines,
            });
        }
    }

    return model;
}

// ── Render + animate ──────────────────────────────────────────────────────
function _svRenderModel(newModel, opts) {
    const svg      = _svState.svg;
    const viewport = _svState.viewport;
    if (!svg || !viewport) return;

    // Make sure the viewport is visible. Only reset pan/zoom on fresh activation.
    svg.style.display = '';
    if (!opts || !opts.preserveView) {
        _svResetZoom(false);
        _svCenterView(newModel);
    }

    const cardsG  = viewport.querySelector('.sv-cards');
    const edgesG  = viewport.querySelector('.sv-edges');
    const labelsG = viewport.querySelector('.sv-edge-labels');
    if (!cardsG || !edgesG) return;

    const prev = _svState.currentGraph;
    const allNew = [newModel.center, ...newModel.neighbors];
    const oldById = new Map();
    if (prev) {
        for (const n of prev.allNodes) oldById.set(n.id, n);
    }

    // ── Diff: update existing / create new ────────────────────────────────
    const live = new Map();   // id -> { x0, y0, x1, y1, fadeIn, el, data }
    for (const n of allNew) {
        const was = oldById.get(n.id);
        if (was && was.el) {
            // Node persists. Decide whether to rebuild its contents (e.g. center
            // vs pill transition, member list changed, collapse state flipped,
            // single→two column layout, or expansion chip flipped + → −).
            const needRebuild = (was.isCard !== !!n.isCard)
                || (n.isCard && n.children && was.children && n.children.length !== was.children.length)
                || (was.name !== n.name)
                || (n.isCard && (was.pubCollapsed  !== n.pubCollapsed ||
                                 was.privCollapsed !== n.privCollapsed ||
                                 was.useTwoCol     !== n.useTwoCol))
                || (n.isPill && was.expanded !== n.expanded);
            let el = was.el;
            if (needRebuild) {
                const fresh = _svCreateNodeEl(n);
                el.replaceWith(fresh);
                el = fresh;
            } else {
                // Keep element, just update highlight / kind class.
                el.setAttribute('class', _svNodeClass(n));
            }
            live.set(n.id, {
                x0: was.x, y0: was.y,
                x1: n.x,   y1: n.y,
                fadeIn: false, el, data: n,
            });
        } else {
            const el = _svCreateNodeEl(n);
            cardsG.appendChild(el);
            el.style.opacity = '0';
            // Start from a sensible "spawn" position: near the previous center if
            // the previous graph exists (so neighbors fly out from center).
            const spawnX = prev ? prev.center.x : n.x;
            const spawnY = prev ? prev.center.y : n.y;
            live.set(n.id, {
                x0: spawnX, y0: spawnY,
                x1: n.x,    y1: n.y,
                fadeIn: true, el, data: n,
            });
        }
    }

    // Exits: existing nodes not in new model.
    const exits = [];
    if (prev) {
        const newIds = new Set(allNew.map(n => n.id));
        for (const o of prev.allNodes) {
            if (!newIds.has(o.id) && o.el) {
                exits.push({ el: o.el, startOpacity: parseFloat(o.el.style.opacity) || 1 });
            }
        }
    }

    // Reset edge groups (we redraw every animation frame).
    edgesG.innerHTML  = '';
    labelsG.innerHTML = '';

    const DUR = 280;
    const t0  = performance.now();

    function frame(now) {
        const t = Math.min(1, (now - t0) / DUR);
        const e = _svEase(t);

        // Update live node positions / opacity.
        for (const [_id, L] of live) {
            const x = L.x0 + (L.x1 - L.x0) * e;
            const y = L.y0 + (L.y1 - L.y0) * e;
            L.currentX = x;
            L.currentY = y;
            L.el.setAttribute('transform', `translate(${x - L.data.w / 2},${y - L.data.h / 2})`);
            if (L.fadeIn) L.el.style.opacity = String(e);
        }

        // Fade exits.
        for (const X of exits) {
            X.el.style.opacity = String(X.startOpacity * (1 - e));
        }

        // Rebuild edges from live positions so they track animations.
        edgesG.innerHTML  = '';
        labelsG.innerHTML = '';
        for (const ed of newModel.edges) {
            const from = live.get(ed.from);
            const to   = live.get(ed.to);
            if (!from || !to) continue;
            _svAppendEdge(edgesG, labelsG, ed, from, to);
        }

        if (t < 1) {
            requestAnimationFrame(frame);
        } else {
            // Cleanup: remove exit elements.
            for (const X of exits) X.el.remove();
            // Snap to final positions + full opacity.
            for (const [_id, L] of live) {
                L.el.setAttribute('transform', `translate(${L.x1 - L.data.w / 2},${L.y1 - L.data.h / 2})`);
                L.el.style.opacity = '1';
                L.data.x  = L.x1;
                L.data.y  = L.y1;
                L.data.el = L.el;
            }
            _svState.currentGraph = {
                center:   newModel.center,
                allNodes: allNew.map(n => ({ ...n, el: live.get(n.id).el })),
                edges:    newModel.edges,
            };
            _svBindNodeClicks();
        }
    }
    requestAnimationFrame(frame);
    // Also bind clicks immediately so user can interact while animation runs.
    _svBindNodeClicks(live);
}

function _svCenterView(model) {
    // Fit the model into the current svg viewport. We just pan so that (0,0)
    // sits at the svg center. (Zoom stays at k=1 for v1.)
    const svg = _svState.svg;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    _svState.zoom.k = 1;
    _svState.zoom.x = rect.width / 2;
    _svState.zoom.y = rect.height / 2;
    _svApplyZoom();
}

// ── Node creation (SVG) ───────────────────────────────────────────────────
function _svNodeClass(n) {
    const kind = n.kind || 'default';
    const classes = ['sv-node', `sv-kind-${kind}`];
    if (n.isCard) classes.push('sv-card');
    if (n.isPill) classes.push('sv-pill');
    if (n.group)  classes.push(`sv-group-${n.group}`);
    if (n.isSecondary) classes.push('sv-secondary');
    return classes.join(' ');
}

function _svCreateNodeEl(n) {
    const NS = 'http://www.w3.org/2000/svg';
    const g  = document.createElementNS(NS, 'g');
    g.setAttribute('class', _svNodeClass(n));
    g.dataset.symid = n.id;
    g.setAttribute('transform', `translate(${n.x - n.w / 2},${n.y - n.h / 2})`);

    // Background rectangle
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('class', 'sv-node-bg');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width',  String(n.w));
    rect.setAttribute('height', String(n.h));
    rect.setAttribute('rx', n.isPill ? '20' : '10');
    g.appendChild(rect);

    // Header / title — colored left indicator bar
    const bar = document.createElementNS(NS, 'rect');
    bar.setAttribute('class', 'sv-node-accent');
    bar.setAttribute('x', '0');
    bar.setAttribute('y', '0');
    bar.setAttribute('width', '4');
    bar.setAttribute('height', String(n.h));
    bar.setAttribute('fill', _svKindColor(n.kind));
    g.appendChild(bar);

    // Kind dot
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('class', 'sv-node-dot');
    dot.setAttribute('cx', '18');
    dot.setAttribute('cy', n.isCard ? '22' : String(n.h / 2));
    dot.setAttribute('r', '5');
    dot.setAttribute('fill', _svKindColor(n.kind));
    g.appendChild(dot);

    // Name
    const name = document.createElementNS(NS, 'text');
    name.setAttribute('class', 'sv-node-name');
    name.setAttribute('x', '32');
    name.setAttribute('y', n.isCard ? '26' : String(n.h / 2 + 4));
    name.setAttribute('fill', 'var(--text, #e2e8f0)');
    name.textContent = _svClipText(n.name, n.w - 52);
    g.appendChild(name);

    // Kind badge (top-right)
    if (n.isCard) {
        const kind = document.createElementNS(NS, 'text');
        kind.setAttribute('class', 'sv-node-kind');
        kind.setAttribute('x', String(n.w - 10));
        kind.setAttribute('y', '20');
        kind.setAttribute('text-anchor', 'end');
        kind.textContent = (n.kind || '').toUpperCase();
        g.appendChild(kind);
    } else {
        const badge = document.createElementNS(NS, 'text');
        badge.setAttribute('class', 'sv-pill-kind');
        badge.setAttribute('x', String(n.w - 10));
        badge.setAttribute('y', String(n.h / 2 + 4));
        badge.setAttribute('text-anchor', 'end');
        badge.textContent = (n.kind || '').slice(0, 4).toUpperCase();
        g.appendChild(badge);
    }

    // Section chips (PUBLIC / PRIVATE toggles) + member rows.
    if (n.isCard) {
        const pub  = n.pubMembers  || [];
        const priv = n.privMembers || [];
        if (pub.length || priv.length) {
            _svBuildSectionChips(g, n, pub, priv);
            _svBuildMemberRows(g, n, pub, priv);
        }
    }

    // Expand chip (+ / −) on primary neighbor pills — click to fetch and merge
    // one more hop outward along the same direction as this pill's group.
    // Secondary pills intentionally have no chip — clicking them promotes them
    // to the new center instead, which is cleaner than cascading expansions.
    if (n.isPill && n.group && !n.isSecondary) {
        _svBuildExpandChip(g, n);
    }

    // Parse-error badge (X in a red circle) on nodes whose source couldn't
    // be parsed cleanly. Positioned in the bottom-right corner of the node.
    if (n.hasError) {
        const NS2 = 'http://www.w3.org/2000/svg';
        const badge = document.createElementNS(NS2, 'g');
        badge.setAttribute('class', 'sv-error-badge');
        badge.setAttribute('transform', `translate(${n.w - 12},${n.h - 12})`);
        const disc = document.createElementNS(NS2, 'circle');
        disc.setAttribute('r', '9');
        disc.setAttribute('fill', '#ef4444');
        disc.setAttribute('stroke', '#1b1c19');
        disc.setAttribute('stroke-width', '1.5');
        badge.appendChild(disc);
        const xm = document.createElementNS(NS2, 'text');
        xm.setAttribute('class', 'sv-error-x');
        xm.setAttribute('text-anchor', 'middle');
        xm.setAttribute('y', '4');
        xm.setAttribute('fill', '#fff');
        xm.textContent = '✕';
        badge.appendChild(xm);
        const tipText = n.parseError ? `Parse issue: ${n.parseError}` : 'Parse issue — symbols may be incomplete';
        const title = document.createElementNS(NS2, 'title');
        title.textContent = tipText;
        badge.appendChild(title);
        g.appendChild(badge);
    }

    return g;
}

// Build the PUBLIC/PRIVATE toggle chips in the card header row.
function _svBuildSectionChips(g, n, pub, priv) {
    const NS = 'http://www.w3.org/2000/svg';
    const chipY = 38;
    let chipX = 10;
    const chipCfg = [
        { key: 'public',  label: 'PUBLIC',  count: pub.length,  collapsed: n.pubCollapsed,  color: '#34d399' },
        { key: 'private', label: 'PRIVATE', count: priv.length, collapsed: n.privCollapsed, color: '#f87171' },
    ];
    for (const c of chipCfg) {
        if (!c.count) continue;
        const chip = document.createElementNS(NS, 'g');
        chip.setAttribute('class', 'sv-section-chip' + (c.collapsed ? ' sv-chip-collapsed' : ''));
        chip.dataset.section = c.key;
        chip.dataset.cardid  = n.id;
        chip.setAttribute('transform', `translate(${chipX},${chipY})`);

        const labelText = `${c.label} ${c.count}${c.collapsed ? ' ▸' : ' ▾'}`;
        const w = labelText.length * 6.2 + 14;
        const bg = document.createElementNS(NS, 'rect');
        bg.setAttribute('x', '0'); bg.setAttribute('y', '-10');
        bg.setAttribute('width', String(w)); bg.setAttribute('height', '18');
        bg.setAttribute('rx', '9');
        bg.setAttribute('class', 'sv-chip-bg');
        bg.setAttribute('stroke', c.color);
        chip.appendChild(bg);

        const tx = document.createElementNS(NS, 'text');
        tx.setAttribute('x', String(w / 2));
        tx.setAttribute('y', '3');
        tx.setAttribute('text-anchor', 'middle');
        tx.setAttribute('class', 'sv-chip-text');
        tx.setAttribute('fill', c.color);
        tx.textContent = labelText;
        chip.appendChild(tx);

        chip.addEventListener('click', (ev) => {
            ev.stopPropagation();
            _svToggleSection(n.id, c.key);
        });
        g.appendChild(chip);
        chipX += w + 6;
    }
}

// Arrange member rows, either single-column stacked or two-column (public left, private right).
function _svBuildMemberRows(g, n, pub, priv) {
    const NS = 'http://www.w3.org/2000/svg';
    const pubVisible  = n.pubCollapsed  ? [] : pub;
    const privVisible = n.privCollapsed ? [] : priv;

    if (n.useTwoCol) {
        const colW = (n.w - _SV_COLUMN_GAP - _SV_CARD_PAD_X * 2) / 2;
        _svRenderMemberColumn(g, n, pubVisible,  _SV_CARD_PAD_X,                                 colW, 'public');
        _svRenderMemberColumn(g, n, privVisible, _SV_CARD_PAD_X + colW + _SV_COLUMN_GAP,         colW, 'private');
        return;
    }
    // Single-column: public first, then private.
    let y = _SV_CARD_PAD_TOP;
    y = _svRenderMemberRowRange(g, n, pubVisible,  8, n.w - 16, y);
    y = _svRenderMemberRowRange(g, n, privVisible, 8, n.w - 16, y);
}

function _svRenderMemberColumn(g, n, list, x, colW, section) {
    let y = _SV_CARD_PAD_TOP;
    for (const m of list) {
        g.appendChild(_svRenderMember(n, m, x, y, colW, section));
        y += _SV_MEMBER_H + _SV_MEMBER_GAP;
    }
}

function _svRenderMemberRowRange(g, n, list, x, rowW, startY) {
    let y = startY;
    for (const m of list) {
        g.appendChild(_svRenderMember(n, m, x, y, rowW, m.is_public === false ? 'private' : 'public'));
        y += _SV_MEMBER_H + _SV_MEMBER_GAP;
    }
    return y;
}

function _svRenderMember(n, m, x, y, rowW, section) {
    const NS = 'http://www.w3.org/2000/svg';
    const mg = document.createElementNS(NS, 'g');
    mg.setAttribute('class', 'sv-member sv-member-' + section);
    mg.dataset.symid = m.id;
    mg.setAttribute('transform', `translate(${x},${y})`);

    const mBg = document.createElementNS(NS, 'rect');
    mBg.setAttribute('class', 'sv-member-bg');
    mBg.setAttribute('x', '0'); mBg.setAttribute('y', '0');
    mBg.setAttribute('width',  String(rowW));
    mBg.setAttribute('height', String(_SV_MEMBER_H));
    mBg.setAttribute('rx', '6');
    mg.appendChild(mBg);

    const mDot = document.createElementNS(NS, 'circle');
    mDot.setAttribute('class', 'sv-member-dot');
    mDot.setAttribute('cx', '12');
    mDot.setAttribute('cy', String(_SV_MEMBER_H / 2));
    mDot.setAttribute('r', '4');
    mDot.setAttribute('fill', _svKindColor(m.kind));
    mg.appendChild(mDot);

    const mName = document.createElementNS(NS, 'text');
    mName.setAttribute('class', 'sv-member-name');
    mName.setAttribute('x', '22');
    mName.setAttribute('y', String(_SV_MEMBER_H / 2 + 4));
    mName.textContent = _svClipText(m.name, rowW - 60);
    mg.appendChild(mName);

    const access = m.is_public === false ? 'PRIV' : 'PUB';
    const accessEl = document.createElementNS(NS, 'text');
    accessEl.setAttribute('class', `sv-member-access sv-access-${access.toLowerCase()}`);
    accessEl.setAttribute('x', String(rowW - 8));
    accessEl.setAttribute('y', String(_SV_MEMBER_H / 2 + 4));
    accessEl.setAttribute('text-anchor', 'end');
    accessEl.textContent = access;
    mg.appendChild(accessEl);

    if (n.activeMemberId && m.id === n.activeMemberId) {
        mg.classList.add('sv-member-active');
    }
    if (m.has_error) {
        mg.classList.add('sv-member-error');
        const NS2 = 'http://www.w3.org/2000/svg';
        const mark = document.createElementNS(NS2, 'text');
        mark.setAttribute('class', 'sv-member-error-mark');
        mark.setAttribute('x', String(rowW - 34));
        mark.setAttribute('y', String(_SV_MEMBER_H / 2 + 4));
        mark.setAttribute('text-anchor', 'end');
        mark.textContent = '✕';
        const t = document.createElementNS(NS2, 'title');
        t.textContent = 'Parse issue in this symbol';
        mark.appendChild(t);
        mg.appendChild(mark);
    }
    return mg;
}

function _svToggleSection(cardId, section) {
    const key = `${cardId}|${section}`;
    if (_svState.collapsedSections.has(key)) {
        _svState.collapsedSections.delete(key);
    } else {
        _svState.collapsedSections.add(key);
    }
    // Re-run the model build + animated render; preserve the current pan/zoom.
    if (_svState.active && _svState.active !== '__overview__') {
        _svFetchAndRender(_svState.active, { preserveView: true });
    }
}

// ── Local expansion: +N hop ─────────────────────────────────────────────
// Places a small chip on the outer edge of a neighbor pill; clicking it
// fetches that pill's /symbol-graph and keeps the neighbors on the same
// side (e.g. a right-side pill contributes its outgoing edges further right).
function _svBuildExpandChip(g, n) {
    const NS = 'http://www.w3.org/2000/svg';
    const chip = document.createElementNS(NS, 'g');
    chip.setAttribute('class', 'sv-expand-chip');
    chip.dataset.pillid = n.id;
    chip.dataset.group  = n.group;

    // Position the chip on the outer edge of the pill.
    let cx, cy;
    if (n.group === 'right')      { cx = n.w;      cy = n.h / 2; }
    else if (n.group === 'left')  { cx = 0;        cy = n.h / 2; }
    else if (n.group === 'up')    { cx = n.w / 2;  cy = 0;       }
    else                          { cx = n.w / 2;  cy = n.h;     }  // down
    chip.setAttribute('transform', `translate(${cx},${cy})`);

    const disc = document.createElementNS(NS, 'circle');
    disc.setAttribute('r', '8');
    disc.setAttribute('fill', 'var(--panel, #161715)');
    disc.setAttribute('stroke', 'var(--accent, #dfa745)');
    disc.setAttribute('stroke-width', '1.4');
    chip.appendChild(disc);

    const tx = document.createElementNS(NS, 'text');
    tx.setAttribute('class', 'sv-expand-chip-text');
    tx.setAttribute('text-anchor', 'middle');
    tx.setAttribute('y', '4');
    tx.textContent = n.expanded ? '−' : '+';
    chip.appendChild(tx);

    const title = document.createElementNS(NS, 'title');
    title.textContent = n.expanded ? 'Collapse this branch' : 'Expand one more hop';
    chip.appendChild(title);

    chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _svToggleExpansion(n);
    });
    g.appendChild(chip);
}

async function _svToggleExpansion(pill) {
    if (_svState.expansions.has(pill.id)) {
        _svState.expansions.delete(pill.id);
        // Also drop any cascades anchored on this pill — a collapse should not
        // leave orphan grandchildren visible.
        for (const [pid, exp] of Array.from(_svState.expansions.entries())) {
            if (exp && exp.parentTrail && exp.parentTrail.includes(pill.id)) {
                _svState.expansions.delete(pid);
            }
        }
        if (_svState.active && _svState.active !== '__overview__') {
            _svFetchAndRender(_svState.active, { preserveView: true });
        }
        return;
    }

    const jid = _svState.jobId || window.JOB_ID;
    if (!jid) return;
    try {
        const resp = await fetch(`/symbol-graph?job=${encodeURIComponent(jid)}&sym=${encodeURIComponent(pill.id)}`);
        const data = await resp.json();
        if (!data || data.error) return;

        // Pick edges heading in the same direction this pill sits on.
        // right / up pills contribute outgoing neighbors; left / down pills
        // contribute incoming. Mirrors the primary 5-way layout semantics.
        const pool = (pill.group === 'right' || pill.group === 'up')
            ? (data.outgoing || [])
            : (data.incoming || []);

        const neighbors = [];
        for (const item of pool) {
            if (!item || !item.sym) continue;
            const sym = item.sym;
            neighbors.push({
                id:         sym.id,
                name:       sym.name,
                kind:       sym.kind,
                file:       sym.file,
                line:       sym.line,
                edgeType:   item.edge_type,
                edgeCount:  item.count,
                edgeFile:   item.edge_file,
                edgeLine:   item.edge_line,
                edgeLines:  Array.isArray(item.edge_lines) && item.edge_lines.length
                              ? item.edge_lines
                              : [item.edge_line],
                direction:  (pill.group === 'right' || pill.group === 'up') ? 'out' : 'in',
                hasError:   !!sym.has_error,
                parseError: sym.parse_error || '',
            });
        }
        _svState.expansions.set(pill.id, {
            group:        pill.group,
            neighbors,
            parentTrail:  [pill.id],
        });
        if (_svState.active && _svState.active !== '__overview__') {
            _svFetchAndRender(_svState.active, { preserveView: true });
        }
    } catch (err) {
        /* swallow: expansion is a best-effort enhancement */
    }
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
    const fromBox = { x: from.currentX, y: from.currentY, w: from.data.w, h: from.data.h };
    const toBox   = { x: to.currentX,   y: to.currentY,   w: to.data.w,   h: to.data.h };
    const endpoints = _svComputeEndpoints(fromBox, toBox);
    const color = _svEdgeColor(ed.type);

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', `sv-edge sv-edge-${ed.type}` + (ed.secondary ? ' sv-edge-secondary' : ''));
    path.dataset.edgeid = ed.id;
    const d = _svBuildEdgePath(endpoints);
    path.setAttribute('d', d);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', ed.secondary ? '1.2' : '1.6');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#sv-arrow)');
    if (ed.secondary) path.setAttribute('stroke-dasharray', '4 3');
    path.style.color = color;
    path.addEventListener('click', (e) => {
        e.stopPropagation();
        _svHandleEdgeClick(ed);
    });
    path.addEventListener('mouseenter', (e) => _svShowEdgeTip(e, ed));
    path.addEventListener('mousemove',  (e) => _svMoveEdgeTip(e));
    path.addEventListener('mouseleave', () => _svHideEdgeTip());
    edgesG.appendChild(path);

    // Count label for bundled edges.
    if (ed.count > 1) {
        const mid = _svMidpoint(endpoints);
        const label = document.createElementNS(NS, 'g');
        label.setAttribute('class', 'sv-edge-label');
        label.setAttribute('transform', `translate(${mid.x},${mid.y})`);
        const bg = document.createElementNS(NS, 'rect');
        const txt = ed.count + 'x';
        const w = txt.length * 7 + 8;
        bg.setAttribute('x', String(-w / 2));
        bg.setAttribute('y', '-8');
        bg.setAttribute('width',  String(w));
        bg.setAttribute('height', '16');
        bg.setAttribute('rx', '4');
        bg.setAttribute('fill', 'var(--panel, #161715)');
        bg.setAttribute('stroke', color);
        bg.setAttribute('stroke-width', '1');
        label.appendChild(bg);
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('class', 'sv-edge-label-text');
        t.setAttribute('x', '0');
        t.setAttribute('y', '4');
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('fill', color);
        t.textContent = txt;
        label.appendChild(t);
        labelsG.appendChild(label);
    }
}

function _svComputeEndpoints(from, to) {
    // Compute attachment points on the bounding-box perimeter for each node.
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

function _svBuildEdgePath({ sx, sy, ex, ey, fromSide }) {
    // Simple cubic-bezier. Control point offset depends on attachment side.
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const curve = Math.min(140, Math.max(28, dist * 0.35));

    let cx1 = sx, cy1 = sy, cx2 = ex, cy2 = ey;
    if (fromSide === 'left')  { cx1 = sx - curve; }
    if (fromSide === 'right') { cx1 = sx + curve; }
    if (fromSide === 'top')   { cy1 = sy - curve; }
    if (fromSide === 'bottom'){ cy1 = sy + curve; }

    const toSide = _svOppositeSide(fromSide);
    if (toSide === 'left')  { cx2 = ex - curve; }
    if (toSide === 'right') { cx2 = ex + curve; }
    if (toSide === 'top')   { cy2 = ey - curve; }
    if (toSide === 'bottom'){ cy2 = ey + curve; }
    return `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${ex} ${ey}`;
}

function _svOppositeSide(side) {
    return { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[side] || 'left';
}

function _svMidpoint({ sx, sy, ex, ey }) {
    return { x: (sx + ex) / 2, y: (sy + ey) / 2 };
}

// ── Edge tooltip ──────────────────────────────────────────────────────────
function _svShowEdgeTip(e, ed) {
    const tip = document.getElementById('sv-edge-tip');
    if (!tip) return;
    const sites = Array.isArray(ed.edgeLines) && ed.edgeLines.length ? ed.edgeLines : [ed.edgeLine];
    const nSites = sites.length;
    const cursor = _svState.edgeJumpCursor.get(ed.id) || 0;
    const currentLine = sites[cursor % Math.max(1, nSites)] || ed.edgeLine;
    const lineStr = currentLine ? `:${currentLine}` : '';
    const siteInfo = nSites > 1
        ? `<span class="sv-tip-sites">${nSites} call sites &middot; next ${((cursor % nSites) + 1)}/${nSites}</span>`
        : '';
    const hint = nSites > 1
        ? 'Click to cycle through call sites'
        : 'Click to jump to source';
    tip.innerHTML = `<span class="sv-tip-type" style="color:${_svEdgeColor(ed.type)}">${_svEsc(ed.type)}</span>
        <span class="sv-tip-count">&times;${ed.count}</span>
        ${siteInfo}
        <div class="sv-tip-site">${_svEsc(ed.edgeFile || '')}${lineStr}</div>
        <div class="sv-tip-hint">${hint}</div>`;
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
function _svBindNodeClicks(liveMap) {
    const viewport = _svState.viewport;
    if (!viewport) return;
    const nodes = viewport.querySelectorAll('.sv-node');
    nodes.forEach(el => {
        if (el.dataset.boundClick === '1') return;
        el.dataset.boundClick = '1';
        el.addEventListener('click', (e) => {
            // Members take priority over the card container.
            const memberEl = e.target.closest('.sv-member');
            if (memberEl && el.contains(memberEl)) {
                e.stopPropagation();
                const mid = memberEl.dataset.symid;
                if (mid) _svHandleMemberClick(mid);
                return;
            }
            const sid = el.dataset.symid;
            if (!sid) return;
            _svHandleNodeClick(sid);
        });
    });
}

function _svHandleNodeClick(symId) {
    // Clicking the current center → jump code panel to its definition.
    const model = _svState.currentGraph;
    if (!model) return;
    if (model.center && model.center.id === symId) {
        const c = model.center;
        if (c.file && typeof loadFileInPanel === 'function') {
            loadFileInPanel(c.file, null);
            if (c.line && typeof jumpToLine === 'function') {
                setTimeout(() => jumpToLine(c.line), 150);
            }
        }
        return;
    }
    // Otherwise promote the neighbor to the new center.
    symViewActivate(symId);
}

function _svHandleMemberClick(memberId) {
    if (!window.DATA || !DATA.symbol_index) return;
    const s = DATA.symbol_index[memberId];
    if (s && s.file && typeof loadFileInPanel === 'function') {
        loadFileInPanel(s.file, null);
        if (s.line && typeof jumpToLine === 'function') {
            setTimeout(() => jumpToLine(s.line), 150);
        }
    }
    // Keep the center as the owning class but highlight this member.
    const el = _svState.viewport && _svState.viewport.querySelector(`.sv-member[data-symid="${CSS.escape(memberId)}"]`);
    if (el) {
        _svState.viewport.querySelectorAll('.sv-member-active').forEach(x => x.classList.remove('sv-member-active'));
        el.classList.add('sv-member-active');
    }
}

function _svHandleEdgeClick(ed) {
    if (!ed) return;
    const file  = ed.edgeFile;
    const sites = Array.isArray(ed.edgeLines) && ed.edgeLines.length ? ed.edgeLines : [ed.edgeLine];
    const cursor = _svState.edgeJumpCursor.get(ed.id) || 0;
    const line = sites[cursor % Math.max(1, sites.length)] || ed.edgeLine;
    _svState.edgeJumpCursor.set(ed.id, (cursor + 1) % Math.max(1, sites.length));
    if (file && typeof loadFileInPanel === 'function') {
        loadFileInPanel(file, null);
        if (line && typeof jumpToLine === 'function') {
            setTimeout(() => jumpToLine(line), 150);
        }
    }
    // Refresh the tooltip so the user sees the cursor advance.
    const tip = document.getElementById('sv-edge-tip');
    if (tip && !tip.hidden) _svShowEdgeTip({ clientX: parseFloat(tip.style.left) || 0, clientY: parseFloat(tip.style.top) || 0 }, ed);
}
