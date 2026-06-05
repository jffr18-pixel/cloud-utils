import csv
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

_STATUS_COLORS = {
    'valid': '#28a745',
    'expiring_soon': '#e67e22',
    'expired': '#dc3545',
    'unknown': '#6c757d',
}


def generate_html(
    certs: List[Dict],
    output_path: Path,
    dehu_status: Dict = None,
) -> Path:
    rows = ''
    for c in certs:
        color = _STATUS_COLORS.get(c.get('status', 'unknown'), '#6c757d')
        label = c.get('status_label', '?')
        days = c.get('days_remaining', '')
        if isinstance(days, int):
            days_str = 'CADUCADO' if days < 0 else f'{days} días'
        else:
            days_str = ''
        rows += (
            f'<tr>'
            f'<td>{c.get("subject","")}</td>'
            f'<td>{c.get("issuer","")}</td>'
            f'<td>{c.get("store","")}</td>'
            f'<td>{c.get("not_after","")[:10]}</td>'
            f'<td style="color:{color};font-weight:bold">{label}</td>'
            f'<td>{days_str}</td>'
            f'</tr>\n'
        )

    dehu_html = ''
    if dehu_status and 'error' not in dehu_status:
        n_new = len(dehu_status.get('new', []))
        total_notif = dehu_status.get('total', 0)
        new_color = '#dc3545' if n_new > 0 else '#28a745'
        dehu_html = f"""
  <h2>Estado DEHU</h2>
  <p>Total notificaciones: <strong>{total_notif}</strong> &nbsp;|&nbsp;
  Nuevas: <strong style="color:{new_color}">{n_new}</strong> &nbsp;|&nbsp;
  Última consulta: {dehu_status.get("checked_at","")[:19].replace("T"," ")}</p>"""

    html = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Informe — Certificados Digitales</title>
<style>
  body{{font-family:Arial,sans-serif;margin:0;background:#f0f4f8}}
  .container{{max-width:1200px;margin:2em auto;background:#fff;padding:2em;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.1)}}
  h1{{color:#0057a8;margin-top:0}}
  h2{{color:#0057a8;border-bottom:2px solid #0057a8;padding-bottom:.3em}}
  .summary{{display:flex;gap:1em;flex-wrap:wrap;margin:1.5em 0}}
  .card{{padding:1em 1.8em;border-radius:8px;color:#fff;text-align:center;min-width:110px}}
  .card h3{{margin:0;font-size:2.2em}}
  .card p{{margin:.3em 0 0;font-size:.85em;opacity:.9}}
  table{{border-collapse:collapse;width:100%}}
  th,td{{border:1px solid #dee2e6;padding:9px 12px;text-align:left}}
  th{{background:#0057a8;color:#fff}}
  tr:nth-child(even){{background:#f5f8ff}}
  tr:hover{{background:#dce8ff}}
  .footer{{color:#888;font-size:.85em;margin-top:1.5em}}
</style>
</head>
<body>
<div class="container">
  <h1>🔐 Informe de Certificados Digitales</h1>
  <p>Generado: <strong>{datetime.now().strftime("%d/%m/%Y %H:%M")}</strong></p>
  {_summary_cards(certs)}
  {dehu_html}
  <h2>Certificados</h2>
  <table>
    <thead>
      <tr><th>Titular</th><th>Emisor</th><th>Almacén</th><th>Caduca</th><th>Estado</th><th>Tiempo restante</th></tr>
    </thead>
    <tbody>{rows}</tbody>
  </table>
  <p class="footer">Gestor de Certificados Digitales — Windows 11</p>
</div>
</body>
</html>"""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding='utf-8')
    logger.info(f"Informe HTML generado: {output_path}")
    return output_path


def _summary_cards(certs: List[Dict]) -> str:
    total = len(certs)
    valid = sum(1 for c in certs if c.get('status') == 'valid')
    expiring = sum(1 for c in certs if c.get('status') == 'expiring_soon')
    expired = sum(1 for c in certs if c.get('status') == 'expired')
    return (
        '<div class="summary">'
        f'<div class="card" style="background:#0057a8"><h3>{total}</h3><p>Total</p></div>'
        f'<div class="card" style="background:#28a745"><h3>{valid}</h3><p>Válidos</p></div>'
        f'<div class="card" style="background:#e67e22"><h3>{expiring}</h3><p>Caducan pronto</p></div>'
        f'<div class="card" style="background:#dc3545"><h3>{expired}</h3><p>Caducados</p></div>'
        '</div>'
    )


def generate_json(certs: List[Dict], output_path: Path) -> Path:
    safe = [{k: v for k, v in c.items() if k != 'not_after_dt'} for c in certs]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(safe, ensure_ascii=False, indent=2), encoding='utf-8')
    logger.info(f"Informe JSON generado: {output_path}")
    return output_path


def generate_csv(certs: List[Dict], output_path: Path) -> Path:
    fields = ['subject', 'subject_org', 'issuer', 'store', 'not_before',
              'not_after', 'status', 'status_label', 'days_remaining', 'serial', 'is_spanish']
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(certs)
    logger.info(f"Informe CSV generado: {output_path}")
    return output_path
