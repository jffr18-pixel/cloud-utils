import sys
from unittest.mock import MagicMock, patch

import pytest

from cert_manager import cert_scanner


def test_scan_returns_empty_on_non_windows():
    with patch.object(sys, 'platform', 'linux'):
        result = cert_scanner.scan(['MY'])
    assert result == []


def test_parse_certutil_output_extracts_fields():
    sample = """
================ Certificado 0 ================
Número de serie: 0102030405
Emisor: CN=AC FNMT Usuarios, OU=Ceres, O=FNMT-RCM, C=ES
Sujeto: CN=JUAN GARCIA LOPEZ, serialNumber=12345678A
No antes de: 01/01/2023 10:00
No después de: 01/01/2026 10:00
================ Certificado 1 ================
Número de serie: 0607080910
Emisor: CN=AC DNIE 004, OU=DNIE, O=DIRECCION GENERAL DE LA POLICIA, C=ES
Sujeto: CN=MARIA LOPEZ GARCIA, serialNumber=87654321B
No antes de: 01/06/2022 12:00
No después de: 01/06/2025 12:00
"""
    result = cert_scanner._parse_certutil_output(sample, 'MY')
    assert len(result) == 2
    assert 'FNMT-RCM' in result[0]['issuer']
    assert '12345678A' in result[0]['subject']


def test_parse_certutil_output_handles_empty():
    result = cert_scanner._parse_certutil_output('', 'MY')
    assert result == []


def test_delete_by_thumbprint_returns_false_on_non_windows():
    with patch.object(sys, 'platform', 'linux'):
        result = cert_scanner.delete_by_thumbprint('MY', 'AABBCC')
    assert result is False


def test_delete_by_thumbprint_normalizes_thumbprint():
    with patch('subprocess.run') as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        with patch.object(sys, 'platform', 'win32'):
            cert_scanner.delete_by_thumbprint('MY', 'aa bb cc')
        call_args = mock_run.call_args[0][0]
        assert 'AABBCC' in call_args


def test_scan_uses_certutil_fallback_when_wincertstore_unavailable():
    if sys.platform != 'win32':
        pytest.skip("Solo Windows")

    with patch('builtins.__import__', side_effect=ImportError):
        with patch.object(cert_scanner, '_from_certutil', return_value=[]) as mock_cu:
            cert_scanner.scan(['MY'])
            mock_cu.assert_called_once()


def _make_self_signed():
    from datetime import datetime, timedelta, timezone
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'TEST CERT')])
    now = datetime.now(timezone.utc)
    return (
        x509.CertificateBuilder()
        .subject_name(name).issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=365))
        .sign(key, hashes.SHA256())
    )


def test_thumbprint_is_sha1_40_hex_chars():
    """La huella debe ser SHA-1 (40 hex) aunque el cert esté firmado con SHA-256."""
    cert = _make_self_signed()
    d = cert_scanner._to_dict(cert, 'MY')
    assert len(d['thumbprint']) == 40
    int(d['thumbprint'], 16)  # debe ser hexadecimal válido


def test_thumbprint_matches_cryptography_sha1():
    from cryptography.hazmat.primitives import hashes
    cert = _make_self_signed()
    d = cert_scanner._to_dict(cert, 'MY')
    assert d['thumbprint'] == cert.fingerprint(hashes.SHA1()).hex()


def test_delete_ex_returns_false_on_non_windows():
    with patch.object(sys, 'platform', 'linux'):
        ok, msg = cert_scanner.delete_by_thumbprint_ex('MY', 'AABBCC')
    assert ok is False
    assert 'Windows' in msg


def test_delete_ex_empty_thumbprint():
    with patch.object(sys, 'platform', 'win32'):
        ok, msg = cert_scanner.delete_by_thumbprint_ex('MY', '   ')
    assert ok is False
    assert 'huella' in msg.lower()


def test_delete_ex_success_first_attempt():
    with patch.object(sys, 'platform', 'win32'):
        with patch('subprocess.run', return_value=MagicMock(returncode=0)) as m:
            ok, msg = cert_scanner.delete_by_thumbprint_ex('MY', 'aa:bb cc')
    assert ok is True
    # huella normalizada sin espacios ni dos puntos
    assert 'AABBCC' in m.call_args[0][0]


def test_is_admin_false_on_non_windows():
    with patch.object(sys, 'platform', 'linux'):
        assert cert_scanner.is_admin() is False
