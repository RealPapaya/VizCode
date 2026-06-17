// @ts-nocheck -- JS->TS migration: renamed to .ts, type-curation pending. Remove this line and fix errors to enable checking.
// ─── VizCode Help Panel ────────────────────────────────────────────────────────
// Injects the circular "?" button above the Settings icon in the left rail,
// and renders a polished help modal with shortcut reference + usage guide.

(function () {

    // ── i18n helper ───────────────────────────────────────────────────────────
    const _t = k => (typeof T === 'function') ? T(k) : k;

    // ── shortcut data ─────────────────────────────────────────────────────────
    const SHORTCUTS = [
        { keys: ['Scroll'],          desc: 'Zoom in / out' },
        { keys: ['Left drag'],       desc: 'Pan the canvas' },
        { keys: ['Middle drag'],     desc: 'Box-select multiple nodes' },
        { keys: ['Left drag', 'selected node'], desc: 'Move selection as a group' },
        { keys: ['Click node'],      desc: 'Highlight node & neighbours' },
        { keys: ['Dbl-click node'],  desc: 'Drill into file / expand group' },
        { keys: ['Right-click node'],desc: 'Context menu (copy path, open…)' },
        { keys: ['Click edge'],      desc: 'Show dependency details' },
        { keys: ['Esc'],             desc: 'Clear selection / close panels' },
        { keys: ['Alt', 'C'],        desc: 'Toggle AI chat panel' },
        { keys: ['Mouse 4 / 5'],     desc: 'Navigate history (back / forward)' },
        { keys: ['Ctrl', 'F'],       desc: 'Focus search box' },
    ];

    const SECTIONS = [
        {
            title: 'Graph Levels',
            icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><line x1="7" y1="11" x2="17" y2="6.5"/><line x1="7" y1="13" x2="17" y2="17.5"/></svg>`,
            items: [
                { label: 'L0 — Module Overview', desc: 'Top-level module relationship map' },
                { label: 'L1 — File Graph',      desc: 'Files and their dependencies within a module' },
                { label: 'L2 — Call Flow',       desc: 'Function-level call graph inside a file' },
                { label: 'Symbol View',          desc: 'Struct / class member tree (L2 → Structure)' },
            ],
        },
        {
            title: 'Selection & Move',
            icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
            items: [
                { label: 'Box-select',  desc: 'Hold middle mouse button and drag to draw a rectangle' },
                { label: 'Batch move',  desc: 'After selecting, left-drag any selected node to move them all' },
                { label: 'Clear',       desc: 'Press Esc or click on empty canvas to deselect' },
            ],
        },
        {
            title: 'Navigation',
            icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`,
            items: [
                { label: 'Breadcrumb', desc: 'Click path segments to jump back up the hierarchy' },
                { label: 'Back / Fwd', desc: 'Toolbar arrows or Mouse 4 / 5 buttons' },
                { label: 'Fit graph',  desc: 'Click ⊡ fit button (bottom-right zoom controls)' },
            ],
        },
    ];

    // ── build HTML ────────────────────────────────────────────────────────────
    function _buildHelpHTML() {
        const kbdStyle = `
            display:inline-flex;align-items:center;justify-content:center;
            background:var(--panel2);border:1px solid var(--border);
            border-radius:4px;padding:1px 6px;font-size:11px;
            font-family:monospace;color:var(--text);white-space:nowrap;
            box-shadow:0 1px 0 var(--border);line-height:1.6;
        `.replace(/\n\s+/g, '');

        const shortcutRows = SHORTCUTS.map(s => {
            const kbds = s.keys.map(k =>
                `<span style="${kbdStyle}">${k}</span>`
            ).join('<span style="color:var(--muted);font-size:10px;padding:0 3px;">+</span>');
            return `
            <div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid color-mix(in srgb,var(--border) 60%,transparent);">
                <div style="flex:0 0 auto;display:flex;align-items:center;gap:3px;min-width:180px;">${kbds}</div>
                <div style="font-size:12px;color:var(--muted);flex:1;">${s.desc}</div>
            </div>`;
        }).join('');

        const sectionCards = SECTIONS.map(sec => {
            const items = sec.items.map(it => `
                <div style="display:grid;grid-template-columns:140px 1fr;gap:4px 10px;padding:4px 0;border-bottom:1px solid color-mix(in srgb,var(--border) 50%,transparent);">
                    <span style="font-size:12px;color:var(--accent);font-weight:600;font-family:monospace;">${it.label}</span>
                    <span style="font-size:12px;color:var(--muted);">${it.desc}</span>
                </div>`).join('');
            return `
            <div style="margin-bottom:16px;">
                <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--accent);margin-bottom:8px;">
                    ${sec.icon}
                    <span>${sec.title}</span>
                </div>
                ${items}
            </div>`;
        }).join('');

        return `
        <div id="viz-help-modal" style="
            display:none;position:fixed;inset:0;
            background:rgba(0,0,0,0.6);
            z-index:9100;
            align-items:center;justify-content:center;
            backdrop-filter:blur(3px);
        ">
            <div style="
                background:var(--panel);
                border:1px solid var(--border);
                border-radius:12px;
                width:660px;max-width:96vw;max-height:90vh;
                box-shadow:0 16px 48px rgba(0,0,0,0.7);
                display:flex;flex-direction:column;
                overflow:hidden;
                animation:flip-in-x 0.2s ease-out;
            ">
                <!-- Header -->
                <div style="
                    background:var(--panel2);
                    padding:12px 18px;
                    border-bottom:1px solid var(--border);
                    display:flex;align-items:center;justify-content:space-between;
                    flex-shrink:0;
                ">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="
                            width:28px;height:28px;border-radius:50%;
                            background:color-mix(in srgb,var(--accent) 18%,transparent);
                            border:1.5px solid color-mix(in srgb,var(--accent) 60%,transparent);
                            display:grid;place-items:center;
                            color:var(--accent);font-weight:700;font-size:14px;
                        ">?</div>
                        <span style="font-weight:700;font-size:14px;">VizCode — Quick Reference</span>
                    </div>
                    <button id="viz-help-close" style="
                        background:none;border:none;color:var(--muted);
                        cursor:pointer;font-size:18px;line-height:1;padding:0 4px;
                        transition:color 0.15s;
                    " onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--muted)'">✕</button>
                </div>

                <!-- Body — two columns -->
                <div style="display:flex;flex:1;min-height:0;overflow:hidden;">

                    <!-- Left: Keyboard shortcuts -->
                    <div style="
                        width:56%;flex-shrink:0;
                        padding:16px 18px;
                        border-right:1px solid var(--border);
                        overflow-y:auto;
                    ">
                        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--accent);margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>
                            Keyboard &amp; Mouse Shortcuts
                        </div>
                        ${shortcutRows}
                    </div>

                    <!-- Right: Feature sections -->
                    <div style="flex:1;padding:16px 18px;overflow-y:auto;">
                        ${sectionCards}
                        <div style="margin-top:8px;padding:10px 12px;background:color-mix(in srgb,var(--accent) 8%,transparent);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);border-radius:8px;">
                            <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:4px;">💡 Tip</div>
                            <div style="font-size:11px;color:var(--muted);line-height:1.6;">
                                Click the <strong style="color:var(--text)">⚙ Settings</strong> icon at the bottom of the left rail to change theme, font, layout algorithm, and language.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    // ── inject "?" button into rail above pref-btn ────────────────────────────
    function _injectHelpBtn() {
        if (document.getElementById('help-btn')) return;

        const prefBtn = document.getElementById('pref-btn');
        if (!prefBtn) return;

        const btn = document.createElement('button');
        btn.id        = 'help-btn';
        btn.type      = 'button';
        btn.title     = 'Help & Shortcuts';
        btn.setAttribute('data-tip', 'Help & Shortcuts');
        btn.setAttribute('aria-label', 'Help & Shortcuts');
        btn.className = 'rail-btn';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none"/>
            </svg>
            <span>Help</span>`;

        // Match other rail-btn icons: muted, hover → text color + panel2 bg
        btn.addEventListener('mouseover', () => {
            btn.style.color = 'var(--text)';
            btn.style.background = 'var(--panel2)';
        });
        btn.addEventListener('mouseout', () => {
            btn.style.color = 'var(--muted)';
            btn.style.background = 'transparent';
        });

        btn.addEventListener('click', () => _openHelp());

        // Insert before pref-btn
        prefBtn.parentNode.insertBefore(btn, prefBtn);
    }

    // ── modal open / close ────────────────────────────────────────────────────
    function _openHelp() {
        let modal = document.getElementById('viz-help-modal');
        if (!modal) {
            document.body.insertAdjacentHTML('beforeend', _buildHelpHTML());
            modal = document.getElementById('viz-help-modal');
            document.getElementById('viz-help-close')?.addEventListener('click', _closeHelp);
            modal.addEventListener('click', e => { if (e.target === modal) _closeHelp(); });
        }
        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.style.display = 'flex');
    }

    function _closeHelp() {
        const modal = document.getElementById('viz-help-modal');
        if (modal) modal.style.display = 'none';
    }

    // ── keyboard shortcut: Shift+? to open help ───────────────────────────────
    document.addEventListener('keydown', e => {
        if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const tag = (document.activeElement || {}).tagName || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            _openHelp();
        }
        if (e.key === 'Escape') _closeHelp();
    });

    // ── init ──────────────────────────────────────────────────────────────────
    function initHelp() {
        _injectHelpBtn();
    }

    window.initHelp = initHelp;

    // Auto-run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initHelp);
    } else {
        // Try immediately; if rail not yet created, wait a tick
        if (document.getElementById('pref-btn')) {
            initHelp();
        } else {
            const _wait = setInterval(() => {
                if (document.getElementById('pref-btn')) {
                    clearInterval(_wait);
                    initHelp();
                }
            }, 150);
        }
    }

})();
