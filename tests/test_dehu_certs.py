import json
from pathlib import Path

import pytest

from cert_manager import dehu_certs


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    """Aísla el fichero de certificados en una carpeta temporal."""
    monkeypatch.setattr(dehu_certs, '_CERTS_FILE', tmp_path / 'dehu_certs.json')
    yield


def test_load_empty_when_no_file():
    data = dehu_certs.load()
    assert data == {'active': 0, 'certs': []}


def test_add_cert_becomes_active():
    dehu_certs.add('Mi DNI', 'C:/certs/dni.pfx', '1234')
    dehu_certs.add('Empresa', 'C:/certs/empresa.p12', 'abcd')
    data = dehu_certs.load()
    assert len(data['certs']) == 2
    assert data['active'] == 1  # el último añadido es el activo
    assert dehu_certs.get_active()['name'] == 'Empresa'


def test_add_strips_quotes_from_path():
    dehu_certs.add('Test', '"C:/certs/x.pfx"', 'pw')
    assert dehu_certs.get_active()['path'] == 'C:/certs/x.pfx'


def test_add_duplicate_path_updates_instead_of_appending():
    dehu_certs.add('Original', 'C:/certs/dni.pfx', '1234')
    dehu_certs.add('Renombrado', 'C:/certs/dni.pfx', '5678')
    data = dehu_certs.load()
    assert len(data['certs']) == 1
    assert data['certs'][0]['name'] == 'Renombrado'
    assert data['certs'][0]['password'] == '5678'


def test_set_active_changes_returned_cert():
    dehu_certs.add('A', 'C:/a.pfx', '')
    dehu_certs.add('B', 'C:/b.pfx', '')
    dehu_certs.set_active(0)
    assert dehu_certs.get_active()['name'] == 'A'


def test_remove_adjusts_active_index():
    dehu_certs.add('A', 'C:/a.pfx', '')
    dehu_certs.add('B', 'C:/b.pfx', '')
    dehu_certs.add('C', 'C:/c.pfx', '')  # active = 2
    dehu_certs.remove(2)
    data = dehu_certs.load()
    assert len(data['certs']) == 2
    assert data['active'] == 1  # se ajusta para no salirse del rango


def test_get_active_none_when_empty():
    assert dehu_certs.get_active() is None


def test_migrate_from_config_imports_existing():
    cfg = {'dehu': {'cert_pfx_path': 'C:/certs/legacy.pfx', 'cert_password': 'pw'}}
    data = dehu_certs.migrate_from_config(cfg)
    assert len(data['certs']) == 1
    assert data['certs'][0]['path'] == 'C:/certs/legacy.pfx'


def test_migrate_does_not_duplicate_when_certs_exist():
    dehu_certs.add('Existente', 'C:/x.pfx', '')
    cfg = {'dehu': {'cert_pfx_path': 'C:/certs/legacy.pfx', 'cert_password': 'pw'}}
    data = dehu_certs.migrate_from_config(cfg)
    assert len(data['certs']) == 1  # no migra si ya hay certificados
    assert data['certs'][0]['name'] == 'Existente'
