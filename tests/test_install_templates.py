"""Regression net for ai/ install assets (a null-byte mcp_template.json once shipped)."""
import importlib.util
import json
from pathlib import Path

AI = Path(__file__).resolve().parent.parent / "ai"


def _load_install():
    spec = importlib.util.spec_from_file_location("vizcode_install", AI / "install.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_mcp_template_renders_to_valid_json():
    raw = (AI / "mcp_template.json").read_text(encoding="utf-8")
    rendered = raw.replace("{VIZCODE_ROOT}", "C:/somewhere/VizCode")
    cfg = json.loads(rendered)
    args = cfg["mcpServers"]["vizcode"]["args"]
    assert any("mcp_server.py" in a for a in args)
    assert not any("{VIZCODE_ROOT}" in a for a in args)


def test_platform_header_templates_exist():
    mod = _load_install()
    for name, cfg in mod.PLATFORMS.items():
        assert (AI / cfg["header"]).is_file(), f"missing header template for {name}"
