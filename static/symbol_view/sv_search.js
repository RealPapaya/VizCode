// ── Symbol View — Fuzzy search dropdown ──────────────────────────────────
// Hooks the toolbar #sv-search-input. Debounces hits to /symbols, groups
// results by kind (class / function / field), and exposes keyboard nav.
// Called once from _svEnsureDom() after the toolbar DOM exists.

'use strict';

let _svSearchTimer = null;
let _svSearchSeq   = 0;          // monotonic request id to ignore stale replies
let _svSearchItems = [];         // flat list of rendered result rows
let _svSearchHover = -1;         // active index in _svSearchItems

const _SV_KIND_GROUP = {
    class:     'class',
    struct:    'class',
    interface: 'class',
    enum:      'class',
    type:      'class',
    function:  'function',
    method:    'function',
    field:     'field',
    variable:  'field',
    constant:  'field',
    property:  'field',
};

const _SV_GROUP_ORDER = ['class', 'function', 'field', 'other'];
const _SV_GROUP_LABEL = {
    class:    'Classes & Types',
    function: 'Functions & Methods',
    field:    'Fields & Variables',
    other:    'Other',
};

function _svInitSearch() {
    const inp     = document.getElementById('sv-search-input');
    const results = document.getElementById('sv-search-results');
    const clear   = document.getElementById('sv-search-clear');
    if (!inp || !results) return;

    inp.addEventListener('input', () => {
        const q = inp.value.trim();
        if (clear) clear.style.display = q ? '' : 'none';
        if (_svSearchTimer) clearTimeout(_svSearchTimer);
        if (!q) {
            results.hidden = true;
            _svState.searchOpen = false;
            return;
        }
        _svSearchTimer = setTimeout(() => _svRunSearch(q), 180);
    });

    inp.addEventListener('focus', () => {
        if (inp.value.trim()) results.hidden = false;
        _svState.searchOpen = !results.hidden;
    });

    inp.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            results.hidden = true;
            inp.blur();
            _svState.searchOpen = false;
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            _svMoveHover(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            _svMoveHover(-1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            _svActivateHover();
        }
    });

    if (clear) {
        clear.addEventListener('click', () => {
            inp.value = '';
            clear.style.display = 'none';
            results.hidden = true;
            _svState.searchOpen = false;
            inp.focus();
        });
    }

    document.addEventListener('click', (e) => {
        if (!results || results.hidden) return;
        if (e.target.closest('#sv-search-wrap')) return;
        results.hidden = true;
        _svState.searchOpen = false;
    });
}

async function _svRunSearch(q) {
    const results = document.getElementById('sv-search-results');
    if (!results) return;

    const jid = _svState.jobId || window.JOB_ID;
    if (!jid) {
        results.innerHTML = '<div class="sv-search-empty">No job active</div>';
        results.hidden = false;
        _svState.searchOpen = true;
        return;
    }

    if (_svState.searchCache.has(q)) {
        _svRenderSearchResults(_svState.searchCache.get(q), q);
        return;
    }

    const seq = ++_svSearchSeq;
    try {
        const resp = await fetch(`/symbols?job=${encodeURIComponent(jid)}&q=${encodeURIComponent(q)}&limit=40`);
        if (seq !== _svSearchSeq) return;       // stale
        const data = await resp.json();
        const arr  = Array.isArray(data) ? data : (data.symbols || []);
        // Cache, capped at 20 entries
        _svState.searchCache.set(q, arr);
        if (_svState.searchCache.size > 20) {
            const firstKey = _svState.searchCache.keys().next().value;
            _svState.searchCache.delete(firstKey);
        }
        _svRenderSearchResults(arr, q);
    } catch (err) {
        if (seq !== _svSearchSeq) return;
        results.innerHTML = '<div class="sv-search-empty">Search failed</div>';
        results.hidden = false;
        _svState.searchOpen = true;
    }
}

function _svRenderSearchResults(arr, q) {
    const results = document.getElementById('sv-search-results');
    if (!results) return;

    if (!arr || !arr.length) {
        results.innerHTML = `<div class="sv-search-empty">No symbols match &ldquo;${_svEsc(q)}&rdquo;</div>`;
        results.hidden = false;
        _svState.searchOpen = true;
        _svSearchItems = [];
        _svSearchHover = -1;
        return;
    }

    const buckets = { class: [], function: [], field: [], other: [] };
    for (const s of arr) {
        const g = _SV_KIND_GROUP[s.kind] || 'other';
        buckets[g].push(s);
    }

    let html = '';
    let flatIdx = 0;
    const flat  = [];
    for (const g of _SV_GROUP_ORDER) {
        const items = buckets[g];
        if (!items.length) continue;
        html += `<div class="sv-search-group" data-kind="${g}">
          <div class="sv-search-group-label">${_SV_GROUP_LABEL[g]}</div>`;
        for (const s of items) {
            const color = _svKindColor(s.kind);
            const path  = s.file || '';
            const line  = s.line || 0;
            html += `<div class="sv-search-row" data-idx="${flatIdx}" data-symid="${_svEsc(s.id)}">
              <span class="sv-kind-dot" style="background:${color}"></span>
              <span class="sv-search-name">${_svEsc(s.name)}</span>
              <span class="sv-search-path">${_svEsc(path)}${line ? ':' + line : ''}</span>
            </div>`;
            flat.push(s.id);
            flatIdx++;
        }
        html += `</div>`;
    }
    results.innerHTML = html;
    results.hidden    = false;
    _svState.searchOpen = true;
    _svSearchItems    = flat;
    _svSearchHover    = -1;

    results.querySelectorAll('.sv-search-row').forEach(row => {
        row.addEventListener('mouseenter', () => {
            _svSearchHover = parseInt(row.dataset.idx, 10);
            _svSyncHoverClass();
        });
        row.addEventListener('click', () => {
            const sid = row.dataset.symid;
            _svCommitSearch(sid);
        });
    });
}

function _svMoveHover(delta) {
    if (!_svSearchItems.length) return;
    const results = document.getElementById('sv-search-results');
    if (!results || results.hidden) return;
    _svSearchHover = (_svSearchHover + delta + _svSearchItems.length) % _svSearchItems.length;
    _svSyncHoverClass();
    const row = results.querySelector(`.sv-search-row[data-idx="${_svSearchHover}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
}

function _svSyncHoverClass() {
    const results = document.getElementById('sv-search-results');
    if (!results) return;
    results.querySelectorAll('.sv-search-row').forEach(r => {
        r.classList.toggle('sv-search-row-hover', parseInt(r.dataset.idx, 10) === _svSearchHover);
    });
}

function _svActivateHover() {
    if (_svSearchHover < 0 || _svSearchHover >= _svSearchItems.length) {
        // Activate first result as a sensible default
        if (_svSearchItems.length) _svCommitSearch(_svSearchItems[0]);
        return;
    }
    _svCommitSearch(_svSearchItems[_svSearchHover]);
}

function _svCommitSearch(symId) {
    const results = document.getElementById('sv-search-results');
    const inp     = document.getElementById('sv-search-input');
    const clear   = document.getElementById('sv-search-clear');
    if (results) results.hidden = true;
    if (inp) { inp.value = ''; inp.blur(); }
    if (clear) clear.style.display = 'none';
    _svState.searchOpen = false;
    symViewActivate(symId);
}
