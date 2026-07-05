"""tests/test_md_parser.py — Markdown / text / reST parser (P2).

Validates the 6-tuple contract plus link/wikilink/heading extraction and the
precision guards (code blocks, inline code, external URLs, anchors).
"""
from parsers.md_parser import scan_markdown


def _targets(extra):
    return [h["target"] for h in (extra or {}).get("edge_hints", [])]


def test_six_tuple_contract():
    result = scan_markdown("# Hi\n[x](y.md)\n", ".md")
    assert isinstance(result, tuple) and len(result) == 6
    imports, funcdefs, funccalls, extra, fcbf, symdefs = result
    assert funcdefs == [] and funccalls == [] and fcbf == []
    assert isinstance(imports, list) and isinstance(symdefs, list)
    for sym in symdefs:
        for key in ("name", "kind", "line"):
            assert key in sym


def test_inline_links_and_images_extracted():
    src = "See [guide](docs/arch.md) and ![logo](img/logo.png).\n"
    _, _, _, extra, _, _ = scan_markdown(src, ".md")
    assert "docs/arch.md" in _targets(extra)
    assert "img/logo.png" in _targets(extra)


def test_wikilink_gets_md_extension():
    _, _, _, extra, _, _ = scan_markdown("Look at [[Glossary]].\n", ".md")
    assert "Glossary.md" in _targets(extra)


def test_wikilink_with_alias_and_anchor():
    _, _, _, extra, _, _ = scan_markdown("[[Page|nice name]] [[Other#sec]]\n", ".md")
    t = _targets(extra)
    assert "Page.md" in t and "Other.md" in t


def test_external_urls_and_anchors_ignored():
    src = "[site](https://example.com) [mail](mailto:a@b.c) [top](#section)\n"
    _, _, _, extra, _, _ = scan_markdown(src, ".md")
    assert _targets(extra) == []


def test_links_inside_code_block_ignored():
    src = (
        "Real [link](real.md).\n\n"
        "```python\n"
        "x = '[fake](should/not/count.py)'\n"
        "```\n"
        "Inline `[also fake](nope.md)` here.\n"
    )
    _, _, _, extra, _, _ = scan_markdown(src, ".md")
    t = _targets(extra)
    assert "real.md" in t
    assert "should/not/count.py" not in t
    assert "nope.md" not in t


def test_headings_become_symbol_defs():
    src = "# Title\n## Sub A\n### Deep\n"
    _, _, _, _, _, symdefs = scan_markdown(src, ".md")
    names = [s["name"] for s in symdefs if s["kind"] == "heading"]
    assert names == ["Title", "Sub A", "Deep"]
    # heading depth carried in complexity
    depths = {s["name"]: s["complexity"] for s in symdefs}
    assert depths["Title"] == 1 and depths["Deep"] == 3


def test_reference_style_definition():
    src = "Some [text][ref].\n\n[ref]: target/page.md\n"
    _, _, _, extra, _, _ = scan_markdown(src, ".md")
    assert "target/page.md" in _targets(extra)


def test_rst_doc_and_include():
    src = ":doc:`the guide <guide>`\n\n.. include:: shared/intro.rst\n"
    _, _, _, extra, _, _ = scan_markdown(src, ".rst")
    t = _targets(extra)
    assert "guide.rst" in t          # extensionless :doc: ref resolves to .rst
    assert "shared/intro.rst" in t


def test_txt_extracts_links_but_no_headings():
    src = "# not a heading in txt\nSee notes/todo.md for details.\n"
    _, _, _, extra, _, symdefs = scan_markdown(src, ".txt")
    assert symdefs == []  # headings only for markup, not plain text


def test_empty_source_does_not_crash():
    result = scan_markdown("", ".md")
    assert len(result) == 6
    assert result[0] == [] and result[5] == []
