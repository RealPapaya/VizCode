const _srState = {
  mode: "files",
  // 'files' | 'code'
  query: "",
  // Toggle flags
  matchCase: false,
  wholeWord: false,
  isRegex: false,
  // Filter strings (VS Code-style globs, applied server-side for code, client-side for files)
  include: "",
  exclude: "",
  // Flat results (files mode only)
  results: [],
  activeIdx: -1,
  // Content search state (code mode)
  _contentGroups: [],
  // [{path,label,module,ext,count,matches,color}]
  _contentTotal: 0,
  _contentFiles: 0,
  _contentLoading: false,
  _contentDone: false,
  _contentError: "",
  _contentIndexed: false,
  // true = server used in-memory index (⚡ fast)
  // View mode (code search)
  viewMode: "list",
  // 'list' | 'tree'
  // View mode (file search)
  fileViewMode: "list",
  // 'list' | 'tree'
  // Tree expand state
  _openGroups: /* @__PURE__ */ new Set(),
  // open file groups (code mode)
  _openFolders: /* @__PURE__ */ new Set(),
  // open folder nodes (tree mode)
  _openFileFolders: /* @__PURE__ */ new Set(),
  // open folder nodes (file tree mode)
  // Advanced filter
  _filterFuncOnly: false,
  // show only lines that look like func definitions
  // Virtual scroll
  _vsEnd: 0,
  // items rendered so far (both modes)
  // Streaming render state (code mode)
  _streamRendered: false,
  _streamRenderMode: "",
  // Local index
  _indexBuilt: false,
  _fileIndex: []
  // [{label,path,module,ext,file_type,func_count,size}]
};
let _srStream = null;
let _srStreamBatchTimer = null;
let _srStreamPending = [];
let _srCodeFilterTimer = null;
let _srFileFilterTimer = null;
function _srBuildIndex() {
  if (_srState._indexBuilt || !window.DATA) return;
  _srState._indexBuilt = true;
  for (const [, files] of Object.entries(DATA.files_by_module || {})) {
    for (const f of files) {
      _srState._fileIndex.push({
        label: f.label,
        path: f.path,
        module: f.path.split("/")[0] || "_root",
        ext: f.ext || "",
        file_type: f.file_type || "other",
        func_count: f.func_count || 0,
        size: f.size || 0
      });
    }
  }
  for (const [, files] of Object.entries(DATA.other_files_by_module || {})) {
    for (const f of files) {
      _srState._fileIndex.push({
        label: f.label,
        path: f.path,
        module: f.path.split("/")[0] || "_root",
        ext: f.ext || "",
        file_type: f.file_type || "other",
        func_count: 0,
        size: f.size || 0,
        _isOther: true
      });
    }
  }
}
function _srScore(text, q) {
  const t = text.toLowerCase(), ql = q.toLowerCase();
  if (!t.includes(ql)) return -1;
  if (t === ql) return 1e3;
  if (t.indexOf(ql) === 0) return 500;
  return 100 - t.indexOf(ql);
}
function _srApplyToggles(text) {
  const q = _srState.query;
  if (!q) return false;
  let t = text, ql = q;
  if (!_srState.matchCase) {
    t = t.toLowerCase();
    ql = ql.toLowerCase();
  }
  if (_srState.wholeWord) {
    const re = new RegExp(
      "\\b" + ql.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b",
      _srState.matchCase ? "" : "i"
    );
    return re.test(text);
  }
  return t.includes(ql);
}
function _srHighlight(text, q) {
  if (!q) return escapeHtml(text);
  const flags = _srState.matchCase ? "g" : "gi";
  let pattern;
  try {
    const core = _srState.isRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wrapped = _srState.wholeWord ? "\\b" + core + "\\b" : core;
    pattern = new RegExp(wrapped, flags);
  } catch (_) {
    return escapeHtml(text);
  }
  return escapeHtml(text).replace(pattern, (m) => `<mark>${m}</mark>`);
}
function _srFuzzyHighlight(text, positions) {
  if (!positions || positions.length === 0) return escapeHtml(text);
  const posSet = new Set(positions);
  let html = "";
  for (let i = 0; i < text.length; i++) {
    const ch = escapeHtml(text[i]);
    if (posSet.has(i)) {
      html += `<mark class="sr-fuzzy-mark">${ch}</mark>`;
    } else {
      html += ch;
    }
  }
  return html;
}
function _srFuzzyPositions(text, q) {
  const t = _srState.matchCase ? text : text.toLowerCase();
  const ql = _srState.matchCase ? q : q.toLowerCase();
  const positions = [];
  let qi = 0;
  for (let i = 0; i < t.length && qi < ql.length; i++) {
    if (t[i] === ql[qi]) {
      positions.push(i);
      qi++;
    }
  }
  return qi === ql.length ? positions : null;
}
function _srSearchFiles(q) {
  if (!q) return [];
  const ql = q.toLowerCase();
  function globMatch(path, pattern2) {
    const re = pattern2.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\x00/g, ".*").replace(/\?/g, "[^/]");
    try {
      return new RegExp("^" + re + "$", "i").test(path) || new RegExp(re, "i").test(path.split("/").pop());
    } catch (_) {
      return false;
    }
  }
  const incGlobs = (_srState.include || "").split(",").map((s) => s.trim()).filter(Boolean);
  const excGlobs = (_srState.exclude || "").split(",").map((s) => s.trim()).filter(Boolean);
  function fuzzyMatch(text) {
    const t = text.toLowerCase();
    let qi = 0;
    for (let i = 0; i < t.length && qi < ql.length; i++) {
      if (t[i] === ql[qi]) qi++;
    }
    return qi === ql.length;
  }
  function score(f) {
    const label = f.label.toLowerCase();
    const path = f.path.toLowerCase();
    if (label === ql) return 1e4;
    if (label.startsWith(ql)) return 5e3 + (100 - Math.min(label.length, 100));
    const li = label.indexOf(ql);
    if (li >= 0) return 3e3 + (100 - Math.min(li, 100));
    const pi = path.indexOf(ql);
    if (pi >= 0) return 1e3 + (100 - Math.min(pi, 100));
    if (fuzzyMatch(f.label)) return 500;
    if (fuzzyMatch(f.path)) return 100;
    return -1;
  }
  const mc = _srState.matchCase;
  const ww = _srState.wholeWord;
  const rx = _srState.isRegex;
  let pattern = null;
  if (rx) {
    try {
      pattern = new RegExp(q, mc ? "" : "i");
    } catch (_) {
      pattern = null;
    }
  }
  const scored = [];
  for (const f of _srState._fileIndex) {
    if (incGlobs.length > 0 && !incGlobs.some((g) => globMatch(f.path, g))) continue;
    if (excGlobs.length > 0 && excGlobs.some((g) => globMatch(f.path, g))) continue;
    let s = -1;
    if (pattern) {
      if (pattern.test(f.label) || pattern.test(f.path)) s = 1e3;
    } else if (ww) {
      const re = new RegExp("\\b" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", mc ? "" : "i");
      if (re.test(f.label) || re.test(f.path)) s = score(f);
    } else {
      s = score(f);
    }
    if (s >= 0) {
      let _fuzzyLabelPos = null, _fuzzyPathPos = null;
      if (s < 1e3 && !pattern && !ww) {
        _fuzzyLabelPos = _srFuzzyPositions(f.label, q);
        if (!_fuzzyLabelPos) _fuzzyPathPos = _srFuzzyPositions(f.path, q);
      }
      scored.push({ ...f, _score: s, _type: "file", _fuzzyLabelPos, _fuzzyPathPos });
    }
  }
  scored.sort((a, b) => b._score - a._score || a.label.localeCompare(b.label));
  return scored;
}
function _srStartStream(q) {
  if (_srStream) {
    _srStream.close();
    _srStream = null;
  }
  clearTimeout(_srStreamBatchTimer);
  _srStreamPending = [];
  _srState._streamRendered = false;
  _srState._streamRenderMode = _srState.viewMode;
  if (!codeState.jobId || !q) {
    _srState._contentGroups = [];
    _srState._contentTotal = 0;
    _srState._contentFiles = 0;
    _srState._contentLoading = false;
    _srState._contentDone = true;
    _srRenderResults();
    _srRenderActionBar();
    return;
  }
  _srState._contentGroups = [];
  _srState._contentTotal = 0;
  _srState._contentFiles = 0;
  _srState._contentError = "";
  _srState._contentLoading = true;
  _srState._contentDone = false;
  _srRenderResults();
  _srRenderActionBar();
  const params = new URLSearchParams({
    job: codeState.jobId,
    q,
    match_case: _srState.matchCase ? "1" : "0",
    whole_word: _srState.wholeWord ? "1" : "0",
    is_regex: _srState.isRegex ? "1" : "0",
    include: _srState.include,
    exclude: _srState.exclude
  });
  const capturedQ = q;
  const es = new EventSource(`/search-stream?${params}`);
  _srStream = es;
  function _flush() {
    if (_srStreamPending.length === 0) return;
    _srState._contentGroups.push(..._srStreamPending);
    _srStreamPending = [];
    _srStreamBatchTimer = null;
    if (_srState.query === capturedQ) {
      _srRenderStreamingBatch();
      _srRenderActionBar();
      const countEl = document.getElementById("sr-count");
      if (countEl) {
        const n = _srState._contentTotal;
        countEl.textContent = n > 0 ? n.toLocaleString() : "";
        countEl.style.color = "var(--accent)";
      }
    }
  }
  es.onmessage = (e) => {
    if (_srState.query !== capturedQ) {
      es.close();
      _srStream = null;
      return;
    }
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch (_) {
      return;
    }
    if (msg.error) {
      _srState._contentError = msg.error;
      _srState._contentLoading = false;
      _srState._contentDone = true;
      es.close();
      _srStream = null;
      _srRenderResults();
      _srRenderActionBar();
      return;
    }
    if (msg.group) {
      _srStreamPending.push(msg.group);
      _srState._contentTotal += msg.group.count;
      _srState._contentFiles++;
      if (!_srStreamBatchTimer) {
        _srStreamBatchTimer = setTimeout(_flush, 80);
      }
    }
    if (msg.done) {
      clearTimeout(_srStreamBatchTimer);
      _flush();
      _srState._contentLoading = false;
      _srState._contentDone = true;
      _srState._contentIndexed = msg.indexed || false;
      es.close();
      _srStream = null;
      const needsFullRender = _srState.viewMode === "tree" || _srState._filterFuncOnly || _srState._contentGroups.length === 0;
      if (needsFullRender) {
        _srRenderResults();
      } else {
        const resultsEl = document.getElementById("sr-results");
        const bar = resultsEl?.querySelector(".sr-streaming-bar");
        if (bar) bar.remove();
      }
      _srRenderActionBar();
    }
  };
  es.onerror = () => {
    if (_srState.query !== capturedQ) return;
    _srState._contentLoading = false;
    _srState._contentDone = true;
    clearTimeout(_srStreamBatchTimer);
    _flush();
    es.close();
    _srStream = null;
    const needsFullRender = _srState.viewMode === "tree" || _srState._filterFuncOnly || _srState._contentGroups.length === 0;
    if (needsFullRender) {
      _srRenderResults();
    } else {
      const resultsEl = document.getElementById("sr-results");
      const bar = resultsEl?.querySelector(".sr-streaming-bar");
      if (bar) bar.remove();
    }
    _srRenderActionBar();
  };
}
let _srDebounceTimer = null;
function _srDebounce(q) {
  clearTimeout(_srDebounceTimer);
  _srState._contentLoading = true;
  _srDebounceTimer = setTimeout(() => _srStartStream(q), 300);
}
function _srLineIsFunc(line, ext) {
  const t = line.trim();
  if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("#")) return false;
  if ([".c", ".cpp", ".cc", ".h", ".hpp"].includes(ext))
    return /\w[\w\s*]+\s+\w+\s*\(/.test(t) && !/^\s*(if|for|while|switch|return|#)\b/.test(t);
  if (ext === ".py") return /^\s*(async\s+)?def\s+\w/.test(t);
  if ([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"].includes(ext))
    return /^\s*(export\s+)?(default\s+)?(async\s+)?function\b/.test(t) || /^\s*(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/.test(t) || /^\s*(const|let|var)\s+\w+\s*=\s*function\b/.test(t);
  if (ext === ".go") return /^\s*func\s+/.test(t);
  if ([".inf", ".dec", ".dsc"].includes(ext)) return /^\[/.test(t);
  return false;
}
function _srFilteredGroups() {
  let groups = _srState._contentGroups;
  if (_srState._filterFuncOnly) {
    groups = groups.map((g) => {
      const funcMatches = g.matches.filter((m) => _srLineIsFunc(m.text, g.ext));
      return funcMatches.length > 0 ? { ...g, matches: funcMatches, count: funcMatches.length } : null;
    }).filter(Boolean);
  }
  return groups;
}
function _srAvailableExts() {
  const counts = {};
  for (const g of _srState._contentGroups) {
    counts[g.ext] = (counts[g.ext] || 0) + g.count;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
function _srModuleColor(modId) {
  if (!window.DATA) return "#64748b";
  const mod = (DATA.modules || []).find((m) => m.id === modId);
  return mod?.color || "#64748b";
}
function _iconFolderClosed() {
  return `<svg class="tree-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="var(--icon-folder)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
    </svg>`;
}
function _iconFolderOpen() {
  return `<svg class="tree-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="var(--icon-folder-open)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>
    </svg>`;
}
function _iconFile() {
  return `<svg class="tree-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="var(--icon-file)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/>
        <path d="M14 2v5a1 1 0 0 0 1 1h5"/>
    </svg>`;
}
function _extIcon(_ext) {
  return _iconFile();
}
function _srCollapseAll() {
  _srState._openGroups.clear();
  _srState._openFolders.clear();
  document.querySelectorAll("#sr-results .sr-match-lines").forEach((el) => el.style.display = "none");
  document.querySelectorAll("#sr-results .sr-chevron").forEach((el) => {
    el.classList.remove("open");
    el.textContent = "\u25B8";
  });
  document.querySelectorAll("#sr-results .sr-tree-folder-body").forEach((el) => el.style.display = "none");
  _srRenderActionBar();
}
function _srExpandAll() {
  _srState._contentGroups.forEach((g) => _srState._openGroups.add(g.path));
  if (_srState.viewMode === "tree") {
    _srState._contentGroups.forEach((g) => {
      const parts = g.path.split("/");
      for (let i = 1; i < parts.length; i++) {
        _srState._openFolders.add(parts.slice(0, i).join("/"));
      }
    });
  }
  const groups = _srFilteredGroups();
  if (groups.length <= 200) {
    groups.forEach((g) => {
      const hdr = document.querySelector(`#sr-results .sr-file-header[data-gpath="${CSS.escape(g.path)}"]`);
      if (!hdr) return;
      const grp = hdr.closest(".sr-file-group");
      if (!grp) return;
      let lines = grp.querySelector(".sr-match-lines");
      if (!lines) {
        lines = document.createElement("div");
        lines.className = "sr-match-lines";
        lines.innerHTML = _srMatchLinesHtml(g);
        grp.appendChild(lines);
        _srWireLineRows(lines);
      }
      lines.style.display = "";
      const chev = hdr.querySelector(".sr-chevron");
      if (chev) {
        chev.classList.add("open");
        chev.textContent = "\u25BE";
      }
    });
    _srRenderActionBar();
  } else {
    _srRenderResults();
  }
}
function _srMatchLinesHtml(g) {
  const q = _srState.query;
  let html = "";
  g.matches.forEach((m) => {
    const snip = m.text || "";
    const snipHl = escapeHtml(snip.slice(0, m.ms)) + "<mark>" + escapeHtml(snip.slice(m.ms, m.me)) + "</mark>" + escapeHtml(snip.slice(m.me));
    const isFn = _srLineIsFunc(snip, g.ext);
    html += `<div class="sr-line-row${isFn ? " sr-line-func" : ""}" data-gpath="${escapeHtml(g.path)}" data-line="${m.line}">
    <span class="sr-line-num">${m.line}</span>
    ${isFn ? '<span class="sr-fn-tag" data-tip="Function definition">\u0192</span>' : ""}
    <span class="sr-line-text">${snipHl}</span>
  </div>`;
  });
  return html;
}
function _srWireLineRows(container) {
  container.querySelectorAll(".sr-line-row").forEach((row) => {
    const path = row.dataset.gpath;
    const line = parseInt(row.dataset.line, 10);
    row.addEventListener("click", () => _srSelectContentLine(path, line));
    row.addEventListener("mouseenter", () => _srHoverResult({ path }));
  });
}
function _srBuildTree(groups) {
  const root = { name: "", path: "", children: [], files: [] };
  const nodeMap = { "": root };
  function getNode(folderPath) {
    if (nodeMap[folderPath]) return nodeMap[folderPath];
    const parts = folderPath.split("/");
    const name = parts[parts.length - 1];
    const parent = parts.slice(0, -1).join("/");
    const parentNode = getNode(parent);
    const node = { name, path: folderPath, children: [], files: [] };
    parentNode.children.push(node);
    nodeMap[folderPath] = node;
    return node;
  }
  for (const g of groups) {
    const lastSlash = g.path.lastIndexOf("/");
    const folder = lastSlash >= 0 ? g.path.slice(0, lastSlash) : "";
    getNode(folder).files.push(g);
  }
  function sortNode(n) {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.files.sort((a, b) => a.label.localeCompare(b.label));
    n.children.forEach(sortNode);
  }
  sortNode(root);
  return root;
}
function _srRenderTreeNode(node, q, depth) {
  let html = "";
  const indent = depth * 14;
  for (const child of node.children) {
    const isOpen = _srState._openFolders.has(child.path);
    const chev = isOpen ? "\u25BE" : "\u25B8";
    const matchCount = _countTreeMatches(child);
    html += `<div class="sr-tree-folder">
  <div class="sr-tree-folder-hdr" data-fpath="${escapeHtml(child.path)}" style="padding-left:${indent + 6}px">
    <span class="sr-chevron${isOpen ? " open" : ""}">${chev}</span>
    <span class="sr-tree-folder-icon">${isOpen ? _iconFolderOpen() : _iconFolderClosed()}</span>
    <span class="sr-tree-folder-name">${escapeHtml(child.name)}</span>
    <span class="sr-match-badge" style="margin-left:auto">${matchCount}</span>
  </div>`;
    if (isOpen) {
      html += `<div class="sr-tree-folder-body">`;
      html += _srRenderTreeNode(child, q, depth + 1);
      html += `</div>`;
    }
    html += `</div>`;
  }
  for (const g of node.files) {
    const isOpen = _srState._openGroups.has(g.path);
    const chev = isOpen ? "\u25BE" : "\u25B8";
    const ic = _extIcon(g.ext);
    const mc = g.color || _srModuleColor(g.module);
    const fnHl = _srHighlight(g.label, q);
    html += `<div class="sr-file-group">
  <div class="sr-file-header sr-tree-file-hdr" data-gpath="${escapeHtml(g.path)}" style="padding-left:${indent + 22}px">
    <span class="sr-chevron${isOpen ? " open" : ""}">${chev}</span>
    <span class="sr-file-icon">${ic}</span>
    <div class="sr-file-name-wrap">
      <span class="sr-file-name">${fnHl}</span>
    </div>
    <span class="sr-match-badge">${g.count}</span>
    <span class="sr-meta-mod" style="background:${mc}22;color:${mc};border:1px solid ${mc}44;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;flex-shrink:0">${escapeHtml(g.module)}</span>
  </div>`;
    if (isOpen) {
      html += `<div class="sr-match-lines">`;
      g.matches.forEach((m) => {
        const snip = m.text || "";
        const snipHl = escapeHtml(snip.slice(0, m.ms)) + "<mark>" + escapeHtml(snip.slice(m.ms, m.me)) + "</mark>" + escapeHtml(snip.slice(m.me));
        html += `<div class="sr-line-row" data-gpath="${escapeHtml(g.path)}" data-line="${m.line}" style="padding-left:${indent + 44}px">
      <span class="sr-line-num">${m.line}</span>
      <span class="sr-line-text">${snipHl}</span>
    </div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  }
  return html;
}
function _countTreeMatches(node) {
  let n = node.files.reduce((s, f) => s + f.count, 0);
  for (const c of node.children) n += _countTreeMatches(c);
  return n;
}
function _srRenderActionBar() {
  const bar = document.getElementById("sr-action-bar");
  if (!bar) return;
  const active = document.activeElement;
  const restoreFocus = active && bar.contains(active) && active.classList.contains("sr-ab-filter-input") ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  const hasActiveSearch = !!(_srState.query || _srState.include || _srState.exclude);
  const hasResults = _srState.mode === "code" ? _srState._contentGroups.length > 0 || _srState._contentLoading || hasActiveSearch : _srState.results.length > 0 || hasActiveSearch;
  if (!hasResults) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "flex";
  bar.style.flexDirection = "column";
  bar.style.gap = "0";
  bar.style.padding = "0";
  const isTree = _srState.viewMode === "tree";
  const loading = _srState._contentLoading;
  const indexed = _srState._contentIndexed;
  if (_srState.mode === "code") {
    let _abChanged2 = function() {
      _srState.include = incInput?.value.trim() || "";
      _srState.exclude = excInput?.value.trim() || "";
      clearTimeout(_srCodeFilterTimer);
      _srCodeFilterTimer = setTimeout(() => {
        if (_srState.query) _srDebounce(_srState.query);
        else _srRenderActionBar();
      }, 400);
    };
    var _abChanged = _abChanged2;
    const totalShown = _srFilteredGroups().length;
    const totalAll = _srState._contentFiles;
    const filtered = totalShown < totalAll;
    bar.innerHTML = `
<div class="sr-ab-top">
  <span class="sr-ab-info">
    <span class="sr-ab-count">${_srState._contentTotal.toLocaleString()}</span>
    <span class="sr-ab-label">${T("searchResults")}</span>
    <span class="sr-ab-label">${T("searchIn")}</span>
    <span class="sr-ab-count">${totalShown.toLocaleString()}${filtered ? `<span class="sr-ab-filtered">/${totalAll}</span>` : ""}</span>
    <span class="sr-ab-label">${T("searchFilesWord")}</span>
    ${loading ? '<span class="sr-ab-scanning">scanning\u2026</span>' : ""}
  </span>
  <span class="sr-ab-spacer"></span>
  <button class="sr-ab-btn${_srState._filterFuncOnly ? " active" : ""}" id="sr-ab-func" data-tip="Show only function-definition matches">\u0192</button>
  <div class="sr-ab-sep"></div>
  <button class="sr-ab-btn" id="sr-collapse-all" data-tip="Collapse All">\u229F</button>
  <button class="sr-ab-btn" id="sr-expand-all"   data-tip="Expand All">\u229E</button>
  <div class="sr-ab-sep"></div>
  <button class="sr-ab-btn${!isTree ? " active" : ""}" id="sr-view-list" data-tip="View as List">\u2261</button>
  <button class="sr-ab-btn${isTree ? " active" : ""}" id="sr-view-tree" data-tip="View as Tree">\u2B21</button>
</div>
<div class="sr-ab-filters">
  <div class="sr-ab-filter-input-wrap" data-tip="${T("searchIncludeTip")}">
    <span class="sr-ab-filter-icon">\u2295</span>
    <input class="sr-ab-filter-input" id="sr-ab-inc" type="text" value="${escapeHtml(_srState.include)}" placeholder="${T("searchIncludeLong")}" spellcheck="false" autocomplete="off">
    ${_srState.include ? `<button class="sr-ab-filter-clear" data-target="inc">\u2715</button>` : ""}
  </div>
  <div class="sr-ab-filter-input-wrap" data-tip="${T("searchExcludeTip")}">
    <span class="sr-ab-filter-icon sr-ab-filter-exc">\u2296</span>
    <input class="sr-ab-filter-input" id="sr-ab-exc" type="text" value="${escapeHtml(_srState.exclude)}" placeholder="${T("searchExcludeLong")}" spellcheck="false" autocomplete="off">
    ${_srState.exclude ? `<button class="sr-ab-filter-clear" data-target="exc">\u2715</button>` : ""}
  </div>
</div>`;
    document.getElementById("sr-ab-func").addEventListener("click", () => {
      _srState._filterFuncOnly = !_srState._filterFuncOnly;
      _srRenderResults();
      _srRenderActionBar();
    });
    document.getElementById("sr-collapse-all").addEventListener("click", _srCollapseAll);
    document.getElementById("sr-expand-all").addEventListener("click", _srExpandAll);
    document.getElementById("sr-view-list").addEventListener("click", () => {
      if (_srState.viewMode === "list") return;
      _srState.viewMode = "list";
      _srRenderResults();
      _srRenderActionBar();
    });
    document.getElementById("sr-view-tree").addEventListener("click", () => {
      if (_srState.viewMode === "tree") return;
      _srState.viewMode = "tree";
      _srRenderResults();
      _srRenderActionBar();
    });
    const incInput = document.getElementById("sr-ab-inc");
    const excInput = document.getElementById("sr-ab-exc");
    if (incInput) incInput.addEventListener("input", _abChanged2);
    if (excInput) excInput.addEventListener("input", _abChanged2);
    bar.querySelectorAll(".sr-ab-filter-clear").forEach((btn) => {
      btn.addEventListener("click", () => {
        clearTimeout(_srCodeFilterTimer);
        if (btn.dataset.target === "inc") {
          _srState.include = "";
          if (incInput) incInput.value = "";
        } else {
          _srState.exclude = "";
          if (excInput) excInput.value = "";
        }
        if (_srState.query) _srDebounce(_srState.query);
        else _srRenderActionBar();
      });
    });
    [incInput, excInput].forEach((inp) => {
      if (!inp) return;
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          inp.value = "";
          inp.dispatchEvent(new Event("input"));
          e.stopPropagation();
        }
        if (e.key === "Enter") e.stopPropagation();
      });
    });
  } else {
    let _fiChanged2 = function() {
      _srState.include = iInc?.value.trim() || "";
      _srState.exclude = iExc?.value.trim() || "";
      clearTimeout(_srFileFilterTimer);
      _srFileFilterTimer = setTimeout(() => {
        _srBuildIndex();
        _srState.results = _srSearchFiles(_srState.query);
        _srRenderResults();
        _srRenderActionBar();
      }, 200);
    };
    var _fiChanged = _fiChanged2;
    const n = _srState.results.length;
    const isFileTree = _srState.fileViewMode === "tree";
    bar.innerHTML = `
<div class="sr-ab-top">
  <span class="sr-ab-info"><span class="sr-ab-count">${n.toLocaleString()}</span>&thinsp;${T("searchFilesWord")}</span>
  <span class="sr-ab-spacer"></span>
  ${isFileTree ? `<button class="sr-ab-btn" id="sr-fi-collapse-all" data-tip="Collapse All">\u229F</button>
  <button class="sr-ab-btn" id="sr-fi-expand-all" data-tip="Expand All">\u229E</button>
  <div class="sr-ab-sep"></div>` : ""}
  <button class="sr-ab-btn${!isFileTree ? " active" : ""}" id="sr-fi-view-list" data-tip="View as List">\u2261</button>
  <button class="sr-ab-btn${isFileTree ? " active" : ""}" id="sr-fi-view-tree" data-tip="View as Tree">\u2B21</button>
  <div class="sr-ab-sep"></div>
  <div class="sr-ab-filter-input-wrap sr-ab-filter-inline" data-tip="${T("searchIncludeLabel")}">
    <span class="sr-ab-filter-icon">\u2295</span>
    <input class="sr-ab-filter-input" id="sr-ab-fi-inc" type="text" value="${escapeHtml(_srState.include)}" placeholder="${T("searchIncludeShort")}" spellcheck="false" autocomplete="off">
    ${_srState.include ? `<button class="sr-ab-filter-clear" data-target="inc">\u2715</button>` : ""}
  </div>
  <div class="sr-ab-filter-input-wrap sr-ab-filter-inline" data-tip="${T("searchExcludeLabel")}">
    <span class="sr-ab-filter-icon sr-ab-filter-exc">\u2296</span>
    <input class="sr-ab-filter-input" id="sr-ab-fi-exc" type="text" value="${escapeHtml(_srState.exclude)}" placeholder="${T("searchExcludeShort")}" spellcheck="false" autocomplete="off">
    ${_srState.exclude ? `<button class="sr-ab-filter-clear" data-target="exc">\u2715</button>` : ""}
  </div>
</div>`;
    const iInc = document.getElementById("sr-ab-fi-inc");
    const iExc = document.getElementById("sr-ab-fi-exc");
    const fiViewList = document.getElementById("sr-fi-view-list");
    const fiViewTree = document.getElementById("sr-fi-view-tree");
    if (fiViewList) fiViewList.addEventListener("click", () => {
      if (_srState.fileViewMode === "list") return;
      _srState.fileViewMode = "list";
      _srRenderResults();
      _srRenderActionBar();
    });
    if (fiViewTree) fiViewTree.addEventListener("click", () => {
      if (_srState.fileViewMode === "tree") return;
      _srState.fileViewMode = "tree";
      _srRenderResults();
      _srRenderActionBar();
    });
    const fiCollapseAll = document.getElementById("sr-fi-collapse-all");
    const fiExpandAll = document.getElementById("sr-fi-expand-all");
    if (fiCollapseAll) fiCollapseAll.addEventListener("click", () => {
      _srState._openFileFolders.clear();
      document.querySelectorAll("#sr-results .sr-fi-tree-body").forEach((el) => el.style.display = "none");
      document.querySelectorAll("#sr-results .sr-fi-tree-chevron").forEach((el) => {
        el.classList.remove("open");
        el.textContent = "\u25B8";
      });
    });
    if (fiExpandAll) fiExpandAll.addEventListener("click", () => {
      document.querySelectorAll("#sr-results .sr-fi-tree-folder-hdr").forEach((hdr) => {
        const fpath = hdr.dataset.fpath;
        if (fpath) _srState._openFileFolders.add(fpath);
        const body = hdr.nextElementSibling;
        if (body) body.style.display = "";
        const chev = hdr.querySelector(".sr-fi-tree-chevron");
        if (chev) {
          chev.classList.add("open");
          chev.textContent = "\u25BE";
        }
      });
    });
    if (iInc) iInc.addEventListener("input", _fiChanged2);
    if (iExc) iExc.addEventListener("input", _fiChanged2);
    bar.querySelectorAll(".sr-ab-filter-clear").forEach((btn) => {
      btn.addEventListener("click", () => {
        clearTimeout(_srFileFilterTimer);
        if (btn.dataset.target === "inc") {
          _srState.include = "";
          if (iInc) iInc.value = "";
        } else {
          _srState.exclude = "";
          if (iExc) iExc.value = "";
        }
        _srState.results = _srSearchFiles(_srState.query);
        _srRenderResults();
        _srRenderActionBar();
      });
    });
    [iInc, iExc].forEach((inp) => {
      if (!inp) return;
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          inp.value = "";
          inp.dispatchEvent(new Event("input"));
          e.stopPropagation();
        }
        if (e.key === "Enter") e.stopPropagation();
      });
    });
  }
  if (restoreFocus?.id) {
    requestAnimationFrame(() => {
      const el = document.getElementById(restoreFocus.id);
      if (!el) return;
      el.focus({ preventScroll: true });
      if (typeof el.setSelectionRange === "function" && restoreFocus.start != null) {
        el.setSelectionRange(restoreFocus.start, restoreFocus.end ?? restoreFocus.start);
      }
    });
  }
}
const _SR_VS_CHUNK = 80;
let _srVsObserver = null;
function _srVsObserve(sentinel, onVisible) {
  if (_srVsObserver) {
    _srVsObserver.disconnect();
    _srVsObserver = null;
  }
  if (!sentinel) return;
  _srVsObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) onVisible();
  }, { root: document.getElementById("sr-panel"), rootMargin: "200px" });
  _srVsObserver.observe(sentinel);
}
function _srVsStop() {
  if (_srVsObserver) {
    _srVsObserver.disconnect();
    _srVsObserver = null;
  }
}
function _srRenderResults() {
  const resultsEl = document.getElementById("sr-results");
  if (!resultsEl) return;
  _srVsStop();
  _srState._vsEnd = 0;
  const q = _srState.query;
  if (_srState.mode === "files") {
    const results = _srState.results;
    if (!results.length) {
      resultsEl.innerHTML = q ? `<div class="sr-empty">${T("searchNoFilesMatching", { query: escapeHtml(q) })}</div>` : "";
      return;
    }
    if (_srState.fileViewMode === "tree") {
      _srRenderFileTree(resultsEl, results, q);
      return;
    }
    const end = Math.min(_SR_VS_CHUNK, results.length);
    resultsEl.innerHTML = _srBuildFileRowsHtml(results, 0, end, q) + (results.length > end ? '<div class="sr-vs-sentinel"></div>' : "");
    _srState._vsEnd = end;
    _srWireFileRows(resultsEl, results);
    _srUpdateActive();
    if (results.length > end) {
      _srVsObserve(resultsEl.querySelector(".sr-vs-sentinel"), function _vsNext() {
        const s = _srState._vsEnd;
        const e2 = Math.min(s + _SR_VS_CHUNK, results.length);
        const sentinel = resultsEl.querySelector(".sr-vs-sentinel");
        if (!sentinel) return;
        sentinel.insertAdjacentHTML("beforebegin", _srBuildFileRowsHtml(results, s, e2, q));
        _srState._vsEnd = e2;
        _srWireFileRows(resultsEl, results);
        if (e2 >= results.length) _srVsStop();
      });
    }
  } else {
    const groups = _srFilteredGroups();
    if (_srState._contentLoading && groups.length === 0) {
      resultsEl.innerHTML = `<div class="sr-loading">
              <span class="sr-dot"></span><span class="sr-dot"></span><span class="sr-dot"></span>
              <span>Searching\u2026</span></div>`;
      return;
    }
    if (_srState._contentDone && groups.length === 0) {
      resultsEl.innerHTML = q ? `<div class="sr-empty">No results for <strong style="color:var(--text)">"${escapeHtml(q)}"</strong></div>` : "";
      return;
    }
    if (_srState.viewMode === "tree") {
      _srRenderTree(resultsEl, groups, q);
    } else {
      _srRenderCodeList(resultsEl, groups, q);
    }
  }
}
function _srBuildFileRowsHtml(results, start, end, q) {
  let html = "";
  for (let i = start; i < end; i++) {
    const r = results[i];
    if (!r) continue;
    const mc = _srModuleColor(r.module);
    const ic = _extIcon(r.ext);
    const nm = r._fuzzyLabelPos ? _srFuzzyHighlight(r.label, r._fuzzyLabelPos) : _srHighlight(r.label, q);
    const dir = r.path.includes("/") ? r.path.slice(0, r.path.lastIndexOf("/") + 1) : "";
    const dirHl = dir ? `<span class="sr-fi-dir">${r._fuzzyPathPos ? _srFuzzyHighlight(dir, r._fuzzyPathPos.filter((i2) => i2 < dir.length)) : _srHighlight(dir, q)}</span>` : "";
    const ac = i === _srState.activeIdx ? " sr-active" : "";
    const fcBadge = r.func_count > 0 ? `<span class="sr-fi-fc" data-tip="${r.func_count} functions">\u0192 ${r.func_count}</span>` : "";
    const szBadge = r.size > 0 ? `<span class="sr-fi-sz">${fmtSize(r.size)}</span>` : "";
    const otherBadge = r._isOther ? `<span class="sr-fi-other" data-tip="Non-analysed file (grey node)">\u25CF</span>` : "";
    html += `<div class="sr-fi-row${ac}" data-idx="${i}">
  <div class="sr-fi-left" style="border-left-color:${mc}"><span class="sr-fi-icon">${ic}</span></div>
  <div class="sr-fi-body">
    <div class="sr-fi-name">${nm}</div>
    <div class="sr-fi-path">${dirHl}<span class="sr-fi-mod" style="background:${mc}22;color:${mc};border:1px solid ${mc}44">${escapeHtml(r.module)}</span>${fcBadge}${szBadge}${otherBadge}</div>
  </div>
</div>`;
  }
  return html;
}
function _srWireFileRows(container, results) {
  container.querySelectorAll(".sr-fi-row:not([data-wired])").forEach((row) => {
    row.dataset.wired = "1";
    const idx = parseInt(row.dataset.idx, 10);
    const r = results[idx];
    if (!r) return;
    row.addEventListener("click", () => _srSelectResult(r));
    row.addEventListener("mouseenter", () => {
      _srState.activeIdx = idx;
      _srHoverResult(r);
      _srUpdateActive();
    });
  });
}
function _srBuildFileTree(results) {
  const root = { name: "", path: "", children: [], files: [] };
  const nodeMap = { "": root };
  function getNode(folderPath) {
    if (nodeMap[folderPath]) return nodeMap[folderPath];
    const parts = folderPath.split("/");
    const name = parts[parts.length - 1];
    const parent = parts.slice(0, -1).join("/");
    const parentNode = getNode(parent);
    const node = { name, path: folderPath, children: [], files: [] };
    parentNode.children.push(node);
    nodeMap[folderPath] = node;
    return node;
  }
  for (const r of results) {
    const lastSlash = r.path.lastIndexOf("/");
    const folder = lastSlash >= 0 ? r.path.slice(0, lastSlash) : "";
    getNode(folder).files.push(r);
  }
  function sortNode(n) {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sortNode);
  }
  sortNode(root);
  return root;
}
function _srRenderFileTreeNode(node, q, depth) {
  let html = "";
  const indent = depth * 14;
  for (const child of node.children) {
    const isOpen = _srState._openFileFolders.has(child.path);
    html += `<div class="sr-fi-tree-folder">
  <div class="sr-fi-tree-folder-hdr" data-fpath="${escapeHtml(child.path)}" style="padding-left:${indent + 6}px">
    <span class="sr-fi-tree-chevron sr-chevron${isOpen ? " open" : ""}">${isOpen ? "\u25BE" : "\u25B8"}</span>
    <span class="sr-tree-folder-icon">${isOpen ? _iconFolderOpen() : _iconFolderClosed()}</span>
    <span class="sr-tree-folder-name">${escapeHtml(child.name)}</span>
    <span class="sr-match-badge" style="margin-left:auto">${_srCountFileTreeMatches(child)}</span>
  </div>
  <div class="sr-fi-tree-body" style="${isOpen ? "" : "display:none"}">
    ${_srRenderFileTreeNode(child, q, depth + 1)}
  </div>
</div>`;
  }
  for (const r of node.files) {
    const mc = _srModuleColor(r.module);
    const ic = _extIcon(r.ext);
    const nm = r._fuzzyLabelPos ? _srFuzzyHighlight(r.label, r._fuzzyLabelPos) : _srHighlight(r.label, q);
    const fcBadge = r.func_count > 0 ? `<span class="sr-fi-fc" data-tip="${r.func_count} functions">\u0192 ${r.func_count}</span>` : "";
    const otherBadge = r._isOther ? `<span class="sr-fi-other" data-tip="Non-analysed file (grey node)">\u25CF</span>` : "";
    html += `<div class="sr-fi-row sr-fi-tree-file" data-path="${escapeHtml(r.path)}" style="padding-left:${indent + 24}px">
  <div class="sr-fi-left" style="border-left-color:${mc}"><span class="sr-fi-icon">${ic}</span></div>
  <div class="sr-fi-body">
    <div class="sr-fi-name">${nm}</div>
    <div class="sr-fi-path"><span class="sr-meta-mod" style="background:${mc}22;color:${mc};border:1px solid ${mc}44">${escapeHtml(r.module)}</span>${fcBadge}${otherBadge}</div>
  </div>
</div>`;
  }
  return html;
}
function _srCountFileTreeMatches(node) {
  let n = node.files.length;
  for (const c of node.children) n += _srCountFileTreeMatches(c);
  return n;
}
function _srRenderFileTree(resultsEl, results, q) {
  const tree = _srBuildFileTree(results);
  if (_srState._openFileFolders.size === 0) {
    tree.children.forEach((c) => _srState._openFileFolders.add(c.path));
  }
  const html = _srRenderFileTreeNode(tree, q, 0);
  resultsEl.innerHTML = html || `<div class="sr-empty">No results</div>`;
  resultsEl.querySelectorAll(".sr-fi-tree-folder-hdr").forEach((hdr) => {
    hdr.addEventListener("click", () => {
      const fpath = hdr.dataset.fpath;
      const body = hdr.nextElementSibling;
      const chev = hdr.querySelector(".sr-fi-tree-chevron");
      const iconEl = hdr.querySelector(".sr-tree-folder-icon");
      if (_srState._openFileFolders.has(fpath)) {
        _srState._openFileFolders.delete(fpath);
        if (body) body.style.display = "none";
        if (chev) {
          chev.classList.remove("open");
          chev.textContent = "\u25B8";
        }
        if (iconEl) iconEl.innerHTML = _iconFolderClosed();
      } else {
        _srState._openFileFolders.add(fpath);
        if (body) body.style.display = "";
        if (chev) {
          chev.classList.add("open");
          chev.textContent = "\u25BE";
        }
        if (iconEl) iconEl.innerHTML = _iconFolderOpen();
      }
    });
  });
  resultsEl.querySelectorAll(".sr-fi-tree-file").forEach((row) => {
    const path = row.dataset.path;
    const r = results.find((x) => x.path === path);
    if (!r) return;
    row.addEventListener("click", () => _srSelectResult(r));
    row.addEventListener("mouseenter", () => _srHoverResult(r));
  });
}
function _srRenderCodeList(resultsEl, groups, q) {
  const end = Math.min(_SR_VS_CHUNK, groups.length);
  let html = _srBuildCodeGroupsHtml(groups, 0, end, q);
  if (groups.length > end) html += '<div class="sr-vs-sentinel"></div>';
  if (_srState._contentLoading) html += _srStreamingBarHtml();
  resultsEl.innerHTML = html;
  _srState._vsEnd = end;
  _srWireCodeGroups(resultsEl, groups);
  if (groups.length > end) {
    _srVsObserve(resultsEl.querySelector(".sr-vs-sentinel"), function _cvsNext() {
      const liveGroups = _srFilteredGroups();
      const s = _srState._vsEnd;
      const e2 = Math.min(s + _SR_VS_CHUNK, liveGroups.length);
      const sentinel = resultsEl.querySelector(".sr-vs-sentinel");
      if (!sentinel) return;
      sentinel.insertAdjacentHTML("beforebegin", _srBuildCodeGroupsHtml(liveGroups, s, e2, q));
      _srState._vsEnd = e2;
      _srWireCodeGroups(resultsEl, liveGroups);
      if (e2 >= liveGroups.length) _srVsStop();
    });
  }
}
function _srAppendCodeGroups(resultsEl, groups, q) {
  if (!resultsEl) return;
  const loading = resultsEl.querySelector(".sr-loading");
  if (loading) loading.remove();
  const rendered = _srState._vsEnd || 0;
  const maxFirst = Math.min(groups.length, _SR_VS_CHUNK);
  if (rendered < maxFirst) {
    const html = _srBuildCodeGroupsHtml(groups, rendered, maxFirst, q);
    const streamBar = resultsEl.querySelector(".sr-streaming-bar");
    const sentinel = resultsEl.querySelector(".sr-vs-sentinel");
    const insertBefore = sentinel || streamBar;
    if (insertBefore) insertBefore.insertAdjacentHTML("beforebegin", html);
    else resultsEl.insertAdjacentHTML("beforeend", html);
    _srState._vsEnd = maxFirst;
    _srWireCodeGroups(resultsEl, groups);
  }
  if (groups.length > _SR_VS_CHUNK) {
    let sentinel = resultsEl.querySelector(".sr-vs-sentinel");
    if (!sentinel) {
      const streamBar = resultsEl.querySelector(".sr-streaming-bar");
      if (streamBar) {
        streamBar.insertAdjacentHTML("beforebegin", '<div class="sr-vs-sentinel"></div>');
      } else {
        resultsEl.insertAdjacentHTML("beforeend", '<div class="sr-vs-sentinel"></div>');
      }
      sentinel = resultsEl.querySelector(".sr-vs-sentinel");
    }
    _srVsObserve(sentinel, function _cvsNext() {
      const liveGroups = _srFilteredGroups();
      const s = _srState._vsEnd;
      const e2 = Math.min(s + _SR_VS_CHUNK, liveGroups.length);
      const sentinelEl = resultsEl.querySelector(".sr-vs-sentinel");
      if (!sentinelEl) return;
      sentinelEl.insertAdjacentHTML("beforebegin", _srBuildCodeGroupsHtml(liveGroups, s, e2, q));
      _srState._vsEnd = e2;
      _srWireCodeGroups(resultsEl, liveGroups);
      if (e2 >= liveGroups.length) _srVsStop();
    });
  }
}
function _srRenderStreamingBatch() {
  const resultsEl = document.getElementById("sr-results");
  if (!resultsEl) return;
  const groups = _srFilteredGroups();
  const q = _srState.query;
  if (groups.length === 0) {
    const hasLoading = resultsEl.querySelector(".sr-loading");
    const hasEmpty = resultsEl.querySelector(".sr-empty");
    if (_srState._contentLoading && !hasLoading) _srRenderResults();
    if (_srState._contentDone && !hasEmpty) _srRenderResults();
    return;
  }
  if (_srState.viewMode === "list" && !_srState._filterFuncOnly) {
    if (!_srState._streamRendered || _srState._streamRenderMode !== "list") {
      _srRenderCodeList(resultsEl, groups, q);
      _srState._streamRendered = true;
      _srState._streamRenderMode = "list";
      return;
    }
    _srAppendCodeGroups(resultsEl, groups, q);
  } else {
    if (!_srState._streamRendered || _srState._streamRenderMode !== "tree") {
      _srRenderTree(resultsEl, groups, q);
      _srState._streamRendered = true;
      _srState._streamRenderMode = "tree";
    }
  }
}
function _srBuildCodeGroupsHtml(groups, start, end, q) {
  let html = "";
  for (let i = start; i < end; i++) {
    const g = groups[i];
    if (!g) continue;
    const isOpen = _srState._openGroups.has(g.path);
    const ic = _extIcon(g.ext);
    const mc = g.color || _srModuleColor(g.module);
    const dir = g.path.includes("/") ? g.path.slice(0, g.path.lastIndexOf("/")) : "";
    const fnHl = _srHighlight(g.label, q);
    html += `<div class="sr-file-group">
  <div class="sr-file-header" data-gpath="${escapeHtml(g.path)}">
    <span class="sr-chevron${isOpen ? " open" : ""}">${isOpen ? "\u25BE" : "\u25B8"}</span>
    <span class="sr-file-icon">${ic}</span>
    <div class="sr-file-name-wrap">
      <span class="sr-file-name">${fnHl}</span>
      ${dir ? `<span class="sr-file-dir">${escapeHtml(dir)}</span>` : ""}
    </div>
    <span class="sr-match-badge">${g.count}</span>
    <span class="sr-meta-mod" style="background:${mc}22;color:${mc};border:1px solid ${mc}44;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;flex-shrink:0">${escapeHtml(g.module)}</span>
  </div>
  ${isOpen ? `<div class="sr-match-lines">${_srMatchLinesHtml(g)}</div>` : ""}
</div>`;
  }
  return html;
}
function _srStreamingBarHtml() {
  return `<div class="sr-streaming-bar">
  <span class="sr-dot"></span><span class="sr-dot"></span><span class="sr-dot"></span>
  <span class="sr-streaming-label">searching\u2026</span></div>`;
}
function _srWireCodeGroups(container, groups) {
  container.querySelectorAll(".sr-file-header:not([data-wired])").forEach((hdr) => {
    hdr.dataset.wired = "1";
    hdr.addEventListener("click", () => {
      const p = hdr.dataset.gpath;
      const grp = hdr.closest(".sr-file-group");
      if (!grp) return;
      const wasOpen = _srState._openGroups.has(p);
      if (wasOpen) {
        _srState._openGroups.delete(p);
        const lines = grp.querySelector(".sr-match-lines");
        if (lines) lines.style.display = "none";
      } else {
        _srState._openGroups.add(p);
        let lines = grp.querySelector(".sr-match-lines");
        if (!lines) {
          const g = groups.find((g2) => g2.path === p) || _srState._contentGroups.find((g2) => g2.path === p);
          if (g) {
            lines = document.createElement("div");
            lines.className = "sr-match-lines";
            lines.innerHTML = _srMatchLinesHtml(g);
            grp.appendChild(lines);
            _srWireLineRows(lines);
          }
        } else {
          lines.style.display = "";
        }
      }
      const chev = hdr.querySelector(".sr-chevron");
      if (chev) {
        const nowOpen = _srState._openGroups.has(p);
        chev.classList.toggle("open", nowOpen);
        chev.textContent = nowOpen ? "\u25BE" : "\u25B8";
      }
    });
  });
  _srWireLineRows(container);
}
function _srRenderTree(resultsEl, groups, q) {
  const tree = _srBuildTree(groups);
  let html = _srRenderTreeNode(tree, q, 0);
  if (_srState._contentLoading) html += _srStreamingBarHtml();
  resultsEl.innerHTML = html;
  resultsEl.querySelectorAll(".sr-tree-folder-hdr").forEach((hdr) => {
    hdr.addEventListener("click", () => {
      const p = hdr.dataset.fpath;
      if (_srState._openFolders.has(p)) _srState._openFolders.delete(p);
      else _srState._openFolders.add(p);
      const body = hdr.nextElementSibling;
      if (body?.classList.contains("sr-tree-folder-body")) {
        const isNowOpen = _srState._openFolders.has(p);
        body.style.display = isNowOpen ? "" : "none";
        const chev = hdr.querySelector(".sr-chevron");
        if (chev) {
          chev.classList.toggle("open", isNowOpen);
          chev.textContent = isNowOpen ? "\u25BE" : "\u25B8";
        }
        const iconEl = hdr.querySelector(".sr-tree-folder-icon");
        if (iconEl) iconEl.innerHTML = isNowOpen ? _iconFolderOpen() : _iconFolderClosed();
      }
    });
  });
  _srWireCodeGroups(resultsEl, groups);
}
function _srEnsurePanelStructure(panel) {
  let filters = document.getElementById("sr-filters");
  if (filters) filters.remove();
  let actionBar = document.getElementById("sr-action-bar");
  if (!actionBar) {
    const results = document.getElementById("sr-results");
    if (results) results.insertAdjacentHTML(
      "beforebegin",
      '<div id="sr-action-bar" class="sr-action-bar" style="display:none"></div>'
    );
    else panel.insertAdjacentHTML(
      "afterbegin",
      '<div id="sr-action-bar" class="sr-action-bar" style="display:none"></div>'
    );
  }
  if (!document.getElementById("sr-results")) {
    const after = document.getElementById("sr-action-bar");
    after.insertAdjacentHTML("afterend", '<div id="sr-results"></div>');
  }
  if (!panel.querySelector(".sr-footer")) {
    panel.insertAdjacentHTML("beforeend", `
<div class="sr-footer">
  <span class="sr-footer-hint"><kbd>&uarr;&darr;</kbd> ${T("searchHintNavigate")}</span>
  <span class="sr-footer-hint"><kbd>Enter</kbd> ${T("searchHintOpen")}</span>
  <span class="sr-footer-hint"><kbd>Tab</kbd> ${T("searchHintSwitchMode")}</span>
  <span class="sr-footer-hint"><kbd>Esc</kbd> ${T("searchHintClose")}</span>
</div>`);
  }
}
function _srRenderPanel() {
  const panel = document.getElementById("sr-panel");
  const countEl = document.getElementById("sr-count");
  if (!panel) return;
  const q = _srState.query;
  if (countEl) {
    if (_srState._contentLoading && _srState._contentTotal === 0) {
      countEl.textContent = "\u2026";
    } else {
      const n = _srState.mode === "code" ? _srState._contentTotal : _srState.results.length;
      countEl.textContent = n > 0 ? n.toLocaleString() : q ? "0" : "";
      countEl.style.color = n > 0 ? "var(--accent)" : "var(--muted)";
    }
  }
  if (!q) {
    panel.classList.remove("visible");
    _srRenderActionBar();
    return;
  }
  panel.classList.add("visible");
  _srEnsurePanelStructure(panel);
  let actionBar = document.getElementById("sr-action-bar");
  let resultsEl = document.getElementById("sr-results");
  if (!actionBar || !resultsEl) {
    panel.innerHTML = `
<div id="sr-action-bar" class="sr-action-bar" style="display:none"></div>
<div id="sr-results"></div>
<div class="sr-footer">
  <span class="sr-footer-hint"><kbd>\u2191\u2193</kbd> ${T("searchHintNavigate")}</span>
  <span class="sr-footer-hint"><kbd>\u21B5</kbd> ${T("searchHintOpen")}</span>
  <span class="sr-footer-hint"><kbd>Tab</kbd> ${T("searchHintSwitchMode")}</span>
  <span class="sr-footer-hint"><kbd>Esc</kbd> ${T("searchHintClose")}</span>
</div>`;
  }
  _srRenderActionBar();
  _srRenderResults();
}
function _srHoverResult(r) {
  const filePath = r.filePath || r.path;
  if (!filePath) return;
  if (!cy) return;
  cy.nodes().forEach((n) => {
    const f = n.data("_f");
    if (f && f.path === filePath) highlightNode(n);
  });
}
function _srSelectResult(r) {
  const filePath = r.filePath || r.path;
  const module = r.module || (filePath ? filePath.split("/")[0] : null);
  const funcName = r._type === "func" ? r.name : null;
  if (filePath && typeof window.isOverviewTreemapActive === "function" && window.isOverviewTreemapActive()) {
    if (typeof window.overviewTreemapSelectFile === "function") {
      window.overviewTreemapSelectFile(filePath, { funcName, openCode: true, revealExplorer: true, center: true });
    } else {
      loadFileInPanel(filePath, funcName);
    }
    return;
  }
  if (r._isOther) {
    const ft = r.file_type || "other";
    if (ft === "binary") ftActiveFilter.add("binary");
    else ftActiveFilter.add("other");
  }
  if (filePath && module) {
    if (state.level !== 1 || state.activeModule !== module) {
      drillToModule(module, { focusFile: filePath });
    } else {
      const target = cy.nodes().filter((n) => {
        const f = n.data("_f");
        return f && f.path === filePath;
      }).first();
      if (target && target.length) {
        highlightNode(target);
        cy.animate(
          { center: { eles: target }, zoom: Math.max(cy.zoom(), 1.8) },
          { duration: 500, easing: "ease-in-out-cubic" }
        );
      }
    }
  }
  if (filePath) setTimeout(() => loadFileInPanel(filePath, funcName), 150);
}
function _srSelectContentLine(filePath, line) {
  if (filePath && typeof window.isOverviewTreemapActive === "function" && window.isOverviewTreemapActive()) {
    if (typeof window.overviewTreemapSelectFile === "function") {
      window.overviewTreemapSelectFile(filePath, { openCode: false, revealExplorer: true, center: true });
    }
    setTimeout(async () => {
      await loadFileInPanel(filePath);
      if (line) setTimeout(() => {
        const el = document.getElementById(`cl-${line - 1}`);
        if (el) {
          document.querySelectorAll(".code-line.fn-highlight").forEach((e) => e.classList.remove("fn-highlight"));
          el.classList.add("fn-highlight");
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }, 320);
    }, 80);
    return;
  }
  const module = filePath ? filePath.split("/")[0] : null;
  if (filePath && module) {
    if (state.level !== 1 || state.activeModule !== module) {
      drillToModule(module, { focusFile: filePath });
    } else {
      const target = cy.nodes().filter((n) => {
        const f = n.data("_f");
        return f && f.path === filePath;
      }).first();
      if (target && target.length) {
        highlightNode(target);
        cy.animate(
          { center: { eles: target }, zoom: Math.max(cy.zoom(), 1.8) },
          { duration: 500, easing: "ease-in-out-cubic" }
        );
      }
    }
  }
  if (filePath) {
    setTimeout(async () => {
      await loadFileInPanel(filePath);
      if (line) setTimeout(() => {
        const el = document.getElementById(`cl-${line - 1}`);
        if (el) {
          document.querySelectorAll(".code-line.fn-highlight").forEach((e) => e.classList.remove("fn-highlight"));
          el.classList.add("fn-highlight");
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }, 320);
    }, 150);
  }
}
function _srUpdateActive() {
  const el = document.getElementById("sr-results");
  if (!el) return;
  el.querySelectorAll('.sr-row[data-rtype="top"], .sr-fi-row').forEach((row) => {
    const idx = parseInt(row.dataset.idx, 10);
    row.classList.toggle("sr-active", idx === _srState.activeIdx);
  });
  const active = el.querySelector(".sr-active");
  if (active) active.scrollIntoView({ block: "nearest" });
}
function _srClose() {
  const panel = document.getElementById("sr-panel");
  if (panel) panel.classList.remove("visible");
  _srState.activeIdx = -1;
  _resetGraphHighlightPreservingPin();
}
function onSearch(e) {
  const q = (e.target.value || "").trim();
  _srState.query = q;
  _srState.activeIdx = -1;
  _srState._openGroups = /* @__PURE__ */ new Set();
  if (typeof window.overviewTreemapSetSearchQuery === "function") {
    window.overviewTreemapSetSearchQuery(q);
  }
  if (!q) {
    if (_srStream) {
      _srStream.close();
      _srStream = null;
    }
    _srState._contentGroups = [];
    _srState._contentTotal = 0;
    _srState._contentFiles = 0;
    _srState._contentLoading = false;
    _srState._contentDone = true;
    _srState.results = [];
    _srRenderPanel();
    _resetGraphHighlightPreservingPin();
    return;
  }
  _srBuildIndex();
  if (_srState.mode === "files") {
    _srState.results = _srSearchFiles(q);
    _srRenderPanel();
  } else {
    _srState.results = [];
    _srState._streamRendered = false;
    _srState._streamRenderMode = _srState.viewMode;
    _srRenderPanel();
    _srDebounce(q);
  }
  if (cy && state.level <= 1) {
    cy.elements().addClass("faded");
    cy.nodes().forEach((n) => {
      const f = n.data("_f");
      const lbl = (f ? f.label : n.data("label")) || "";
      if (lbl.toLowerCase().includes(q.toLowerCase())) n.removeClass("faded").addClass("hl");
    });
  }
  if (_srState.mode === "files") _srRenderPanel();
}
function _srSetMode(mode) {
  _srState.mode = mode;
  try {
    localStorage.setItem("vizcode-search-mode", mode);
  } catch (_) {
  }
  document.querySelectorAll(".sr-mode").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  const input = document.getElementById("search");
  const filters = document.getElementById("sr-filters");
  if (input) input.placeholder = mode === "files" ? T("searchPlaceholderFiles") : T("searchPlaceholderCode");
  if (filters) filters.classList.toggle("visible", mode === "code");
  const panel = document.getElementById("sr-panel");
  if (panel) panel.innerHTML = "";
  if (_srState.query) {
    _srBuildIndex();
    if (mode === "files") {
      _srState.results = _srSearchFiles(_srState.query);
      _srRenderPanel();
    } else {
      _srState.results = [];
      _srState._streamRendered = false;
      _srState._streamRenderMode = _srState.viewMode;
      _srRenderPanel();
      _srDebounce(_srState.query);
    }
  }
}
function initSearch() {
  const input = document.getElementById("search");
  if (!input) return;
  const _savedMode = (() => {
    try {
      return localStorage.getItem("vizcode-search-mode");
    } catch (_) {
      return null;
    }
  })();
  if (_savedMode === "code" || _savedMode === "files") _srSetMode(_savedMode);
  document.querySelectorAll(".sr-mode").forEach((btn) => {
    btn.addEventListener("click", () => _srSetMode(btn.dataset.mode));
  });
  const toggleMap = {
    "srt-case": "matchCase",
    "srt-word": "wholeWord",
    "srt-regex": "isRegex"
  };
  Object.entries(toggleMap).forEach(([id, key]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener("click", () => {
      _srState[key] = !_srState[key];
      btn.classList.toggle("active", _srState[key]);
      if (key === "isRegex" && _srState[key] && _srState.wholeWord) {
        _srState.wholeWord = false;
        document.getElementById("srt-word").classList.remove("active");
      }
      if (key === "wholeWord" && _srState[key] && _srState.isRegex) {
        _srState.isRegex = false;
        document.getElementById("srt-regex").classList.remove("active");
      }
      if (_srState.query) onSearch({ target: input });
    });
  });
  input.addEventListener("keydown", (e) => {
    if (e.altKey) {
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        document.getElementById("srt-case").click();
      }
      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        document.getElementById("srt-word").click();
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        document.getElementById("srt-regex").click();
      }
    }
  });
  input.addEventListener("input", onSearch);
  input.addEventListener("keydown", (e) => {
    if (e.altKey) return;
    const allResults = _srState.results;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      _srState.activeIdx = Math.min(_srState.activeIdx + 1, allResults.length - 1);
      _srUpdateActive();
      if (allResults[_srState.activeIdx]) _srHoverResult(allResults[_srState.activeIdx]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      _srState.activeIdx = Math.max(_srState.activeIdx - 1, 0);
      _srUpdateActive();
      if (allResults[_srState.activeIdx]) _srHoverResult(allResults[_srState.activeIdx]);
    } else if (e.key === "Enter") {
      const r = allResults[_srState.activeIdx] || (allResults.length === 1 ? allResults[0] : null);
      if (r) _srSelectResult(r);
    } else if (e.key === "Escape") {
      input.value = "";
      _srState.query = "";
      _srClose();
      _resetGraphHighlightPreservingPin();
      input.blur();
    } else if (e.key === "Tab") {
      e.preventDefault();
      _srSetMode(_srState.mode === "files" ? "code" : "files");
    }
  });
  document.getElementById("cy").addEventListener("click", () => {
    if (_srState.query) return;
    _srClose();
  });
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("sr-panel");
    if (!panel || !panel.classList.contains("visible")) return;
    const searchUiIds = ["sr-panel", "search-wrap", "sr-modes", "sr-toggles", "sr-filters", "search"];
    const inside = searchUiIds.some((id) => {
      const el = document.getElementById(id);
      return el && el.contains(e.target);
    });
    if (!inside) {
      panel.classList.remove("visible");
    }
  }, true);
  input.addEventListener("focus", () => {
    if (_srState.query) _srRenderPanel();
  });
}
