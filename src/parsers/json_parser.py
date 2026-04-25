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
        
        # ── tsconfig.json project references ───────────────────────────────
        if 'references' in data and isinstance(data['references'], list):
            for ref in data['references']:
                if isinstance(ref, dict) and 'path' in ref:
                    imports.append(('reference', ref['path'], 0))
        
        # ── JSON Schema $ref references ────────────────────────────────────
        # Use regex to find all "$ref" values in the JSON source
        # This catches nested references that might not be at top level
        ref_pattern = re.compile(r'"\$ref"\s*:\s*"([^"]+)"')
        for match in ref_pattern.finditer(src):
            ref_path = match.group(1)
            # Skip internal references like "#/definitions/Something"
            if not ref_path.startswith('#'):
                imports.append(('reference', ref_path, 0))
        
        # ── Store package metadata ─────────────────────────────────────────
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
    
    # JSON files don't have functions or calls in the traditional sense
    funcdefs = []
    funccalls = []
    func_calls_by_func = {}
    symbol_defs = []
    
    return (imports, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
