"""Tests for AI provider config storage — secrets must not leak or get clobbered.

masked_config() is what /chat-config hands to the browser, and save_config() is
what the settings panel posts back. Both round-trip API keys, so both are worth
pinning down.
"""

import json

import pytest

from ai import vizbridge

_ENV_KEYS = ('ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY')


@pytest.fixture
def store(monkeypatch, tmp_path):
    """Redirect config + key storage into tmp_path and neutralise env overrides."""
    cfg_path = tmp_path / 'config.json'
    key_path = tmp_path / 'key' / 'ai_keys.json'
    key_path.parent.mkdir(parents=True)
    monkeypatch.setattr(vizbridge, '_CONFIG_PATH', cfg_path)
    monkeypatch.setattr(vizbridge, '_KEYS_PATH', key_path)
    monkeypatch.setattr(vizbridge, '_LEGACY_KEYS_PATH', tmp_path / 'legacy.json')
    for name in _ENV_KEYS:
        monkeypatch.delenv(name, raising=False)
    return cfg_path, key_path


SECRET = 'sk-ant-SUPERSECRETVALUE0123456789'


# ─── masking ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize('raw,expected', [
    ('', ''),
    ('short', '****'),
    ('12345678', '****'),
    ('sk-abcdefghijklmnop', 'sk-a****mnop'),
])
def test_mask_secret(raw, expected):
    assert vizbridge._mask_secret(raw) == expected


def test_masked_config_never_exposes_the_key(store):
    vizbridge.save_config({'anthropic_api_key': SECRET, 'provider': 'anthropic'})

    masked = vizbridge.masked_config()

    assert masked['anthropic_api_key'] != SECRET
    assert masked['anthropic_api_key_present'] is True
    # nothing anywhere in the payload may contain the raw key
    assert SECRET not in json.dumps(masked)


def test_masked_config_reports_absent_keys(store):
    masked = vizbridge.masked_config()

    assert masked['openai_api_key'] == ''
    assert masked['openai_api_key_present'] is False


# ─── save round-trip ──────────────────────────────────────────────────────────

def test_secrets_go_to_the_key_file_not_the_config(store):
    cfg_path, key_path = store

    vizbridge.save_config({'anthropic_api_key': SECRET, 'provider': 'anthropic'})

    assert SECRET not in cfg_path.read_text(encoding='utf-8')
    assert json.loads(key_path.read_text(encoding='utf-8'))['anthropic_api_key'] == SECRET


def test_resaving_a_masked_placeholder_keeps_the_real_key(store):
    _, key_path = store
    vizbridge.save_config({'anthropic_api_key': SECRET})

    # what the settings panel posts back when the user did not retype the key
    vizbridge.save_config({'anthropic_api_key': vizbridge._mask_secret(SECRET)})

    assert json.loads(key_path.read_text(encoding='utf-8'))['anthropic_api_key'] == SECRET


def test_blank_value_does_not_wipe_a_stored_key(store):
    _, key_path = store
    vizbridge.save_config({'anthropic_api_key': SECRET})

    vizbridge.save_config({'anthropic_api_key': '   '})

    assert json.loads(key_path.read_text(encoding='utf-8'))['anthropic_api_key'] == SECRET


def test_a_new_key_replaces_the_old_one(store):
    _, key_path = store
    vizbridge.save_config({'anthropic_api_key': SECRET})

    vizbridge.save_config({'anthropic_api_key': 'sk-ant-A-COMPLETELY-NEW-KEY-42'})

    stored = json.loads(key_path.read_text(encoding='utf-8'))['anthropic_api_key']
    assert stored == 'sk-ant-A-COMPLETELY-NEW-KEY-42'


def test_env_var_overrides_stored_key(store, monkeypatch):
    vizbridge.save_config({'anthropic_api_key': SECRET})
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'sk-ant-FROM-ENVIRONMENT')

    assert vizbridge.load_config()['anthropic_api_key'] == 'sk-ant-FROM-ENVIRONMENT'
