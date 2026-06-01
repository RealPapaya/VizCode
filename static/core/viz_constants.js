// @module viz_constants — Immutable constants, shape/color/edge maps
// Owns: DEFAULT_CODE_FONT, FILE_TYPE_SHAPE, EDGE_TYPE_STYLE, EDGE_WIDTH,
//       extColor, fileNodeData, otherFileNodeData, edgeTypeStyle,
//       LEGEND_EDGES, LEGEND_NODES, L2_LEGEND_ITEMS

const DEFAULT_CODE_FONT = "'JetBrains Mono', monospace";

// ─── Call Flow Legend ─────────────────────────────────────────────────────────
const L2_LEGEND_ITEMS = [
    { color: '#38bdf8', label: 'Internal / Same file', style: 'solid' },
    { color: '#10b981', label: '1 - 2 layers away', style: 'solid' },
    { color: '#f59e0b', label: '3 - 4 layers away', style: 'solid' },
    { color: '#f87171', label: '5+ layers away', style: 'solid' },
    { color: '#a78bfa', label: 'Ambiguous (multi)', style: 'dashed' },
    { color: '#64748b', label: 'System / unknown', style: 'dotted' },
];

function extColor(ext) {
    const map = {
        // ── C / C++ / Systems ────────────────────────────────────────────────
        '.c': '#3b82f6', '.cpp': '#06b6d4', '.cc': '#06b6d4', '.cxx': '#06b6d4',
        '.h': '#8b5cf6', '.hpp': '#7c3aed', '.hxx': '#7c3aed', '.hh': '#7c3aed',
        '.rs': '#f97316',       // Rust — orange
        '.zig': '#f6a21e',      // Zig — amber
        // ── Assembly ─────────────────────────────────────────────────────────
        '.asm': '#f59e0b', '.s': '#f59e0b', '.S': '#f59e0b', '.nasm': '#f59e0b',
        // ── UEFI / EDK2 ─────────────────────────────────────────────────────
        '.inf': '#ffd700', '.dec': '#dfa745', '.dsc': '#e2e8f0', '.fdf': '#c084fc',
        '.sdl': '#34d399', '.sd': '#10b981', '.cif': '#60a5fa', '.mak': '#94a3b8',
        '.vfr': '#f472b6', '.hfr': '#e940a0', '.uni': '#fb923c', '.asl': '#a78bfa',
        // ── Python ───────────────────────────────────────────────────────────
        '.py': '#4584c3', '.pyw': '#4584c3', '.pyx': '#3a74b3',
        '.ipynb': '#f59e0b',   // Jupyter — amber
        // ── JavaScript / TypeScript ──────────────────────────────────────────
        '.js': '#f0c040', '.mjs': '#f0c040', '.cjs': '#e8b830',
        '.jsx': '#61dafb',
        '.ts': '#3b8fd4', '.tsx': '#61dafb',
        // ── Web ──────────────────────────────────────────────────────────────
        '.html': '#e44d26', '.htm': '#e44d26', '.xhtml': '#e44d26',
        '.css': '#1572b6', '.scss': '#cd669a', '.sass': '#cd669a', '.less': '#1d365d',
        '.styl': '#ff6347',
        '.svg': '#ffb13b',
        '.graphql': '#e10098', '.gql': '#e10098',
        // ── Go ───────────────────────────────────────────────────────────────
        '.go': '#00c6db',
        // ── JVM / Mobile ─────────────────────────────────────────────────────
        '.java': '#ed8b00',    // Java — dark amber
        '.kt': '#7f52ff',      // Kotlin — purple
        '.kts': '#7f52ff',
        '.scala': '#dc322f',   // Scala — red
        '.groovy': '#629fcc',
        '.gradle': '#629fcc',
        '.dart': '#0175c2',    // Dart — blue
        '.swift': '#f05138',   // Swift — orange-red
        '.m': '#438eff',       // Objective-C — blue
        '.mm': '#438eff',
        // ── C# / .NET ────────────────────────────────────────────────────────
        '.cs': '#9b4993',      // C# — purple
        '.vb': '#004289',
        '.fs': '#378bba',      // F# — teal
        '.fsx': '#378bba',
        // ── Scripting ────────────────────────────────────────────────────────
        '.rb': '#cc342d',      // Ruby — red
        '.gemspec': '#cc342d', '.rake': '#cc342d',
        '.php': '#8892bf',     // PHP — indigo
        '.pl': '#39457e',      // Perl — dark blue
        '.pm': '#39457e',
        '.lua': '#000080',     // Lua — navy
        '.sh': '#4eaa25',      // Bash — green
        '.bash': '#4eaa25', '.zsh': '#4eaa25', '.fish': '#4eaa25',
        '.ps1': '#012456',     // PowerShell — dark blue
        '.psm1': '#012456', '.psd1': '#012456',
        '.bat': '#c1c1c1', '.cmd': '#c1c1c1',
        '.r': '#276dc3',       // R — blue
        '.R': '#276dc3',
        '.jl': '#9558b2',      // Julia — purple
        '.ex': '#6e4a7e',      // Elixir — plum
        '.exs': '#6e4a7e',
        '.erl': '#a90533',     // Erlang — dark red
        '.hrl': '#a90533',
        '.clj': '#5881d8',     // Clojure — blue
        '.cljs': '#5881d8',
        '.hs': '#5e5086',      // Haskell — deep purple
        '.ml': '#ee6a1a',      // OCaml — orange
        '.mli': '#ee6a1a',
        '.elm': '#60b5cc',     // Elm — teal
        '.nim': '#ffe953',     // Nim — yellow
        '.cr': '#000000',      // Crystal — black
        '.d': '#ba595e',       // D — rose
        '.coffee': '#244776',
        '.awk': '#c0c0c0',
        '.tcl': '#e4cc98',
        '.pony': '#864029',
        '.v': '#5d87bf',       // Verilog
        '.vhd': '#048a81',     // VHDL
        // ── Data / Config ────────────────────────────────────────────────────
        '.json': '#cbcb41',    // yellow
        '.jsonc': '#cbcb41',
        '.yaml': '#cc3e44',    // red
        '.yml': '#cc3e44',
        '.toml': '#9c4221',    // burnt
        '.ini': '#94a3b8', '.cfg': '#94a3b8', '.conf': '#94a3b8',
        '.xml': '#f16529',     // orange (like HTML)
        '.plist': '#f16529',
        '.csv': '#6abd45',
        '.env': '#ecd53f',
        '.properties': '#b58900',
        // ── Infrastructure ───────────────────────────────────────────────────
        '.tf': '#7b42bc',      // Terraform — purple
        '.hcl': '#7b42bc',
        '.proto': '#4285f4',   // Protobuf — blue
        '.thrift': '#d74108',
        // ── Build ────────────────────────────────────────────────────────────
        '.cmake': '#064f8c',
        '.mk': '#94a3b8',
        '.bazel': '#76d275', '.bzl': '#76d275',
        // ── Docs ─────────────────────────────────────────────────────────────
        '.md': '#519aba',      // Markdown — steel blue
        '.mdx': '#519aba',
        '.rst': '#87ceeb',
        '.tex': '#3d6117',     // LaTeX — dark green
        '.txt': '#9aaab4',
        // ── Database ─────────────────────────────────────────────────────────
        '.sql': '#dad8d8',
        '.psql': '#336791', '.pgsql': '#336791',
        // ── Shader / GPU ─────────────────────────────────────────────────────
        '.glsl': '#5686a5', '.vert': '#5686a5', '.frag': '#5686a5',
        '.hlsl': '#aaaaff',
        '.wgsl': '#005580',
        // ── Misc ─────────────────────────────────────────────────────────────
        '.diff': '#41535b', '.patch': '#41535b',
        '.vim': '#019733',
        '.nix': '#7ebae4',
        '.sol': '#363636',
        '.lock': '#bbbbbb', '.log': '#999999',
    };
    return map[ext] || '#64748b';
}

// ─── File type → cytoscape node shape ────────────────────────────────────────
const FILE_TYPE_SHAPE = {
    // BIOS / C
    'c_source': { sh: 'ellipse', w: 160, h: 48 },
    'header': { sh: 'round-rectangle', w: 155, h: 44 },
    'assembly': { sh: 'triangle', w: 120, h: 56 },
    'module_inf': { sh: 'diamond', w: 190, h: 60 },
    'package_dec': { sh: 'hexagon', w: 190, h: 58 },
    'platform_dsc': { sh: 'star', w: 160, h: 60 },
    'flash_desc': { sh: 'vee', w: 160, h: 56 },
    'common_file': { sh: 'round-rectangle', w: 165, h: 46 },
    'makefile': { sh: 'tag', w: 150, h: 46 },
    'hii_vfr': { sh: 'round-tag', w: 165, h: 50 },
    'hii_form': { sh: 'round-tag', w: 165, h: 50 },
    'hii_string': { sh: 'round-rectangle', w: 155, h: 44 },
    'acpi_asl': { sh: 'pentagon', w: 160, h: 56 },
    // ── Python ───────────────────────────────────────────────────────────────
    // Rhomboid (parallelogram) — distinctly Python-y, like an ouroboros coil
    'py_source': { sh: 'rhomboid', w: 170, h: 52 },
    // ── JavaScript ───────────────────────────────────────────────────────────
    // Cut-rectangle — like a bracket { } in the corner
    'js_source': { sh: 'cut-rectangle', w: 165, h: 48 },
    // JSX — same family as JS, slightly wider for component name
    'jsx_source': { sh: 'cut-rectangle', w: 175, h: 50 },
    // ── TypeScript ────────────────────────────────────────────────────────────
    // Bottom-round-rectangle — "typed" = smoother than JS
    'ts_source': { sh: 'bottom-round-rectangle', w: 165, h: 50 },
    'tsx_source': { sh: 'bottom-round-rectangle', w: 175, h: 52 },
    // ── Go ────────────────────────────────────────────────────────────────────
    // Hexagon — clean, structured, like Go's package layout
    'go_source': { sh: 'hexagon', w: 175, h: 58 },
    // ── JVM / Mobile ──────────────────────────────────────────────────────────
    'java_source':   { sh: 'round-rectangle', w: 165, h: 48 },  // Java — rounded, enterprise
    'kotlin_source': { sh: 'cut-rectangle', w: 165, h: 48 },    // Kotlin — modern cut
    'scala_source':  { sh: 'rhomboid', w: 165, h: 48 },         // Scala — functional+OOP
    'groovy_source': { sh: 'round-rectangle', w: 160, h: 48 },
    'dart_source':   { sh: 'bottom-round-rectangle', w: 165, h: 48 }, // Dart — like TS family
    'swift_source':  { sh: 'cut-rectangle', w: 165, h: 48 },    // Swift — modern, sharp
    'objc_source':   { sh: 'round-rectangle', w: 165, h: 48 },  // ObjC — classic rounded
    // ── .NET ──────────────────────────────────────────────────────────────────
    'csharp_source': { sh: 'round-rectangle', w: 165, h: 48 },
    'vb_source':     { sh: 'round-rectangle', w: 160, h: 48 },
    'fsharp_source': { sh: 'rhomboid', w: 165, h: 48 },         // F# — functional
    // ── Scripting ─────────────────────────────────────────────────────────────
    'ruby_source':   { sh: 'diamond', w: 170, h: 56 },          // Ruby — gem shape
    'php_source':    { sh: 'round-rectangle', w: 160, h: 48 },
    'perl_source':   { sh: 'ellipse', w: 160, h: 48 },
    'lua_source':    { sh: 'ellipse', w: 155, h: 46 },
    'shell_source':  { sh: 'tag', w: 160, h: 46 },              // Shell — command-like
    'r_source':      { sh: 'ellipse', w: 155, h: 46 },
    'julia_source':  { sh: 'ellipse', w: 160, h: 48 },
    // ── Systems ───────────────────────────────────────────────────────────────
    'rust_source':   { sh: 'hexagon', w: 175, h: 56 },          // Rust — robust, like Go
    'zig_source':    { sh: 'hexagon', w: 170, h: 54 },          // Zig — same systems family
    'd_source':      { sh: 'ellipse', w: 155, h: 48 },
    'nim_source':    { sh: 'cut-rectangle', w: 160, h: 48 },    // Nim — modern systems
    'crystal_source':{ sh: 'diamond', w: 170, h: 56 },          // Crystal — like Ruby
    // ── Functional ────────────────────────────────────────────────────────────
    'elixir_source':  { sh: 'rhomboid', w: 170, h: 50 },        // Elixir — functional
    'erlang_source':  { sh: 'octagon', w: 170, h: 54 },         // Erlang — robust/unique
    'clojure_source': { sh: 'ellipse', w: 165, h: 50 },         // Clojure — Lisp circles
    'haskell_source': { sh: 'rhomboid', w: 170, h: 50 },        // Haskell — pure functional
    'ocaml_source':   { sh: 'rhomboid', w: 165, h: 48 },        // OCaml — functional family
    'elm_source':     { sh: 'round-rectangle', w: 160, h: 46 },
    // ── Data / Schema ─────────────────────────────────────────────────────────
    'sql_source':      { sh: 'barrel', w: 165, h: 50 },         // SQL — database barrel
    'graphql_source':  { sh: 'concave-hexagon', w: 170, h: 50 },// GraphQL — API shape
    'proto_source':    { sh: 'round-tag', w: 165, h: 48 },      // Proto — message tag
    // ── Web / Styles ──────────────────────────────────────────────────────────────
    'css_source':      { sh: 'ellipse', w: 150, h: 46 },        // CSS — simple ellipse
    'scss_source':     { sh: 'ellipse', w: 160, h: 48 },        // SCSS — enhanced CSS
    'sass_source':     { sh: 'ellipse', w: 160, h: 48 },        // SASS — same as SCSS
    'less_source':     { sh: 'ellipse', w: 155, h: 46 },        // LESS — CSS preprocessor
    'stylus_source':   { sh: 'ellipse', w: 160, h: 46 },        // Stylus — flexible syntax
    'html_source':     { sh: 'round-tag', w: 165, h: 48 },      // HTML — markup tag
    // ── Config / Data ──────────────────────────────────────────────────────────────
    'json_config':     { sh: 'round-rectangle', w: 165, h: 48 }, // JSON — configuration file
    'yaml_source':     { sh: 'cut-rectangle', w: 160, h: 46 },   // YAML — config
    'toml_source':     { sh: 'cut-rectangle', w: 160, h: 46 },   // TOML — config
    'powershell_source': { sh: 'tag', w: 165, h: 46 },           // PowerShell — command-like
    // Fallbacks
    'other': { sh: 'round-rectangle', w: 155, h: 46 },
    'binary': { sh: 'round-rectangle', w: 150, h: 42 },
};

// ─── Edge type → color + style ───────────────────────────────────────────────
const EDGE_TYPE_STYLE = {
    // ── File-level dependency edges (kind = 'import') ─────────────────────
    'include':      { color: '#c084fc', style: 'solid',  label: 'Include',   kind: 'import' },
    'sources':      { color: '#ffd700', style: 'solid',  label: 'Sources',   kind: 'import' },
    'package':      { color: '#dfa745', style: 'solid',  label: 'Package',   kind: 'import' },
    'library':      { color: '#a78bfa', style: 'solid',  label: 'Library',   kind: 'import' },
    'elink':        { color: '#ff6b35', style: 'solid',  label: 'ELINK',     kind: 'import' },
    'cif_own':      { color: '#34d399', style: 'solid',  label: 'Owns',      kind: 'import' },
    'component':    { color: '#60a5fa', style: 'solid',  label: 'Component', kind: 'import' },
    'depex':        { color: '#f472b6', style: 'solid',  label: 'Depex',     kind: 'import' },
    'guid_ref':     { color: '#fb923c', style: 'solid',  label: 'GUID',      kind: 'import' },
    'str_ref':      { color: '#e879f9', style: 'solid',  label: 'Strings',   kind: 'import' },
    'asl_include':  { color: '#818cf8', style: 'solid',  label: 'ASL',       kind: 'import' },
    'callback_ref': { color: '#f87171', style: 'solid',  label: 'Callback',  kind: 'import' },
    'hii_pkg':      { color: '#94a3b8', style: 'solid',  label: 'HII-Pkg',   kind: 'import' },
    // ── Universal import (all analysed languages) ─────────────────────────
    'import':       { color: '#10b981', style: 'solid',  label: 'Import',    kind: 'import' },
    'asset_ref':    { color: '#22d3ee', style: 'dashed', label: 'Asset',     kind: 'import' },
    'config_ref':   { color: '#f59e0b', style: 'dashed', label: 'Config',    kind: 'import' },
    // ── Semantic kind edges ───────────────────────────────────────────────
    'call':         { color: '#38bdf8', style: 'solid',  label: 'Call',      kind: 'call'   },
    'inherit':      { color: '#818cf8', style: 'solid',  label: 'Inherit',   kind: 'inherit'},
    // ── AI-inferred edge (B1, dashed by design) ───────────────────────────
    'inferred':     { color: '#94a3b8', style: 'dashed', label: 'Inferred',  kind: 'inferred'},
};

const EDGE_STYLE_INTERNAL = 'solid';
const EDGE_STYLE_EXTERNAL = 'dashed';
const EDGE_WIDTH = {
    fileInternal: 0.95,
    fileExternal: 1.0,
    callInternal: 1.15,
    callExternal: 1.05,
    drillExternal: 1.0,
};
// ─── File type → human-readable full name ────────────────────────────────────
const FILE_TYPE_FULL_NAME = {
    // BIOS / C
    'c_source':     'C Source File',
    'header':       'C/C++ Header File',
    'assembly':     'Assembly Source',
    'module_inf':   'EDK2 Module INF',
    'package_dec':  'EDK2 Package DEC',
    'platform_dsc': 'EDK2 Platform DSC',
    'flash_desc':   'Flash Description (FDF)',
    'common_file':  'Common File',
    'makefile':     'Makefile',
    'hii_vfr':      'HII Form (VFR)',
    'hii_form':     'HII Form',
    'hii_string':   'HII String (UNI)',
    'acpi_asl':     'ACPI ASL Source',
    // Python
    'py_source':    'Python Source',
    // JavaScript / TypeScript
    'js_source':    'JavaScript Source',
    'jsx_source':   'JSX Component',
    'ts_source':    'TypeScript Source',
    'tsx_source':   'TSX Component',
    // Go
    'go_source':    'Go Source',
    // JVM / Mobile
    'java_source':    'Java Source',
    'kotlin_source':  'Kotlin Source',
    'scala_source':   'Scala Source',
    'groovy_source':  'Groovy Source',
    'dart_source':    'Dart Source',
    'swift_source':   'Swift Source',
    'objc_source':    'Objective-C Source',
    // .NET
    'csharp_source':  'C# Source',
    'vb_source':      'VB.NET Source',
    'fsharp_source':  'F# Source',
    // Scripting
    'ruby_source':    'Ruby Source',
    'php_source':     'PHP Source',
    'perl_source':    'Perl Source',
    'lua_source':     'Lua Source',
    'shell_source':   'Shell Script',
    'r_source':       'R Source',
    'julia_source':   'Julia Source',
    // Systems
    'rust_source':    'Rust Source',
    'zig_source':     'Zig Source',
    'd_source':       'D Source',
    'nim_source':     'Nim Source',
    'crystal_source': 'Crystal Source',
    // Functional
    'elixir_source':  'Elixir Source',
    'erlang_source':  'Erlang Source',
    'clojure_source': 'Clojure Source',
    'haskell_source': 'Haskell Source',
    'ocaml_source':   'OCaml Source',
    'elm_source':     'Elm Source',
        // Data / Schema
    'sql_source':     'SQL Source',
    'graphql_source': 'GraphQL Schema',
    'proto_source':   'Protocol Buffers',
    // Web / Styles
    'css_source':     'CSS Stylesheet',
    'scss_source':    'SCSS Stylesheet',
    'sass_source':    'Sass Stylesheet',
    'less_source':    'LESS Stylesheet',
    'stylus_source':  'Stylus Stylesheet',
    'html_source':    'HTML Document',
    // Config / Data
    'json_config':    'JSON Configuration',
    'yaml_source':    'YAML Configuration',
    'toml_source':    'TOML Configuration',
    // Scripting (Windows)
    'powershell_source': 'PowerShell Script',
    // Fallbacks
    'other':        'File',
    'binary':       'Binary File',
};

function fileTypeFullName(ft, ext) {
    if (FILE_TYPE_FULL_NAME[ft]) return FILE_TYPE_FULL_NAME[ft];
    if (ext) return ext.replace(/^\./, '').toUpperCase() + ' File';
    return 'File';
}

function fileNodeData(f, modColor) {
    const ft = f.file_type || 'other';
    const shape = FILE_TYPE_SHAPE[ft] || FILE_TYPE_SHAPE['other'];
    const isSimple = _shapeMode === 'simple';
    const eff = isSimple ? { sh: 'ellipse', w: SIMPLE_NODE_SIZE_SM, h: SIMPLE_NODE_SIZE_SM } : shape;
    const baseColor = extColor(f.ext);

    // Build tooltip with BIOS metadata
    // Format: label\n§path§\nkey: val\n...  (§path§ marks the path line)
    const bm = f.bios_meta || {};
    let ttLines = [`${f.label}`, `§${f.path}§`];
    ttLines.push(`${T('fileType')}: ${fileTypeFullName(ft, f.ext)}`);
    ttLines.push(`${T('fileSize')}: ${fmtSize(f.size)}`);
    if (f.func_count > 0) ttLines.push(`${T('funcsCount')}: ${f.func_count}`);
    if (bm.MODULE_TYPE || bm.module_type) ttLines.push(`${T('modType')}: ${bm.MODULE_TYPE || bm.module_type}`);
    if (bm.BASE_NAME || bm.base_name) ttLines.push(`${T('module')}: ${bm.BASE_NAME || bm.base_name}`);
    if (bm.ENTRY_POINT || bm.entry_point) ttLines.push(`${T('entryPoint')}: ${bm.ENTRY_POINT || bm.entry_point}`);
    if (bm.FILE_GUID || bm.file_guid) ttLines.push(`${T('fileGuid')}: ${bm.FILE_GUID || bm.file_guid}`);

    return {
        id: `f${f.id}`, label: f.label,
        bg: isSimple ? baseColor : '#0a1520', bc: baseColor,
        lvl: 1, w: eff.w, h: eff.h, sh: eff.sh,
        ft, simple: isSimple ? 1 : 0,
        tt: ttLines.join('\n'),
        _t: 'file', _f: f,
    };
}

function edgeTypeStyle(type) {
    return EDGE_TYPE_STYLE[type] || EDGE_TYPE_STYLE['include'];
}

// Returns line-style and opacity override for a given semantic kind.
// 'inferred' edges (future B1) are visually distinguished with dashed lines.
function kindStyle(kind) {
    if (kind === 'inferred') return { lineStyle: 'dashed', opacity: 0.55 };
    return { lineStyle: 'solid', opacity: 0.75 };
}

// ─── Other/Binary file node (not deeply analysed) ────────────────────────────
function otherFileNodeData(f) {
    const ft = f.file_type || 'other';
    const shape = FILE_TYPE_SHAPE[ft] || FILE_TYPE_SHAPE['other'];
    const isSimple = _shapeMode === 'simple';
    const eff = isSimple ? { sh: 'ellipse', w: SIMPLE_NODE_SIZE_SM, h: SIMPLE_NODE_SIZE_SM } : shape;
    const isBin = ft === 'binary';
    // Muted gray palette — distinct from analysed files
    const bc = isBin ? '#374151' : '#4b5563';
    const bg = isSimple ? bc : (isBin ? '#0c0c0e' : '#0d0f12');
    const extLbl = f.ext ? f.ext.toUpperCase() : 'FILE';
    const ttLines = [
        f.path,
        `Type: ${extLbl}${isBin ? ' (binary/obj — not analysed)' : ' (unrecognised — not analysed)'}`,
        `Size: ${fmtSize(f.size)}`,
    ];
    return {
        id: `f${f.id}`, label: f.label,
        bg, bc,
        lvl: 1, w: eff.w, h: eff.h, sh: eff.sh,
        ft, simple: isSimple ? 1 : 0,
        isExtra: true,   // used by CY_STYLE selector for dimmed rendering
        tt: ttLines.join('\n'),
        _t: 'file', _f: f,
    };
}


const LEGEND_EDGES = [
    // elKey = value stored in edge.data('el')
    { type: 'include', label: 'Include', color: '#c084fc', style: 'solid', elKey: 'Inc' },
    { type: 'import', label: 'Import', color: '#10b981', style: 'dashed', elKey: 'Import' },
    { type: 'sources', label: 'Src', color: '#ffd700', style: 'solid', elKey: 'Src' },
    { type: 'package', label: 'Pkg', color: '#dfa745', style: 'dashed', elKey: 'Pkg' },
    { type: 'library', label: 'Lib', color: '#a78bfa', style: 'dashed', elKey: 'Lib' },
    { type: 'cif_own', label: 'owns', color: '#34d399', style: 'solid', elKey: 'owns' },
    { type: 'component', label: 'Comp', color: '#60a5fa', style: 'solid', elKey: 'Comp' },
    { type: 'guid_ref', label: 'GUID', color: '#fb923c', style: 'dashed', elKey: 'GUID' },
    { type: 'elink', label: 'ELINK', color: '#ff6b35', style: 'dotted', elKey: 'ELINK' },
    { type: 'str_ref', label: 'Strings', color: '#e879f9', style: 'dashed', elKey: 'Strings' },
    { type: 'hii_pkg', label: 'HII-Pkg', color: '#94a3b8', style: 'solid', elKey: 'HII-Pkg' },
    { type: 'callback_ref', label: 'Callback', color: '#f87171', style: 'dotted', elKey: 'Callback' },
    { type: 'asl_include', label: 'ASL', color: '#818cf8', style: 'solid', elKey: 'ASL' },
    { type: 'depex', label: 'Depex', color: '#f472b6', style: 'dotted', elKey: 'Depex' },
];
const LEGEND_NODES = [
    // exts = file extensions (lowercase, with dot) that map to this legend entry
    // ── BIOS / C ─────────────────────────────────────────────────────────────
    { shape: '◆', label: '.inf', color: '#ffd700', exts: ['.inf'] },
    { shape: '⬡', label: '.dec', color: '#dfa745', exts: ['.dec'] },
    { shape: '▭', label: 'Common', color: '#60a5fa', exts: ['.sdl', '.sd', '.cif', '.hfr', '.mak'] },
    { shape: '●', label: '.c/.h', color: '#3b82f6', exts: ['.c', '.h'] },
    { shape: '▲', label: '.asm', color: '#f59e0b', exts: ['.asm', '.s', '.nasm'] },
    { shape: '⬠', label: '.dsc', color: '#e2e8f0', exts: ['.dsc'] },
    { shape: '‣', label: '.vfr', color: '#f472b6', exts: ['.vfr'] },
    { shape: '□', label: '.uni', color: '#fb923c', exts: ['.uni'] },
    { shape: '▷', label: '.asl', color: '#a78bfa', exts: ['.asl', '.aslc'] },
    // ── Python / JS / TS / Go ─────────────────────────────────────────────────
    { shape: '⬦', label: '.py', color: '#4584c3', exts: ['.py'] },
    { shape: '◱', label: '.js/.mjs', color: '#f0c040', exts: ['.js', '.mjs', '.cjs'] },
    { shape: '◱', label: '.jsx', color: '#61dafb', exts: ['.jsx'] },
    { shape: '⬔', label: '.ts/.tsx', color: '#3b8fd4', exts: ['.ts', '.tsx'] },
    { shape: '⬡', label: '.go', color: '#00c6db', exts: ['.go'] },
    // ── JVM / Mobile ──────────────────────────────────────────────────────────
    { shape: '●', label: '.java', color: '#ed8b00', exts: ['.java'] },
    { shape: '◐', label: '.kt', color: '#7f52ff', exts: ['.kt', '.kts'] },
    { shape: '●', label: '.scala', color: '#dc322f', exts: ['.scala'] },
    { shape: '●', label: '.groovy', color: '#629fcc', exts: ['.groovy'] },
    { shape: '◐', label: '.dart', color: '#0175c2', exts: ['.dart'] },
    { shape: '●', label: '.swift', color: '#f05138', exts: ['.swift'] },
    { shape: '●', label: '.m/.mm', color: '#438eff', exts: ['.m', '.mm'] },
    // ── .NET ──────────────────────────────────────────────────────────────────
    { shape: '◐', label: '.cs', color: '#9b4993', exts: ['.cs'] },
    { shape: '◐', label: '.fs', color: '#378bba', exts: ['.fs', '.fsx'] },
    // ── Systems ───────────────────────────────────────────────────────────────
    { shape: '●', label: '.rs', color: '#f97316', exts: ['.rs'] },
    { shape: '●', label: '.zig', color: '#f6a21e', exts: ['.zig'] },
    // ── Scripting ─────────────────────────────────────────────────────────────
    { shape: '●', label: '.rb', color: '#cc342d', exts: ['.rb'] },
    { shape: '●', label: '.php', color: '#8892bf', exts: ['.php'] },
    { shape: '●', label: '.pl', color: '#39457e', exts: ['.pl', '.pm'] },
    { shape: '●', label: '.lua', color: '#000080', exts: ['.lua'] },
    { shape: '◐', label: '.sh', color: '#4eaa25', exts: ['.sh', '.bash', '.zsh'] },
    { shape: '◧', label: '.ps1', color: '#012456', exts: ['.ps1', '.psm1', '.psd1'] },
    // ── Functional ────────────────────────────────────────────────────────────
    { shape: '●', label: '.ex', color: '#6e4a7e', exts: ['.ex', '.exs'] },
    { shape: '●', label: '.erl', color: '#a90533', exts: ['.erl', '.hrl'] },
    { shape: '●', label: '.hs', color: '#5e5086', exts: ['.hs'] },
    // ── Data / Schema ─────────────────────────────────────────────────────────
    { shape: '◐', label: '.sql', color: '#dad8d8', exts: ['.sql'] },
    { shape: '◐', label: '.proto', color: '#4285f4', exts: ['.proto'] },
    { shape: '◐', label: '.graphql', color: '#e10098', exts: ['.graphql', '.gql'] },
    { shape: '◐', label: '.yaml', color: '#cc3e44', exts: ['.yaml', '.yml'] },
    { shape: '◐', label: '.toml', color: '#9c4221', exts: ['.toml'] },
    // ── Web ───────────────────────────────────────────────────────────────────
    { shape: '◧', label: '.html', color: '#e44d26', exts: ['.html', '.htm', '.xhtml'] },
];

