import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from cert_manager import dehu_checker


SAMPLE_HTML = """
<html><body>
<table class="listado">
<thead><tr><th>Organismo</th><th>Asunto</th><th>Fecha</th><th>Estado</th></tr></thead>
<tbody>
  <tr>
    <td>Agencia Tributaria</td>
    <td><a href="/es/ciudadano/notificacion/1001">Liquidación IRPF 2025</a></td>
    <td>03/06/2026</td>
    <td>Pendiente</td>
  </tr>
  <tr>
    <td>Seguridad Social</td>
    <td><a href="/es/ciudadano/notificacion/1002">Resolución prestación</a></td>
    <td>01/06/2026</td>
    <td>Pendiente</td>
  </tr>
</tbody>
</table>
</body></html>
"""


def _make_session(html=SAMPLE_HTML, status=200):
    session = MagicMock()
    resp = MagicMock()
    resp.status_code = status
    resp.text = html
    resp.raise_for_status = MagicMock()
    session.get.return_value = resp
    return session


def test_check_returns_notifications(tmp_path):
    session = _make_session()
    result = dehu_checker.check(session, log_folder=tmp_path)

    assert result['total'] == 2
    assert len(result['new']) == 2
    assert result['new'][0]['organismo'] == 'Agencia Tributaria'
    assert result['new'][1]['id'] == '1002'


def test_check_detects_new_vs_seen(tmp_path):
    session = _make_session()
    # First call — all are new
    first = dehu_checker.check(session, log_folder=tmp_path)
    assert len(first['new']) == 2

    # Second call — none are new
    second = dehu_checker.check(session, log_folder=tmp_path)
    assert len(second['new']) == 0
    assert second['total'] == 2


def test_check_handles_http_error(tmp_path):
    session = MagicMock()
    session.get.side_effect = Exception("Connection refused")
    result = dehu_checker.check(session, log_folder=tmp_path)

    assert 'error' in result
    assert result['total'] == 0


def test_parse_inbox_extracts_all_rows():
    notifications = dehu_checker._parse_inbox(SAMPLE_HTML)
    assert len(notifications) == 2
    assert notifications[0]['fecha'] == '03/06/2026'
    assert notifications[1]['asunto'] == 'Resolución prestación'


def test_parse_inbox_empty_table():
    html = '<html><body><table class="listado"><tbody></tbody></table></body></html>'
    result = dehu_checker._parse_inbox(html)
    assert result == []


def test_daily_log_is_written(tmp_path):
    session = _make_session()
    dehu_checker.check(session, log_folder=tmp_path)
    logs = list(tmp_path.glob('dehu_20*.json'))
    assert len(logs) == 1
    data = json.loads(logs[0].read_text())
    assert data['total'] == 2
