// data.d.ts — backend -> frontend JSON contract (the shape of `window.DATA`).
//
// Ambient declarations (NO import/export) so these types are visible globally to
// every script-style .ts file, mirroring the runtime where all files share one
// scope. Field shapes are sourced from src/core/analyze_viz.py (build_graph).
//
// When the Python side changes a field, update it here — type-checked .ts consumers
// then flag every stale access at `npm run check`.

// ─── Graph nodes / edges ──────────────────────────────────────────────────────

interface Module {
  id: string;
  label: string;
  color: string;
  file_count: number;
  func_count: number;
  other_count: number;
}

interface ModuleEdge {
  s: string;            // source module id
  t: string;            // target module id
  weight: number;       // number of file-level dependencies
  kind: string;         // 'import' at module level
}

interface Loc {
  code: number;
  comment: number;
  blank: number;
}

interface FileNode {
  id: number;           // unique file id (rel_to_id mapping)
  label: string;        // basename
  path: string;         // relative path from project root
  ext: string;
  size: number;         // bytes
  loc: Loc;
  func_count: number;
  file_type: string;    // from FILE_TYPE_MAP
  bios_meta: Record<string, unknown>;  // UEFI/firmware metadata; {} otherwise
}

interface FileEdge {
  s: number;            // source file id
  t: number;            // target file id
  type: string;         // EDGE_TYPES key
  via?: string;         // mediating symbol (JS global-script case)
  subtype?: string;
  origin?: string;      // 'parser' | …
  confidence?: number;  // 0..1
  line?: number;
  reason?: string;      // AI-inferred edges (semantic_cache) carry an explanation
}

interface Func {
  id: number;           // index within its file
  label: string;        // function name
  is_public: boolean;
  is_efiapi: boolean;
  doc?: string;
  // Stats/dashboard-derived func-like objects (longest_functions,
  // complexity_top_offenders, etc.) reuse this shape with these extra fields:
  name?: string;
  line?: number;
  end_line?: number;
  lines?: number;
  complexity?: number;
}

interface FuncEdge {
  s: number;            // source func id (within file)
  t: number;            // target func id (within file)
  p: number;            // 1 if source is_static else 0
  type: string;         // 'call'
}

interface SymbolNode {
  id: string;           // 'sym_{file_idx}_{symbol_idx}'
  name: string;
  kind: string;         // 'function' | 'class' | 'method' | 'interface' | …
  file: string;         // relative path
  line: number;
  end_line: number;
  bases: string[];
  parent: string;
  is_public: boolean;
  signature: string;
  docstring: string;
  decorators: string[];
  is_static: boolean;
  complexity?: number;
  type_refs?: string[];
  symbol_edge_hints?: Record<string, unknown>[];
  parse_error?: string;
}

interface SymbolEdge {
  from: string;         // source symbol id
  to: string;           // target symbol id
  type: string;         // 'call' | 'inheritance' | 'implements' | 'type_usage' | …
  kind: string;         // normalized: 'call' | 'inherit' | 'type_usage' | 'member'
  via?: string;
  line?: number;
  confidence?: number;
}

interface EdgeTypeDef {
  label: string;
  color: string;
  style: string;        // 'solid' | 'dashed' | 'dotted'
  kind: string;
}

// ─── Stats (Dashboard / header) ───────────────────────────────────────────────
// High-traffic fields typed; the long health/git/analytics tail is left open via
// the index signature and can be tightened as those widgets are converted.

interface Stats {
  files: number;
  modules: number;
  functions: number;
  calls: number;

  other_files?: number;
  binary_files?: number;
  total_visible_files?: number;
  total_all_files?: number;
  total_dirs?: number;
  skipped_files?: number;
  type_counts?: Record<string, number>;
  root?: string;
  project_type?: Record<string, string>;
  language_distribution?: Record<string, number>;

  loc_total?: number;
  loc_code?: number;
  loc_comment?: number;
  loc_blank?: number;
  avg_complexity?: number;
  code_health_score?: number;

  has_git_history?: boolean;

  // Long tail of health/git/analytics fields is `any` during migration so the
  // many dashboard widgets reading stats.<field> don't each need a cast.
  [key: string]: any;
}

// ─── Top-level payload (window.DATA) ──────────────────────────────────────────

interface VizData {
  modules: Module[];
  module_edges: ModuleEdge[];
  files_by_module: Record<string, FileNode[]>;
  file_edges_by_module: Record<string, FileEdge[]>;
  other_files_by_module: Record<string, FileNode[]>;
  funcs_by_file: Record<string, Func[]>;
  func_edges_by_file: Record<string, FuncEdge[]>;
  func_calls_by_file: Record<string, string[][]>;
  func_name_to_file: Record<string, string>;
  func_name_to_files: Record<string, string[]>;
  func_name_ambiguous: string[];
  file_to_module: Record<string, string>;
  func_known_categories: Record<string, string>;
  edge_types: Record<string, EdgeTypeDef>;
  project_type: Record<string, string>;
  symbol_index: Record<string, SymbolNode>;
  symbol_edges: SymbolEdge[];
  communities: Record<string, number>;
  community_stats: Record<string, unknown>[];
  file_community: Record<string, number>;
  meta: Record<string, unknown>;
  stats: Stats;
  // Untyped extras (job_id, precompute payloads, etc.) are `any` during migration.
  [key: string]: any;
}

// Bare-global accesses (injected JSON / page globals).
declare var DATA: VizData;
declare var JOB_ID: string;
