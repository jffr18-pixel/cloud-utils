from datetime import datetime, timezone
from typing import List, Dict, Any

SPANISH_ISSUERS = {
    'FNMT-RCM', 'FNMT', 'AC DNIE', 'DNIE', 'ACCV', 'CAMERFIRMA',
    'IZENPE', 'ANF AC', 'ANF', 'CATCERT', 'FIRMAPROFESIONAL',
}

STATUS_LABELS = {
    'valid': '✓ Válido',
    'expiring_soon': '⚠ Caduca pronto',
    'expired': '✗ Caducado',
    'unknown': '? Desconocido',
}


def validate(certs: List[Dict[str, Any]], alert_days: int = 30) -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    for cert in certs:
        cert['days_remaining'] = _days_remaining(cert, now)
        cert['status'] = _classify(cert['days_remaining'], alert_days)
        cert['status_label'] = STATUS_LABELS[cert['status']]
        cert['is_spanish'] = _is_spanish(cert)
    return certs


def filter_personal(certs: List[Dict]) -> List[Dict]:
    return [c for c in certs if c.get('store') == 'MY']


def filter_expiring(certs: List[Dict], days: int = 30) -> List[Dict]:
    return [c for c in certs if 0 <= c.get('days_remaining', -1) <= days]


def filter_expired(certs: List[Dict]) -> List[Dict]:
    return [c for c in certs if c.get('days_remaining', 0) < 0]


def _classify(days: int, alert_days: int) -> str:
    if days < 0:
        return 'expired'
    if days <= alert_days:
        return 'expiring_soon'
    return 'valid'


def _days_remaining(cert: Dict, now: datetime) -> int:
    not_after = cert.get('not_after_dt')
    if not_after is None:
        return -999
    return (not_after - now).days


def _is_spanish(cert: Dict) -> bool:
    issuer = (cert.get('issuer', '') + ' ' + cert.get('issuer_cn', '')).upper()
    return any(k.upper() in issuer for k in SPANISH_ISSUERS)
