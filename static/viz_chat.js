// ── VizBridge Chat Panel ──────────────────────────────────────────────────────
//
// Floating AI chat panel for VizCode graph visualization.
// Communicates with server.py via:
//   POST /chat-stream   → SSE streaming response
//   GET  /chat-config   → read provider config
//   POST /chat-config   → save provider config
//
// Public API (called from viz.js):
//   initChat()          — build DOM, attach events

(function () {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────────
    let _isOpen       = false;
    let _isBusy       = false;       // waiting for AI response
    let _eventSource  = null;        // active SSE connection
    let _history      = [];          // [{role, content}] sent to server
    let _streamBubble = null;        // DOM element currently streaming into
    let _streamText   = '';          // accumulated text for current stream bubble

    // ── DOM refs (populated in initChat) ─────────────────────────────────────
    let _btn, _panel, _msgs, _input, _sendBtn, _modal;

    // ── Markdown-lite renderer ────────────────────────────────────────────────
    // Handles: ``` code blocks, `inline code`, **bold**, *italic*
    function _renderMarkdown(text) {
        // Escape HTML first
        let t = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Fenced code blocks (```lang\n...\n```)
        t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
            const cls = lang ? ` class="language-${lang}"` : '';
            return `<pre><code${cls}>${code.trimEnd()}</code></pre>`;
        });

        // Inline code
        t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');

        // Bold
        t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Italic (single *)
        t = t.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

        // Paragraphs (double newline)
        t = t.replace(/\n{2,}/g, '</p><p>');
        return '<p>' + t + '</p>';
    }

    // ── Panel open / close ───────────────────────────────────────────────────
    function _open() {
        _isOpen = true;
        _panel.classList.add('open');
        _btn.classList.add('active');
        _btn.textContent = '✕';
        setTimeout(() => _input.focus(), 220);
    }

    function _close() {
        _isOpen = false;
        _panel.classList.remove('open');
        _btn.classList.remove('active');
        _btn.textContent = '💬';
    }

    function toggleChatPanel() {
        _isOpen ? _close() : _open();
    }

    // ── Message DOM helpers ───────────────────────────────────────────────────
    function _appendMsg(role, htmlContent) {
        const div = document.createElement('div');
        div.className = role === 'user' ? 'chat-msg chat-msg-user'
                      : role === 'sys'  ? 'chat-msg-sys'
                      : role === 'err'  ? 'chat-msg-err'
                      : 'chat-msg chat-msg-ai';
        if (role === 'user' || role === 'sys' || role === 'err') {
            div.textContent = htmlContent;  // safe
        } else {
            div.innerHTML = htmlContent;    // pre-rendered markdown
        }
        _msgs.appendChild(div);
        _scrollBottom();
        return div;
    }

    function _appendToolBadge(name, result) {
        const badge = document.createElement('div');
        badge.className = 'chat-tool-badge';
        badge.innerHTML = `<span class="tool-icon">🔍</span><span>${_escHtml(name)}</span>`;

        const resultBox = document.createElement('pre');
        resultBox.className = 'chat-tool-result';
        resultBox.textContent = result;

        badge.addEventListener('click', function () {
            resultBox.classList.toggle('show');
        });

        _msgs.appendChild(badge);
        _msgs.appendChild(resultBox);
        _scrollBottom();
    }

    function _appendTyping() {
        const div = document.createElement('div');
        div.className = 'chat-typing';
        div.innerHTML = '<span></span><span></span><span></span>';
        div.id = '_chat-typing';
        _msgs.appendChild(div);
        _scrollBottom();
        return div;
    }

    function _removeTyping() {
        const el = document.getElementById('_chat-typing');
        if (el) el.remove();
    }

    function _startStreamBubble() {
        _streamText   = '';
        _streamBubble = document.createElement('div');
        _streamBubble.className = 'chat-msg chat-msg-ai';
        _msgs.appendChild(_streamBubble);
        _scrollBottom();
    }

    function _appendStreamDelta(text) {
        _streamText += text;
        _streamBubble.innerHTML = _renderMarkdown(_streamText);
        _scrollBottom();
    }

    function _finaliseStreamBubble() {
        // Already rendered — nothing to do
        _streamBubble = null;
        _streamText   = '';
    }

    function _scrollBottom() {
        _msgs.scrollTop = _msgs.scrollHeight;
    }

    function _escHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Send message ─────────────────────────────────────────────────────────
    function _sendMessage() {
        const text = _input.value.trim();
        if (!text || _isBusy) return;

        _input.value = '';
        _input.style.height = '';   // reset auto-grow
        _appendMsg('user', text);

        _history.push({ role: 'user', content: text });
        _setBusy(true);

        const jobId = window.JOB_ID || '';
        const body  = JSON.stringify({ job_id: jobId, history: _history });

        _removeTyping();
        _appendTyping();

        fetch('/chat-stream', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    body,
        }).then(function (resp) {
            if (!resp.ok) {
                return resp.json().then(function (err) {
                    throw new Error(err.error || 'Server error ' + resp.status);
                });
            }
            _removeTyping();
            _startStreamBubble();
            _readSSE(resp.body);
        }).catch(function (err) {
            _removeTyping();
            _appendMsg('err', 'Error: ' + err.message);
            _setBusy(false);
        });
    }

    // ── SSE reader (ReadableStream) ───────────────────────────────────────────
    function _readSSE(readableStream) {
        const reader  = readableStream.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        const assistantContent = [];   // accumulates for history

        function pump() {
            reader.read().then(function ({ done, value }) {
                if (done) {
                    _finishTurn(assistantContent);
                    return;
                }
                buf += decoder.decode(value, { stream: true });

                // Process complete SSE messages (separated by \n\n)
                let idx;
                while ((idx = buf.indexOf('\n\n')) !== -1) {
                    const raw = buf.slice(0, idx);
                    buf = buf.slice(idx + 2);

                    for (const line of raw.split('\n')) {
                        if (!line.startsWith('data:')) continue;
                        const dataStr = line.slice(5).trim();
                        if (!dataStr) continue;
                        try {
                            const ev = JSON.parse(dataStr);
                            _handleSSEEvent(ev, assistantContent);
                        } catch (_) {}
                    }
                }
                pump();
            }).catch(function (err) {
                _removeTyping();
                _appendMsg('err', 'Stream error: ' + err.message);
                _setBusy(false);
            });
        }
        pump();
    }

    function _handleSSEEvent(ev, assistantContent) {
        if (ev.type === 'delta') {
            if (!_streamBubble) _startStreamBubble();
            _appendStreamDelta(ev.text);
            assistantContent.push({ type: 'text_fragment', text: ev.text });

        } else if (ev.type === 'tool_call') {
            _appendToolBadge(ev.name, ev.result || '');

        } else if (ev.type === 'done') {
            // handled in finishTurn after stream ends

        } else if (ev.type === 'error') {
            _removeTyping();
            if (_streamBubble) {
                _streamBubble.remove();
                _streamBubble = null;
            }
            _appendMsg('err', ev.message || 'Unknown error');
        }
    }

    function _finishTurn(assistantContent) {
        if (_streamBubble) _finaliseStreamBubble();
        _removeTyping();

        // Append assistant turn to history (merge text fragments)
        const fullText = assistantContent
            .filter(function (c) { return c.type === 'text_fragment'; })
            .map(function (c) { return c.text; })
            .join('');
        if (fullText) {
            _history.push({ role: 'assistant', content: fullText });
        }

        _setBusy(false);
    }

    function _setBusy(busy) {
        _isBusy = busy;
        _sendBtn.disabled = busy;
        _input.disabled   = busy;
    }

    // ── Config modal ──────────────────────────────────────────────────────────
    async function _openConfigModal() {
        let cfg = {};
        try {
            const r = await fetch('/chat-config');
            if (r.ok) cfg = await r.json();
        } catch (_) {}

        document.getElementById('chat-cfg-provider').value       = cfg.provider || 'anthropic';
        document.getElementById('chat-cfg-anthropic-key').value  = cfg.anthropic_api_key || '';
        document.getElementById('chat-cfg-anthropic-model').value = cfg.anthropic_model || 'claude-sonnet-4-6';
        _modal.classList.remove('hidden');
    }

    function _closeConfigModal() {
        _modal.classList.add('hidden');
    }

    async function _saveConfig() {
        const cfg = {
            provider:          document.getElementById('chat-cfg-provider').value,
            anthropic_api_key: document.getElementById('chat-cfg-anthropic-key').value.trim(),
            anthropic_model:   document.getElementById('chat-cfg-anthropic-model').value.trim(),
        };
        try {
            await fetch('/chat-config', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(cfg),
            });
            _closeConfigModal();
            _appendMsg('sys', 'AI provider saved.');
        } catch (e) {
            alert('Failed to save config: ' + e.message);
        }
    }

    // ── Build DOM ─────────────────────────────────────────────────────────────
    function _buildDOM() {
        // Button
        _btn = document.getElementById('chat-btn');
        if (!_btn) return false;

        // Panel refs
        _panel   = document.getElementById('chat-panel');
        _msgs    = document.getElementById('chat-messages');
        _input   = document.getElementById('chat-input');
        _sendBtn = document.getElementById('chat-send');
        _modal   = document.getElementById('chat-config-modal');

        return true;
    }

    // ── Attach events ─────────────────────────────────────────────────────────
    function _attachEvents() {
        _btn.addEventListener('click', toggleChatPanel);

        document.getElementById('chat-close').addEventListener('click', _close);

        _sendBtn.addEventListener('click', _sendMessage);

        _input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                _sendMessage();
            }
        });

        // Auto-grow textarea
        _input.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        // Config button in header
        const cfgBtn = document.getElementById('chat-cfg-btn');
        if (cfgBtn) cfgBtn.addEventListener('click', _openConfigModal);

        // Modal buttons
        document.getElementById('chat-config-save').addEventListener('click', _saveConfig);
        document.getElementById('chat-config-cancel').addEventListener('click', _closeConfigModal);

        // Close modal on backdrop click
        _modal.addEventListener('click', function (e) {
            if (e.target === _modal) _closeConfigModal();
        });

        // Keyboard shortcut: Alt+C toggles chat
        document.addEventListener('keydown', function (e) {
            if (e.altKey && e.key === 'c') {
                e.preventDefault();
                toggleChatPanel();
            }
        });
    }

    // ── Check if configured ───────────────────────────────────────────────────
    async function _checkConfig() {
        try {
            const r = await fetch('/chat-config');
            if (!r.ok) return;
            const cfg = await r.json();
            // If no API key is set at all, prompt setup on first open
            const hasKey = cfg.anthropic_api_key || cfg.openai_api_key || cfg.gemini_api_key;
            if (!hasKey) {
                _btn.title = 'AI Chat — click to set up';
                // Override open to show config first
                const origOpen = _open;
                const setupAndOpen = function () {
                    origOpen();
                    _openConfigModal();
                    _btn.removeEventListener('click', setupAndOpen);
                    _btn.addEventListener('click', toggleChatPanel);
                };
                _btn.removeEventListener('click', toggleChatPanel);
                _btn.addEventListener('click', setupAndOpen);
            }
        } catch (_) {}
    }

    // ── Public init ───────────────────────────────────────────────────────────
    function initChat() {
        if (!_buildDOM()) return;   // HTML elements not present (launcher page)
        _attachEvents();
        _checkConfig();
    }

    // Expose globally so viz.js can call initChat()
    window.initChat = initChat;

})();
