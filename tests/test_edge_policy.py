import json
import sys
from unittest.mock import patch

from cert_manager import edge_policy


def test_build_entry_empty_filter():
    s = edge_policy.build_entry('https://[*.]seg-social.gob.es')
    obj = json.loads(s)
    assert obj['pattern'] == 'https://[*.]seg-social.gob.es'
    assert obj['filter'] == {}


def test_build_entry_with_subject_cn():
    s = edge_policy.build_entry('https://x', subject_cn='JUAN PEREZ')
    obj = json.loads(s)
    assert obj['filter']['SUBJECT']['CN'] == 'JUAN PEREZ'
    assert 'ISSUER' not in obj['filter']


def test_build_entry_with_issuer_and_subject():
    s = edge_policy.build_entry('https://x', subject_cn='JUAN', issuer_cn='FNMT')
    obj = json.loads(s)
    assert obj['filter']['SUBJECT']['CN'] == 'JUAN'
    assert obj['filter']['ISSUER']['CN'] == 'FNMT'


def test_gov_patterns_cover_expected_domains():
    joined = ' '.join(edge_policy.GOV_PATTERNS)
    assert 'seg-social.gob.es' in joined
    assert 'agenciatributaria.gob.es' in joined
    assert 'clave.gob.es' in joined


def test_is_supported_false_on_non_windows():
    with patch.object(sys, 'platform', 'linux'):
        assert edge_policy.is_supported() is False


def test_enable_returns_error_on_non_windows():
    with patch.object(sys, 'platform', 'linux'):
        result = edge_policy.enable()
    assert result['ok'] is False


def test_is_enabled_false_on_non_windows():
    with patch.object(sys, 'platform', 'linux'):
        assert edge_policy.is_enabled() is False


def test_build_entry_is_valid_json_with_accents():
    # Asegura que ensure_ascii=False no rompe el parseo
    s = edge_policy.build_entry('https://x', subject_cn='JOSÉ FERNÁNDEZ')
    obj = json.loads(s)
    assert obj['filter']['SUBJECT']['CN'] == 'JOSÉ FERNÁNDEZ'
