import json
from pathlib import Path
from unittest.mock import MagicMock, call

import pytest

from cert_manager import dehu_downloader


def _notif(nid, organismo='Agencia Tributaria', fecha='03/06/2026', leida=False):
    return {
        'id': nid,
        'organismo': organismo,
        'asunto': f'Notificación {nid}',
        'fecha': fecha,
        'estado': 'Pendiente',
        'url': f'/es/ciudadano/notificacion/{nid}',
        'leida': leida,
    }


def _mock_session_with_pdf():
    session = MagicMock()
    resp = MagicMock()
    resp.headers = {'content-type': 'application/pdf'}
    resp.content = b'%PDF-1.4 fake content'
    resp.raise_for_status = MagicMock()
    session.get.return_value = resp
    return session


def test_download_creates_pdf_file(tmp_path):
    session = _mock_session_with_pdf()
    notifications = [_notif('2001', leida=True)]

    result = dehu_downloader.download_notifications(
        session, notifications, tmp_path, safe_mode=False
    )

    assert len(result['downloaded']) == 1
    pdfs = list(tmp_path.rglob('*.pdf'))
    assert len(pdfs) == 1


def test_download_organizes_by_year_month_organismo(tmp_path):
    session = _mock_session_with_pdf()
    notifications = [_notif('2002', organismo='Seguridad Social', fecha='15/03/2026', leida=True)]

    dehu_downloader.download_notifications(
        session, notifications, tmp_path, safe_mode=False
    )

    pdfs = list(tmp_path.rglob('*.pdf'))
    assert len(pdfs) == 1
    parts = pdfs[0].parts
    assert '2026' in parts
    assert '03' in parts
    assert 'Seguridad_Social' in parts


def test_download_skips_already_downloaded(tmp_path):
    session = _mock_session_with_pdf()
    notifications = [_notif('2003', leida=True)]

    dehu_downloader.download_notifications(session, notifications, tmp_path, safe_mode=False)
    result2 = dehu_downloader.download_notifications(session, notifications, tmp_path, safe_mode=False)

    assert len(result2['downloaded']) == 0
    assert len(result2['skipped']) == 1


def test_safe_mode_calls_confirm_for_unread(tmp_path):
    session = _mock_session_with_pdf()
    notifications = [_notif('2004', leida=False)]
    confirm_calls = []

    def confirm(n):
        confirm_calls.append(n['id'])
        return True

    dehu_downloader.download_notifications(
        session, notifications, tmp_path, safe_mode=True, confirm_fn=confirm
    )

    assert '2004' in confirm_calls


def test_safe_mode_skips_when_confirm_returns_false(tmp_path):
    session = _mock_session_with_pdf()
    notifications = [_notif('2005', leida=False)]

    result = dehu_downloader.download_notifications(
        session, notifications, tmp_path,
        safe_mode=True, confirm_fn=lambda n: False
    )

    assert len(result['downloaded']) == 0
    assert '2005' in result['skipped']


def test_index_json_is_created(tmp_path):
    session = _mock_session_with_pdf()
    notifications = [_notif('2006', leida=True)]

    dehu_downloader.download_notifications(session, notifications, tmp_path, safe_mode=False)

    index_file = tmp_path / 'indice.json'
    assert index_file.exists()
    index = json.loads(index_file.read_text())
    assert '2006' in index['descargadas']


def test_html_index_is_created(tmp_path):
    session = _mock_session_with_pdf()
    notifications = [_notif('2007', leida=True)]

    dehu_downloader.download_notifications(session, notifications, tmp_path, safe_mode=False)

    html_file = tmp_path / 'indice.html'
    assert html_file.exists()
    content = html_file.read_text()
    assert 'Agencia Tributaria' in content


def test_build_dest_path_structure(tmp_path):
    notif = _notif('9999', organismo='Ministerio de Hacienda', fecha='05/06/2026')
    path = dehu_downloader._build_dest_path(tmp_path, notif)

    assert path.parts[-4] == '2026'
    assert path.parts[-3] == '06'
    assert 'Ministerio_de_Hacienda' in path.parts[-2]
    assert '9999' in path.name


def test_safe_filename_removes_invalid_chars():
    assert dehu_downloader._safe_filename('Archivo: <test>/nombre?') == 'Archivo_testnombre'
    assert dehu_downloader._safe_filename('') == 'sin_nombre'


def test_only_pending_skips_read_notifications(tmp_path):
    session = _mock_session_with_pdf()
    notifications = [_notif('3001', leida=True), _notif('3002', leida=False)]

    result = dehu_downloader.download_notifications(
        session, notifications, tmp_path,
        safe_mode=False, only_pending=True
    )

    assert len(result['downloaded']) == 1
    assert result['downloaded'][0]['id'] == '3002'
    assert '3001' in result['skipped']
