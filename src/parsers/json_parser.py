#!/usr/bin/env python3
"""
parsers/json_parser.py — VIZCODE JSON Configuration File Parser

Extracts dependencies from JSON configuration files:
  - package.json: dependencies, devDependencies
  - tsconfig.json: extends, references
  - JSON Schema: $ref references
  - Generic JSON: any "$ref" or "extends" fields

Returns the standard VIZCODE parser 6-tuple:
  (imports, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
"""

import re
import json as json_lib

_JSON_CONFIG_KEYS = {
    'file', 'schema', 'schemaFile', 'config', 'configFile', 'template',
    'templateFile', 'values', 'valuesFile',
}


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _line_for_value(src: str, value: str) -> int:
    idx = src.find(json_lib.dumps(value))
    return _line_no(src, idx) if idx >= 0 else 0


def _local_config_ref(value: str):
    ref = (value or '').strip()
    if not ref or ref.startswith('#'):
        return None
    ref = ref.split('#', 1)[0].strip()
    if not ref:
        return None
    low = ref.lower()
    if low.startswith(('http://', 'https://', '//')):
        return None
    if ref.startswith('@') and not ref.startswith(('@/', '@\\')):
        return None
    if (
        ref.startswith(('.', '/', '\\'))
        or '/' in ref
        or '\\' in ref
        or low.endswith(('.json', '.yaml', '.yml', '.toml', '.xml', '.conf', '.cfg', '.ini', '.html', '.htm', '.txt', '.md'))
    ):
        return ref
    return None


def _hint(target: str, via: str, line: int, subtype: str = 'json') -> dict:
    hint = {
        'type': 'config_ref',
        'target': target,
        'subtype': subtype,
        'via': via,
        'confidence': 1.0,
    }
    if line:
        hint['line'] = line
    return hint


def _walk_config_refs(value, path=''):
    refs = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f'{path}.{key}' if path else key
            if isinstance(child, str):
                if key in _JSON_CONFIG_KEYS:
                    ref = _local_config_ref(child)
                    if ref:
                        refs.append((ref, child_path, child))
            else:
                refs.extend(_walk_config_refs(child, child_path))
    elif isinstance(value, list):
        for child in value:
            refs.extend(_walk_config_refs(child, path))
    return refs


def scan_json(src, ext):
    """
    Parse JSON configuration files and extract dependency references.
    
    Args:
        src: File content as string
        ext: File extension (always '.json')
    
    Returns:
        Tuple: (imports, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
    """
    imports = []
    extra_dict = {}
    edge_hints = []
    
    try:
        data = json_lib.loads(src)
        
        # ── package.json dependencies ──────────────────────────────────────
        if 'dependencies' in data and isinstance(data['dependencies'], dict):
            for pkg_name in data['dependencies'].keys():
                imports.append(('dependency', pkg_name, 0))
        
        if 'devDependencies' in data and isinstance(data['devDependencies'], dict):
            for pkg_name in data['devDependencies'].keys():
                imports.append(('dev_dependency', pkg_name, 0))
        
        if 'peerDependencies' in data and isinstance(data['peerDependencies'], dict):
            for pkg_name in data['peerDependencies'].keys():
                imports.append(('peer_dependency', pkg_name, 0))
        
        # ── tsconfig.json extends ──────────────────────────────────────────
        if 'extends' in data and isinstance(data['extends'], str):
            imports.append(('extends', data['extends'], 0))
            ref = _local_config_ref(data['extends'])
            if ref:
                edge_hints.append(_hint(ref, 'extends', _line_for_value(src, data['extends'])))
        
        # ── tsconfig.json project references ───────────────────────────────
        if 'references' in data and isinstance(data['references'], list):
            for ref in data['references']:
                if isinstance(ref, dict) and 'path' in ref:
                    imports.append(('reference', ref['path'], 0))
                    target = _local_config_ref(ref['path'])
                    if target:
                        edge_hints.append(_hint(target, 'references.path', _line_for_value(src, ref['path'])))
        
        # ── JSON Schema $ref references ────────────────────────────────────
        # Use regex to find all "$ref" values in the JSON source
        # This catches nested references that might not be at top level
        ref_pattern = re.compile(r'"\$ref"\s*:\s*"([^"]+)"')
        for match in ref_pattern.finditer(src):
            ref_path = match.group(1)
            # Skip internal references like "#/definitions/Something"
            if not ref_path.startswith('#'):
                imports.append(('reference', ref_path, 0))
                target = _local_config_ref(ref_path)
                if target:
                    edge_hints.append(_hint(target, '$ref', _line_no(src, match.start()), 'schema'))
        
        # ── Store package metadata ─────────────────────────────────────────
        for target, via, raw_value in _walk_config_refs(data):
            edge_hints.append(_hint(target, via, _line_for_value(src, raw_value)))

        if 'name' in data:
            extra_dict['package_name'] = data['name']
        if 'version' in data:
            extra_dict['package_version'] = data['version']
        if 'description' in data:
            extra_dict['description'] = data['description']
            
    except json_lib.JSONDecodeError as e:
        # Invalid JSON — store error in extra_dict
        extra_dict['json_error'] = str(e)
    except Exception:
        # Any other parsing error — silently ignore
        pass
    
    if edge_hints:
        deduped = {}
        for hint in edge_hints:
            deduped[(hint['target'], hint['via'], hint.get('line', 0))] = hint
        extra_dict['edge_hints'] = list(deduped.values())

    # JSON files don't have functions or calls in the traditional sense
    funcdefs = []
    funccalls = []
    func_calls_by_func = {}
    symbol_defs = []
    
    return (imports, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
