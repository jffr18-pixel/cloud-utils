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


def test_scan_uses_certutil_fallback_when_wincertstore_unavailable():
    if sys.platform != 'win32':
        pytest.skip("Solo Windows")

    with patch('builtins.__import__', side_effect=ImportError):
        with patch.object(cert_scanner, '_from_certutil', return_value=[]) as mock_cu:
            cert_scanner.scan(['MY'])
            mock_cu.assert_called_once()
