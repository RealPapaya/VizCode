"""Smoke tests for HTML asset assembly."""

from html_builder import build_html


def test_build_html_inlines_split_overlay_css(tmp_path):
    html = build_html({
        'stats': {'root': str(tmp_path)},
        'project_type': {},
    })

    assert 'DASHBOARD OVERLAY' in html
    assert 'dashboard_drag_additions.css' in html
    assert 'viz_overlays.css has been split' not in html
