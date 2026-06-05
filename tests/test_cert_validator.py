from datetime import datetime, timezone, timedelta

import pytest

from cert_manager import cert_validator


def _make_cert(days_from_now: int, issuer: str = 'FNMT-RCM', store: str = 'MY') -> dict:
    now = datetime.now(timezone.utc)
    not_after = now + timedelta(days=days_from_now)
    return {
        'subject': 'Test User',
        'issuer': issuer,
        'store': store,
        'not_after': not_after.isoformat(),
        'not_after_dt': not_after,
        'serial': '0x01',
    }


def test_valid_cert_classified_correctly():
    certs = cert_validator.validate([_make_cert(100)])
    assert certs[0]['status'] == 'valid'
    assert certs[0]['days_remaining'] >= 99


def test_expiring_soon_cert():
    certs = cert_validator.validate([_make_cert(15)], alert_days=30)
    assert certs[0]['status'] == 'expiring_soon'


def test_expired_cert():
    certs = cert_validator.validate([_make_cert(-1)])
    assert certs[0]['status'] == 'expired'
    assert certs[0]['days_remaining'] < 0


def test_spanish_issuer_detected():
    certs = cert_validator.validate([_make_cert(100, issuer='FNMT-RCM')])
    assert certs[0]['is_spanish'] is True


def test_foreign_issuer_not_spanish():
    certs = cert_validator.validate([_make_cert(100, issuer='DigiCert Inc')])
    assert certs[0]['is_spanish'] is False


def test_filter_personal_returns_only_my_store():
    all_certs = [
        {**_make_cert(100), 'store': 'MY'},
        {**_make_cert(100), 'store': 'CA'},
    ]
    cert_validator.validate(all_certs)
    personal = cert_validator.filter_personal(all_certs)
    assert len(personal) == 1
    assert personal[0]['store'] == 'MY'


def test_filter_expiring():
    certs = [_make_cert(10), _make_cert(50), _make_cert(-5)]
    cert_validator.validate(certs, alert_days=30)
    expiring = cert_validator.filter_expiring(certs, days=30)
    assert len(expiring) == 1
    assert 9 <= expiring[0]['days_remaining'] <= 10


def test_filter_expired():
    certs = [_make_cert(10), _make_cert(-1), _make_cert(-30)]
    cert_validator.validate(certs)
    expired = cert_validator.filter_expired(certs)
    assert len(expired) == 2


def test_status_label_present():
    certs = cert_validator.validate([_make_cert(100)])
    assert 'status_label' in certs[0]
    assert certs[0]['status_label'] == '✓ Válido'
