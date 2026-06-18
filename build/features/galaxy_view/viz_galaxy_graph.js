"use strict";
function _gNormPath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").replace(/\/$/, "");
}
function _gDirname(path) {
  const norm = _gNormPath(path);
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? "" : norm.slice(0, idx);
}
function _gParentFolder(path) {
  const norm = _gNormPath(path);
  if (!norm) return null;
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? "" : norm.slice(0, idx);
}
function _gLastSegment(path) {
  const norm = _gNormPath(path);
  if (!norm) return "";
  const parts = norm.split("/");
  return parts[parts.length - 1] || "";
}
function _gRootLabel() {
  const root = _gNormPath(window.DATA?.stats?.root || "");
  return root ? _gLastSegment(root) : "ROOT";
}
function _gAllFiles() {
  const out = [];
  Object.values(window.DATA?.files_by_module || {}).forEach((files) => files.forEach((file) => out.push(file)));
  Object.values(window.DATA?.other_files_by_module || {}).forEach((files) => files.forEach((file) => out.push(file)));
  return out;
}
function _gApplyThemeTypeColors() {
  const style = getComputedStyle(document.documentElement);
  const dataFallback = (window.DATA?.modules || []).map((mod) => mod && mod.color).filter(Boolean);
  const currentFallback = [_G_COLORS.folder, _G_COLORS.file, _G_COLORS.class, _G_COLORS.function, _G_COLORS.method];
  const palette = [];
  for (let i = 1; i <= 5; i++) {
    palette.push(
      style.getPropertyValue(`--m${i}`).trim() || dataFallback[i - 1] || currentFallback[i - 1]
    );
  }
  [_G_COLORS.folder, _G_COLORS.file, _G_COLORS.class, _G_COLORS.function, _G_COLORS.method] = palette;
  _G_COLORS.struct = _G_COLORS.class;
}
function _gFolderModId(folderPath) {
  const norm = _gNormPath(folderPath);
  if (!norm) return "_root";
  return norm.split("/")[0] || "_root";
}
function _gFolderKey(folderPath) {
  const norm = _gNormPath(folderPath);
  return norm ? `g-folder:${norm}` : _G_ROOT_KEY;
}
function _gFileKey(filePath) {
  return `g-file:${_gNormPath(filePath)}`;
}
function _gScaledSize(base, nodeCount) {
  if (nodeCount > 5e4) return Math.max(1, base * 0.4);
  if (nodeCount > 2e4) return Math.max(1.5, base * 0.5);
  if (nodeCount > 5e3) return Math.max(2, base * 0.65);
  if (nodeCount > 1e3) return Math.max(2.5, base * 0.8);
  return base;
}
function _gNodeColor(symKind, isPublic) {
  if (_G_COLORS[symKind]) return _G_COLORS[symKind];
  if (_G_METHOD_KINDS.has(symKind)) return _G_COLORS.method;
  if (_G_FUNCTION_KINDS.has(symKind)) return _G_COLORS.function;
  return isPublic === false ? _G_COLORS.method : _G_COLORS.file;
}
function _gNodeTypeColor(nodeType, symKind, isPublic) {
  if (nodeType === "folder") return _G_COLORS.folder;
  if (nodeType === "file") return _G_COLORS.file;
  return _gNodeColor(symKind, isPublic);
}
function _gMethodLookup() {
  const lookup = /* @__PURE__ */ new Map();
  const funcsByFile = window.DATA?.funcs_by_file || {};
  Object.entries(funcsByFile).forEach(([fileRel, funcs]) => {
    funcs.forEach((fn, idx) => {
      const key = `${_gNormPath(fileRel)}::${fn.label || ""}`;
      if (!lookup.has(key)) lookup.set(key, idx);
    });
  });
  return lookup;
}
function _gBlendHex(color, t) {
  const bgHex = typeof _gThemeBgHex === "function" ? _gThemeBgHex() : "#060a10";
  const bgR = parseInt(bgHex.slice(1, 3), 16);
  const bgG = parseInt(bgHex.slice(3, 5), 16);
  const bgB = parseInt(bgHex.slice(5, 7), 16);
  let r, g, b;
  if (color && color[0] === "#") {
    r = parseInt(color.slice(1, 3), 16);
    g = parseInt(color.slice(3, 5), 16);
    b = parseInt(color.slice(5, 7), 16);
  } else {
    const m = color && color.match(/rgba?\(([^)]+)\)/i);
    if (!m) return color || bgHex;
    const p = m[1].split(",");
    r = +p[0];
    g = +p[1];
    b = +p[2];
  }
  const nr = bgR + (r - bgR) * t + 0.5 | 0;
  const ng = bgG + (g - bgG) * t + 0.5 | 0;
  const nb = bgB + (b - bgB) * t + 0.5 | 0;
  return "#" + (nr < 16 ? "0" : "") + nr.toString(16) + (ng < 16 ? "0" : "") + ng.toString(16) + (nb < 16 ? "0" : "") + nb.toString(16);
}
function _gBrightHex(color, f) {
  if (!color || color[0] !== "#") return color || "#ffffff";
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const k = (f - 1) / f;
  const nr = Math.min(255, r + (255 - r) * k + 0.5 | 0);
  const ng = Math.min(255, g + (255 - g) * k + 0.5 | 0);
  const nb = Math.min(255, b + (255 - b) * k + 0.5 | 0);
  return "#" + (nr < 16 ? "0" : "") + nr.toString(16) + (ng < 16 ? "0" : "") + ng.toString(16) + (nb < 16 ? "0" : "") + nb.toString(16);
}
function _gBuildDegreeCache() {
  if (!_gGraph) {
    _gDegreeCache = null;
    _gNodeLabelCache = null;
    return;
  }
  _gDegreeCache = /* @__PURE__ */ new Map();
  _gNodeLabelCache = /* @__PURE__ */ new Map();
  _gGraph.forEachNode((key, attrs) => {
    _gDegreeCache.set(key, _gGraph.degree(key));
    _gNodeLabelCache.set(key, attrs._labelLower || (attrs.label || "").toLowerCase());
  });
  _G_COMMUNITY_DIM = _G_COMMUNITY_PALETTE.map((c) => _gBlendHex(c, 0.12));
  _G_COMMUNITY_FOG = _G_COMMUNITY_PALETTE.map((c) => _gBlendHex(c, 0.15));
  _G_COMMUNITY_HLDIM = _G_COMMUNITY_PALETTE.map((c) => _gBlendHex(c, 0.2));
  _G_COMMUNITY_SEARCHDIM = _G_COMMUNITY_PALETTE.map((c) => _gBlendHex(c, 0.35));
  _G_COMMUNITY_BRIGHT = _G_COMMUNITY_PALETTE.map((c) => _gBrightHex(c, 1.4));
}
function _galaxyBuildGraph(allowedMods) {
  const Graph = window.graphology;
  if (!Graph) {
    console.error("[galaxy] graphology not loaded");
    return;
  }
  _gGraph = new Graph({ multi: true });
  const D = window.DATA || {};
  _gApplyThemeTypeColors();
  const pathFilter = allowedMods instanceof Set ? allowedMods : null;
  let allowedFilePaths = null;
  if (pathFilter) {
    allowedFilePaths = /* @__PURE__ */ new Set();
    for (const file of _gAllFiles()) {
      const norm = _gNormPath(file.path);
      for (const prefix of pathFilter) {
        if (!prefix || norm === prefix || norm.startsWith(prefix + "/")) {
          allowedFilePaths.add(norm);
          break;
        }
      }
    }
  }
  let allFiles = _gAllFiles();
  if (allowedFilePaths) allFiles = allFiles.filter((f) => allowedFilePaths.has(_gNormPath(f.path)));
  const symbolIndex = D.symbol_index || {};
  const symbolEdges = D.symbol_edges || [];
  const communityMap = D.communities || {};
  const fileEdgesByMod = D.file_edges_by_module || {};
  const filePathById = /* @__PURE__ */ new Map();
  const classNodeBySymbol = /* @__PURE__ */ new Map();
  const classNodeByFileName = /* @__PURE__ */ new Map();
  const callableNodeBySymbol = /* @__PURE__ */ new Map();
  const methodLookup = _gMethodLookup();
  Object.values(D.files_by_module || {}).forEach((files) => {
    files.forEach((file) => filePathById.set(file.id, _gNormPath(file.path)));
  });
  function ensureFolder(folderPath) {
    const norm = _gNormPath(folderPath);
    const key = _gFolderKey(norm);
    if (_gGraph.hasNode(key)) return key;
    const modId = _gFolderModId(norm);
    const color = _G_COLORS.folder;
    const label = norm ? _gLastSegment(norm) : _gRootLabel();
    _gGraph.addNode(key, {
      x: 0,
      y: 0,
      size: norm ? 12 : 15,
      color,
      label,
      _colorDim: _gBlendHex(color, 0.12),
      _colorFog: _gBlendHex(color, 0.15),
      _colorHlDim: _gBlendHex(color, 0.2),
      _colorSearchDim: _gBlendHex(color, 0.35),
      _colorBright: _gBrightHex(color, 1.4),
      _labelLower: label.toLowerCase(),
      _t: "folder",
      _path: norm,
      _file: "",
      _folder: norm,
      _line: 0,
      _endLine: 0,
      _parent: "",
      _symbolKind: "folder",
      _mod: modId
    });
    return key;
  }
  const folderSet = /* @__PURE__ */ new Set([""]);
  allFiles.forEach((file) => {
    let dir = _gDirname(file.path);
    folderSet.add(dir);
    while (dir) {
      dir = _gParentFolder(dir);
      if (dir == null) break;
      folderSet.add(dir);
      if (!dir) break;
    }
  });
  Object.values(symbolIndex).forEach((sym) => {
    const file = _gNormPath(sym.file || "");
    if (!file) return;
    if (allowedFilePaths && !allowedFilePaths.has(file)) return;
    let dir = _gDirname(file);
    folderSet.add(dir);
    while (dir) {
      dir = _gParentFolder(dir);
      if (dir == null) break;
      folderSet.add(dir);
      if (!dir) break;
    }
  });
  [...folderSet].sort((a, b) => {
    const da = a ? a.split("/").length : 0;
    const db = b ? b.split("/").length : 0;
    return da - db || a.localeCompare(b);
  }).forEach((path) => ensureFolder(path));
  [...folderSet].forEach((path) => {
    if (!path) return;
    const parent = _gParentFolder(path);
    if (parent == null) return;
    _gGraph.addEdge(ensureFolder(parent), ensureFolder(path), {
      _t: "contain",
      _struct: 1,
      type: "curved",
      curvature: 0.08 + Math.random() * 0.06,
      color: _G_COLORS.contain,
      _colorDim: _gBlendHex(_G_COLORS.contain, 0.08),
      _colorDim2: _gBlendHex(_G_COLORS.contain, 0.1),
      _colorBright: _gBrightHex("#6366f1", 1.5),
      size: 0.9
    });
  });
  const fileNodeByPath = /* @__PURE__ */ new Map();
  allFiles.slice().sort((a, b) => _gNormPath(a.path).localeCompare(_gNormPath(b.path))).forEach((file) => {
    const filePath = _gNormPath(file.path);
    if (!filePath) return;
    const folder = _gDirname(filePath);
    const ext = filePath.includes(".") ? `.${filePath.split(".").pop().toLowerCase()}` : "";
    const nodeKey = _gFileKey(filePath);
    fileNodeByPath.set(filePath, nodeKey);
    const _fLabel = _gLastSegment(file.label || filePath);
    const _fColor = _G_COLORS.file;
    _gGraph.addNode(nodeKey, {
      x: 0,
      y: 0,
      size: 6,
      color: _fColor,
      label: _fLabel,
      _colorDim: _gBlendHex(_fColor, 0.12),
      _colorFog: _gBlendHex(_fColor, 0.15),
      _colorHlDim: _gBlendHex(_fColor, 0.2),
      _colorSearchDim: _gBlendHex(_fColor, 0.35),
      _colorBright: _gBrightHex(_fColor, 1.4),
      _labelLower: _fLabel.toLowerCase(),
      _t: "file",
      _path: filePath,
      _file: filePath,
      _folder: folder,
      _line: 0,
      _endLine: 0,
      _parent: "",
      _symbolKind: file.file_type || "file",
      _mod: _gFolderModId(folder || filePath),
      _ext: ext,
      _fileId: file.id
    });
    _gGraph.addEdge(ensureFolder(folder), nodeKey, {
      _t: "contain",
      _struct: 1,
      type: "curved",
      curvature: 0.08 + Math.random() * 0.06,
      color: _G_COLORS.contain,
      _colorDim: _gBlendHex(_G_COLORS.contain, 0.08),
      _colorDim2: _gBlendHex(_G_COLORS.contain, 0.1),
      _colorBright: _gBrightHex("#6366f1", 1.5),
      size: 0.82
    });
  });
  const symbols = Object.values(symbolIndex).slice().sort((a, b) => (a.file || "").localeCompare(b.file || "") || (a.line || 0) - (b.line || 0) || (a.name || "").localeCompare(b.name || ""));
  const _classLikeSizes = {
    class: 8,
    struct: 8,
    interface: 7,
    enum: 5,
    typedef: 4,
    trait: 7,
    protocol: 7,
    mixin: 7,
    module: 7,
    impl: 6
  };
  symbols.forEach((sym) => {
    if (!_G_CLASS_KINDS.has(sym.kind)) return;
    const filePath = _gNormPath(sym.file || "");
    if (allowedFilePaths && !allowedFilePaths.has(filePath)) return;
    const nodeType = sym.kind;
    const nodeKey = `g-${nodeType}:${sym.id}`;
    const _cColor = _gNodeTypeColor(nodeType, sym.kind, sym.is_public);
    const _cLabel = sym.name || "";
    _gGraph.addNode(nodeKey, {
      x: 0,
      y: 0,
      size: _classLikeSizes[nodeType] || 8,
      color: _cColor,
      label: _cLabel,
      _colorDim: _gBlendHex(_cColor, 0.12),
      _colorFog: _gBlendHex(_cColor, 0.15),
      _colorHlDim: _gBlendHex(_cColor, 0.2),
      _colorSearchDim: _gBlendHex(_cColor, 0.35),
      _colorBright: _gBrightHex(_cColor, 1.4),
      _labelLower: _cLabel.toLowerCase(),
      _t: nodeType,
      _path: filePath,
      _file: filePath,
      _folder: _gDirname(filePath),
      _line: sym.line || 0,
      _endLine: sym.end_line || 0,
      _parent: sym.parent || "",
      _symbolKind: sym.kind,
      _symId: sym.id,
      _mod: _gFolderModId(filePath),
      _community: communityMap[sym.id] != null ? communityMap[sym.id] : -1,
      _typeColor: _cColor
    });
    classNodeBySymbol.set(sym.id, nodeKey);
    classNodeByFileName.set(`${filePath}::${sym.name}`, nodeKey);
    const ownerFileKey = fileNodeByPath.get(filePath);
    if (ownerFileKey) {
      _gGraph.addEdge(ownerFileKey, nodeKey, {
        _t: "define",
        _struct: 1,
        type: "curved",
        curvature: 0.08 + Math.random() * 0.06,
        color: _G_COLORS.define,
        _colorDim: _gBlendHex(_G_COLORS.define, 0.08),
        _colorDim2: _gBlendHex(_G_COLORS.define, 0.1),
        _colorBright: _gBrightHex(_G_COLORS.define, 1.5),
        size: 1.05
      });
    }
  });
  symbols.forEach((sym) => {
    if (!_G_FUNCTION_KINDS.has(sym.kind) && !_G_METHOD_KINDS.has(sym.kind)) return;
    const filePath = _gNormPath(sym.file || "");
    if (allowedFilePaths && !allowedFilePaths.has(filePath)) return;
    const nodeType = _G_METHOD_KINDS.has(sym.kind) ? "method" : "function";
    const idxKey = `${filePath}::${sym.name || ""}`;
    const nodeKey = `g-${nodeType}:${sym.id}`;
    const _fnColor = _gNodeTypeColor(nodeType, sym.kind, sym.is_public);
    const _fnLabel = sym.name || "";
    _gGraph.addNode(nodeKey, {
      x: 0,
      y: 0,
      size: nodeType === "method" ? 3.5 : 4.2,
      color: _fnColor,
      label: _fnLabel,
      _colorDim: _gBlendHex(_fnColor, 0.12),
      _colorFog: _gBlendHex(_fnColor, 0.15),
      _colorHlDim: _gBlendHex(_fnColor, 0.2),
      _colorSearchDim: _gBlendHex(_fnColor, 0.35),
      _colorBright: _gBrightHex(_fnColor, 1.4),
      _labelLower: _fnLabel.toLowerCase(),
      _t: nodeType,
      _path: filePath,
      _file: filePath,
      _folder: _gDirname(filePath),
      _line: sym.line || 0,
      _endLine: sym.end_line || 0,
      _parent: sym.parent || "",
      _symbolKind: sym.kind,
      _symId: sym.id,
      _funcIdx: methodLookup.has(idxKey) ? methodLookup.get(idxKey) : null,
      _mod: _gFolderModId(filePath),
      _community: communityMap[sym.id] != null ? communityMap[sym.id] : -1,
      _typeColor: _fnColor
    });
    callableNodeBySymbol.set(sym.id, nodeKey);
    const parentClassKey = sym.parent ? classNodeByFileName.get(`${filePath}::${sym.parent}`) : null;
    const ownerFileKey = fileNodeByPath.get(filePath);
    const sourceKey = parentClassKey || ownerFileKey;
    if (sourceKey) {
      _gGraph.addEdge(sourceKey, nodeKey, {
        _t: "define",
        _struct: 1,
        type: "curved",
        curvature: 0.08 + Math.random() * 0.06,
        color: _G_COLORS.define,
        _colorDim: _gBlendHex(_G_COLORS.define, 0.08),
        _colorDim2: _gBlendHex(_G_COLORS.define, 0.1),
        _colorBright: _gBrightHex(_G_COLORS.define, 1.5),
        size: parentClassKey ? 0.95 : 0.88
      });
    }
  });
  const importAgg = /* @__PURE__ */ new Map();
  Object.values(fileEdgesByMod).forEach((edges) => {
    edges.forEach((edge) => {
      const srcPath = filePathById.get(edge.s);
      const tgtPath = filePathById.get(edge.t);
      if (!srcPath || !tgtPath || srcPath === tgtPath) return;
      const key = `${srcPath}=>${tgtPath}`;
      importAgg.set(key, (importAgg.get(key) || 0) + 1);
    });
  });
  importAgg.forEach((weight, key) => {
    const [srcPath, tgtPath] = key.split("=>");
    const src = fileNodeByPath.get(srcPath);
    const tgt = fileNodeByPath.get(tgtPath);
    if (!src || !tgt || src === tgt) return;
    _gGraph.addEdge(src, tgt, {
      _t: "import",
      type: "curved",
      curvature: 0.12 + Math.random() * 0.08,
      color: _G_COLORS.import,
      _colorDim: _gBlendHex(_G_COLORS.import, 0.08),
      _colorDim2: _gBlendHex(_G_COLORS.import, 0.1),
      _colorBright: _gBrightHex(_G_COLORS.import, 1.5),
      size: Math.max(0.8, Math.min(2.4, 0.6 + weight * 0.12))
    });
  });
  const callAgg = /* @__PURE__ */ new Map();
  symbolEdges.forEach((edge) => {
    if (edge.type !== "call") return;
    const src = callableNodeBySymbol.get(edge.from);
    const tgt = callableNodeBySymbol.get(edge.to);
    if (!src || !tgt || src === tgt) return;
    const key = `${src}=>${tgt}`;
    callAgg.set(key, (callAgg.get(key) || 0) + 1);
  });
  callAgg.forEach((weight, key) => {
    const [src, tgt] = key.split("=>");
    _gGraph.addEdge(src, tgt, {
      _t: "call",
      type: "curved",
      curvature: 0.12 + Math.random() * 0.08,
      color: _G_COLORS.call,
      _colorDim: _gBlendHex(_G_COLORS.call, 0.08),
      _colorDim2: _gBlendHex(_G_COLORS.call, 0.1),
      _colorBright: _gBrightHex(_G_COLORS.call, 1.5),
      size: Math.max(0.75, Math.min(2.2, 0.65 + weight * 0.2))
    });
  });
  const extendAgg = /* @__PURE__ */ new Map();
  symbolEdges.forEach((edge) => {
    if (edge.type !== "inheritance") return;
    const src = classNodeBySymbol.get(edge.from);
    const tgt = classNodeBySymbol.get(edge.to);
    if (!src || !tgt || src === tgt) return;
    const key = `${src}=>${tgt}`;
    extendAgg.set(key, (extendAgg.get(key) || 0) + 1);
  });
  extendAgg.forEach((weight, key) => {
    const [src, tgt] = key.split("=>");
    _gGraph.addEdge(src, tgt, {
      _t: "extend",
      type: "curved",
      curvature: 0.12 + Math.random() * 0.08,
      color: _G_COLORS.extend,
      _colorDim: _gBlendHex(_G_COLORS.extend, 0.08),
      _colorDim2: _gBlendHex(_G_COLORS.extend, 0.1),
      _colorBright: _gBrightHex(_G_COLORS.extend, 1.5),
      size: Math.max(0.9, Math.min(2.3, 0.8 + weight * 0.15))
    });
  });
  function addSemanticClassEdges(edgeType) {
    const agg = /* @__PURE__ */ new Map();
    symbolEdges.forEach((edge) => {
      if (edge.type !== edgeType) return;
      const src = classNodeBySymbol.get(edge.from);
      const tgt = classNodeBySymbol.get(edge.to);
      if (!src || !tgt || src === tgt) return;
      const key = `${src}=>${tgt}`;
      agg.set(key, (agg.get(key) || 0) + 1);
    });
    agg.forEach((weight, key) => {
      const [src, tgt] = key.split("=>");
      const color = _G_COLORS[edgeType] || _G_COLORS.implements;
      _gGraph.addEdge(src, tgt, {
        _t: edgeType,
        type: "curved",
        curvature: 0.12 + Math.random() * 0.08,
        color,
        _colorDim: _gBlendHex(color, 0.08),
        _colorDim2: _gBlendHex(color, 0.1),
        _colorBright: _gBrightHex(color, 1.5),
        size: Math.max(0.85, Math.min(2, 0.7 + weight * 0.15))
      });
    });
  }
  [
    "implements",
    "mixin_include",
    "mixin_extend",
    "mixin_prepend",
    "behaviour_impl",
    "protocol_impl"
  ].forEach(addSemanticClassEdges);
  const overrideAgg = /* @__PURE__ */ new Map();
  symbolEdges.forEach((edge) => {
    if (edge.type !== "override") return;
    const src = callableNodeBySymbol.get(edge.from);
    const tgt = callableNodeBySymbol.get(edge.to);
    if (!src || !tgt || src === tgt) return;
    const key = `${src}=>${tgt}`;
    overrideAgg.set(key, (overrideAgg.get(key) || 0) + 1);
  });
  overrideAgg.forEach((weight, key) => {
    const [src, tgt] = key.split("=>");
    _gGraph.addEdge(src, tgt, {
      _t: "override",
      type: "curved",
      curvature: 0.12 + Math.random() * 0.08,
      color: _G_COLORS.override,
      _colorDim: _gBlendHex(_G_COLORS.override, 0.08),
      _colorDim2: _gBlendHex(_G_COLORS.override, 0.1),
      _colorBright: _gBrightHex(_G_COLORS.override, 1.5),
      size: Math.max(0.8, Math.min(2, 0.7 + weight * 0.15))
    });
  });
  const totalNodes = _gGraph.order;
  if (totalNodes > 1e3) {
    _gGraph.forEachNode((key, attrs) => {
      _gGraph.setNodeAttribute(key, "size", _gScaledSize(attrs.size, totalNodes));
    });
  }
}
function _galaxyInitPositions() {
  const nodeCount = _gGraph.order;
  if (nodeCount === 0) return;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const seedCore = Math.sqrt(nodeCount) * 25;
  const parentToChildren = /* @__PURE__ */ new Map();
  const childToParent = /* @__PURE__ */ new Map();
  _gGraph.forEachEdge((edge, attrs, src, tgt) => {
    if (attrs._struct) {
      if (!parentToChildren.has(src)) parentToChildren.set(src, []);
      parentToChildren.get(src).push(tgt);
      childToParent.set(tgt, src);
    }
  });
  const typeOf = /* @__PURE__ */ new Map();
  const communityOf = /* @__PURE__ */ new Map();
  _gGraph.forEachNode((key, attrs) => {
    typeOf.set(key, attrs._t);
    communityOf.set(key, attrs._community != null && attrs._community >= 0 ? attrs._community : -1);
  });
  const typeRank = (t) => {
    if (t === "folder") return 0;
    if (t === "file") return 1;
    if (t === "function" || t === "method") return 3;
    return 2;
  };
  const groupKeyFor = (key) => {
    const com = communityOf.get(key);
    if (com >= 0) return "c" + com;
    let cur = key, lastFile = null, lastFolder = null, top = key, guard = 0;
    while (guard++ < 128) {
      const t = typeOf.get(cur);
      if (t === "file" && lastFile === null) lastFile = cur;
      if (t === "folder" && lastFolder === null) lastFolder = cur;
      const parent = childToParent.get(cur);
      if (parent == null) {
        top = cur;
        break;
      }
      cur = parent;
    }
    if (lastFile !== null) return "F" + lastFile;
    if (lastFolder !== null) return "f" + lastFolder;
    return "t" + top;
  };
  const orphans = [];
  const groups = /* @__PURE__ */ new Map();
  _gGraph.forEachNode((key) => {
    const isOrphan = !childToParent.has(key) && !parentToChildren.has(key) && communityOf.get(key) < 0;
    if (isOrphan) {
      orphans.push(key);
      return;
    }
    const gk = groupKeyFor(key);
    let arr = groups.get(gk);
    if (!arr) {
      arr = [];
      groups.set(gk, arr);
    }
    arr.push(key);
  });
  const groupKeys = Array.from(groups.keys());
  groupKeys.sort((a, b) => groups.get(b).length - groups.get(a).length);
  const K = groupKeys.length;
  const place = (key, x, y) => {
    _gGraph.setNodeAttribute(key, "x", x);
    _gGraph.setNodeAttribute(key, "y", y);
  };
  groupKeys.forEach((gk, k) => {
    const members = groups.get(gk);
    members.sort((a, b) => typeRank(typeOf.get(a)) - typeRank(typeOf.get(b)));
    const g = members.length;
    const cAngle = k * goldenAngle;
    const cRadius = seedCore * (0.35 + 0.65 * Math.sqrt(K > 1 ? k / (K - 1) : 0));
    const cx = cRadius * Math.cos(cAngle);
    const cy = cRadius * Math.sin(cAngle);
    const localSpread = Math.max(seedCore * 0.03, seedCore * 0.45 * Math.sqrt(g / nodeCount));
    members.forEach((key, j) => {
      const lr = localSpread * Math.sqrt((j + 0.5) / g);
      const la = j * goldenAngle;
      const jitter = 0.9 + Math.random() * 0.2;
      place(key, cx + lr * Math.cos(la) * jitter, cy + lr * Math.sin(la) * jitter);
    });
  });
  const O = orphans.length;
  orphans.forEach((key, o) => {
    const a = o * goldenAngle;
    const r = seedCore * (0.9 + 0.35 * ((o + 0.5) / Math.max(O, 1)));
    const jitter = 0.92 + Math.random() * 0.16;
    place(key, r * Math.cos(a) * jitter, r * Math.sin(a) * jitter);
  });
}
