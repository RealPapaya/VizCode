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
const _SV_CARD_PAD_TOP = 44;    // header + padding
const _SV_CARD_PAD_BOT = 14;
const _SV_MEMBER_H     = 26;
const _SV_MEMBER_GAP   = 2;
const _SV_PILL_H       = 40;
const _SV_PILL_PAD_X   = 14;
const _SV_NEIGHBOR_GAP_V = 56;  // vertical spacing between stacked neighbors
const _SV_NEIGHBOR_GAP_H = 160; // horizontal spread for up/down rows
const _SV_MARGIN_LR    = 300;   // distance from center card edge to left/right neighbors
const _SV_MARGIN_TB    = 110;   // distance from center card edge to up/down neighbors
const _SV_MAX_PER_SIDE = 24;

// Approximate character width for monospace rendering.
const _SV_CH_W = 7.1;

function _svMeasureText(s, fontSize = 13) {
    // Simple measurement: use char count × approx width scaled by font size.
    const w = String(s || '').length * (_SV_CH_W * (fontSize / 13));
    return Math.ceil(w);
}

// ── Entry: fetch + render ─────────────────────────────────────────────────
async function _svFetchAndRender(symId) {
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
            _svRenderModel(model);
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
            direction: 'out',
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
            direction: 'in',
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
    const nameLen   = _svMeasureText(center.name || '', 15) + 40;
    const fileLen   = _svMeasureText(center.file || '', 11) + 40;
    const memberLen = isCard ? Math.max(
        0,
        ...children.map(c => _svMeasureText(c.name || '', 13) + 60)
    ) : 0;
    let cardW = Math.max(_SV_CARD_MIN_W, nameLen, fileLen, memberLen);
    cardW = Math.min(_SV_CARD_MAX_W, cardW);

    let cardH;
    if (isCard) {
        const n = children.length;
        cardH = _SV_CARD_PAD_TOP + Math.max(_SV_MEMBER_H, n * (_SV_MEMBER_H + _SV_MEMBER_GAP)) + _SV_CARD_PAD_BOT;
    } else {
        cardH = _SV_PILL_H;
        cardW = Math.max(_SV_CARD_MIN_W, nameLen);
    }

    // Position everything (center at 0,0).
    const model = {
        center: {
            id:    center.id || '__center__',
            name:  center.name || '',
            kind:  centerKind,
            file:  center.file || '',
            line:  center.line || 0,
            isCard,
            w:     cardW,
            h:     cardH,
            x:     0,
            y:     0,
            children,
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
        };
    }

    const halfW = cardW / 2;
    const halfH = cardH / 2;

    // UP row (base classes)
    U.list.forEach((entry, i) => {
        const p = pillOf(entry, 'up');
        const n  = U.list.length;
        const totalW = (n - 1) * _SV_NEIGHBOR_GAP_H;
        p.x = -totalW / 2 + i * _SV_NEIGHBOR_GAP_H;
        p.y = -halfH - _SV_MARGIN_TB;
        model.neighbors.push(p);
    });
    // DOWN row (derived classes)
    D.list.forEach((entry, i) => {
        const p = pillOf(entry, 'down');
        const n  = D.list.length;
        const totalW = (n - 1) * _SV_NEIGHBOR_GAP_H;
        p.x = -totalW / 2 + i * _SV_NEIGHBOR_GAP_H;
        p.y = halfH + _SV_MARGIN_TB;
        model.neighbors.push(p);
    });
    // LEFT column (incoming)
    L.list.forEach((entry, i) => {
        const p = pillOf(entry, 'left');
        const n = L.list.length;
        const totalH = (n - 1) * _SV_NEIGHBOR_GAP_V;
        p.x = -halfW - _SV_MARGIN_LR - p.w / 2;
        p.y = -totalH / 2 + i * _SV_NEIGHBOR_GAP_V;
        model.neighbors.push(p);
    });
    // RIGHT column (outgoing)
    R.list.forEach((entry, i) => {
        const p = pillOf(entry, 'right');
        const n = R.list.length;
        const totalH = (n - 1) * _SV_NEIGHBOR_GAP_V;
        p.x = halfW + _SV_MARGIN_LR + p.w / 2;
        p.y = -totalH / 2 + i * _SV_NEIGHBOR_GAP_V;
        model.neighbors.push(p);
    });

    // Build edge entries. Direction convention: "in" edges point from neighbor to center;
    // "out" edges point from center to neighbor.
    for (const nb of model.neighbors) {
        if (nb.direction === 'out') {
            model.edges.push({
                id:       `e|${model.center.id}|${nb.id}|${nb.edgeType}|out`,
                from:     model.center.id,
                to:       nb.id,
                type:     nb.edgeType,
                count:    nb.edgeCount,
                edgeFile: nb.edgeFile,
                edgeLine: nb.edgeLine,
            });
        } else {
            model.edges.push({
                id:       `e|${nb.id}|${model.center.id}|${nb.edgeType}|in`,
                from:     nb.id,
                to:       model.center.id,
                type:     nb.edgeType,
                count:    nb.edgeCount,
                edgeFile: nb.edgeFile,
                edgeLine: nb.edgeLine,
            });
        }
    }

    return model;
}

// ── Render + animate ──────────────────────────────────────────────────────
function _svRenderModel(newModel) {
    const svg      = _svState.svg;
    const viewport = _svState.viewport;
    if (!svg || !viewport) return;

    // Make sure the viewport is visible + zoom reset.
    svg.style.display = '';
    _svResetZoom(false);
    _svCenterView(newModel);

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
            // vs pill transition, or member list changed).
            const needRebuild = (was.isCard !== !!n.isCard)
                || (n.isCard && n.children && was.children && n.children.length !== was.children.length)
                || (was.name !== n.name);
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

    // Members (card only)
    if (n.isCard && n.children && n.children.length) {
        const children = n.children;
        let y = _SV_CARD_PAD_TOP;
        for (const m of children) {
            const mg = document.createElementNS(NS, 'g');
            mg.setAttribute('class', 'sv-member');
            mg.dataset.symid = m.id;
            mg.setAttribute('transform', `translate(8,${y})`);

            const mBg = document.createElementNS(NS, 'rect');
            mBg.setAttribute('class', 'sv-member-bg');
            mBg.setAttribute('x', '0'); mBg.setAttribute('y', '0');
            mBg.setAttribute('width',  String(n.w - 16));
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
            mName.textContent = _svClipText(m.name, n.w - 80);
            mg.appendChild(mName);

            const access = m.is_public === false ? 'PRIV' : 'PUB';
            const accessEl = document.createElementNS(NS, 'text');
            accessEl.setAttribute('class', `sv-member-access sv-access-${access.toLowerCase()}`);
            accessEl.setAttribute('x', String(n.w - 24));
            accessEl.setAttribute('y', String(_SV_MEMBER_H / 2 + 4));
            accessEl.setAttribute('text-anchor', 'end');
            accessEl.textContent = access;
            mg.appendChild(accessEl);

            if (n.activeMemberId && m.id === n.activeMemberId) {
                mg.classList.add('sv-member-active');
            }

            g.appendChild(mg);
            y += _SV_MEMBER_H + _SV_MEMBER_GAP;
        }
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
    const fromBox = { x: from.currentX, y: from.currentY, w: from.data.w, h: from.data.h };
    const toBox   = { x: to.currentX,   y: to.currentY,   w: to.data.w,   h: to.data.h };
    const endpoints = _svComputeEndpoints(fromBox, toBox);
    const color = _svEdgeColor(ed.type);

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', `sv-edge sv-edge-${ed.type}`);
    path.dataset.edgeid = ed.id;
    const d = _svBuildEdgePath(endpoints);
    path.setAttribute('d', d);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#sv-arrow)');
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
    const lineStr = ed.edgeLine ? `:${ed.edgeLine}` : '';
    tip.innerHTML = `<span class="sv-tip-type" style="color:${_svEdgeColor(ed.type)}">${_svEsc(ed.type)}</span>
        <span class="sv-tip-count">&times;${ed.count}</span>
        <div class="sv-tip-site">${_svEsc(ed.edgeFile || '')}${lineStr}</div>
        <div class="sv-tip-hint">Click to jump to source</div>`;
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
    const file = ed.edgeFile;
    const line = ed.edgeLine;
    if (file && typeof loadFileInPanel === 'function') {
        loadFileInPanel(file, null);
        if (line && typeof jumpToLine === 'function') {
            setTimeout(() => jumpToLine(line), 150);
        }
    }
}
