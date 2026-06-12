"""Smoke tests for HTML asset assembly."""

import json
from html.parser import HTMLParser

from html_builder import build_html, json_for_html_script


class _VizDataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_viz_data = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        self.in_viz_data = tag == 'script' and dict(attrs).get('id') == 'viz-data'

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_viz_data = False

    def handle_data(self, data):
        if self.in_viz_data:
            self.parts.append(data)


def test_build_html_inlines_split_overlay_css(tmp_path):
    html = build_html({
        'stats': {'root': str(tmp_path)},
        'project_type': {},
    })

    assert 'DASHBOARD OVERLAY' in html
    assert 'dashboard_drag_additions.css' in html
    assert 'viz_overlays.css has been split' not in html


def test_json_for_html_script_round_trips_script_terminators():
    data = {
        'source': '</script><script>alert("unsafe")</script>',
        'operators': '<>&',
        'line_separators': '\u2028\u2029',
    }

    encoded = json_for_html_script(data, ensure_ascii=False, separators=(',', ':'))

    assert '</script>' not in encoded.lower()
    assert json.loads(encoded) == data


def test_build_html_keeps_viz_data_intact_when_source_contains_script_terminator(tmp_path):
    data = {
        'stats': {'root': str(tmp_path)},
        'project_type': {},
        'security_findings': [{
            'code': 'const closingTag = "</script>";',
            'desc': 'This must remain inside the JSON payload.',
        }],
    }

    html = build_html(data)
    parser = _VizDataParser()
    parser.feed(html)
    parsed = json.loads(''.join(parser.parts))

    assert parsed == data
