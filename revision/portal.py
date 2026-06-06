"""Portal de estado para el cliente.

Genera un HTML standalone que el gestor puede enviar al cliente (como adjunto
o por WhatsApp) para que vea el estado de su expediente: documentos pendientes,
historial de seguimiento y proximas gestiones. No requiere servidor.
"""

import secrets
from datetime import date


def obtener_o_crear_token(eid):
    """Devuelve el token de portal de un expediente, generandolo si no existe."""
    from . import historial
    registro = historial.cargar(eid)
    if not registro:
        return None
    if not registro.get("portal_token"):
        registro["portal_token"] = secrets.token_urlsafe(12)
        historial._guardar_registro(registro)
    return registro["portal_token"]


def generar_html(registro, checklist, tramite_nombre):
    """Genera un HTML standalone del estado del expediente para el cliente."""
    solicitante = registro.get("solicitante") or "Cliente"
    fecha = registro.get("fecha", "")[:10]
    nie = registro.get("nie", "")
    num_exp = registro.get("numero_expediente", "")

    faltan = [c for c in checklist if c["estado"] == "falta"]
    caducados = [c for c in checklist if c["estado"] == "caducado"]
    revisar = [c for c in checklist if c["estado"] in ("con_incidencias", "proximo_a_caducar")]
    listo = not faltan and not caducados

    estado_color = "#2E7D32" if listo else "#C62828"
    estado_bg = "#EDFAED" if listo else "#FFF0F0"
    estado_txt = "&#x2705; Documentacion completa" if listo else "&#x26A0;&#xFE0F; Documentacion pendiente"

    def lista_items(items):
        if not items:
            return ""
        return "<ul>" + "".join(f"<li>{c['nombre']}</li>" for c in items) + "</ul>"

    seguimiento_html = ""
    for ev in reversed(registro.get("seguimiento", [])[-6:]):
        nota = f"<br><small>{ev['nota']}</small>" if ev.get("nota") else ""
        seguimiento_html += (
            f'<div class="tl"><div class="dot"></div>'
            f'<div><strong>{ev["fecha"]}</strong> &mdash; {ev["estado"]}{nota}</div></div>'
        )
    if not seguimiento_html:
        seguimiento_html = "<p class='dim'>Sin actualizaciones todavia.</p>"

    tareas_pend = [t for t in registro.get("tareas", []) if not t.get("hecha")][:5]
    tareas_html = "".join(
        f"<li>&#x1F4C5; <strong>{t['fecha']}</strong> &mdash; {t['descripcion']}</li>"
        for t in tareas_pend
    ) or "<li class='dim'>Sin gestiones pendientes.</li>"

    meta_parts = []
    if nie:
        meta_parts.append(f"NIE: <strong>{nie}</strong>")
    if num_exp:
        meta_parts.append(f"Expediente: <strong>{num_exp}</strong>")
    meta_parts.append(f"Revision: {fecha}")
    meta_html = " &nbsp;&middot;&nbsp; ".join(meta_parts)

    docs_html = ""
    if listo:
        docs_html = "<p style='color:#2E7D32'>Toda la documentacion esta en orden. Gracias.</p>"
    else:
        if faltan:
            docs_html += "<h3 class='sh red'>Documentos que faltan</h3>" + lista_items(faltan)
        if caducados:
            docs_html += "<h3 class='sh red'>Documentos caducados (renovar)</h3>" + lista_items(caducados)
        if revisar:
            docs_html += "<h3 class='sh ora'>Documentos a renovar pronto</h3>" + lista_items(revisar)

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Estado del tramite &mdash; {solicitante}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,'Segoe UI',Arial,sans-serif;background:#F5F2FA;
     color:#111;padding:16px;max-width:640px;margin:0 auto}}
.header{{background:#0D0B12;border-radius:16px;padding:20px 24px;margin-bottom:14px}}
.brand{{font-size:18px;font-weight:800;color:#fff}}
.brand-sub{{font-size:9px;color:#9373B2;letter-spacing:1.8px;text-transform:uppercase;margin-top:2px}}
.who{{color:#E0D9EF;font-size:14px;margin-top:10px}}
.card{{background:#fff;border-radius:14px;padding:18px 20px;margin-bottom:12px;
       box-shadow:0 2px 12px rgba(147,115,178,.09)}}
.meta{{font-size:11px;color:#888;margin-bottom:12px}}
.estado{{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;
         border-radius:30px;font-weight:700;font-size:15px;
         color:{estado_color};background:{estado_bg};border:2px solid {estado_color}}}
h2{{font-size:14px;font-weight:600;color:#1A1426;
    border-bottom:2px solid #E4DCF2;padding-bottom:6px;margin-bottom:12px}}
h3.sh{{font-size:12px;font-weight:600;margin:10px 0 4px}}
h3.red{{color:#C62828}}
h3.ora{{color:#E65100}}
ul{{list-style:none;padding:0}}
li{{padding:7px 0;border-bottom:1px solid #F5F2FA;font-size:14px}}
li:last-child{{border:none}}
p.dim,li.dim{{color:#888;font-size:13px}}
.tl{{display:flex;gap:12px;margin-bottom:10px;align-items:flex-start}}
.dot{{width:10px;height:10px;border-radius:50%;background:#9373B2;
      flex-shrink:0;margin-top:3px}}
.tl div{{font-size:13px;line-height:1.5}}
small{{color:#888}}
.footer{{text-align:center;font-size:11px;color:#bbb;margin-top:16px;padding-bottom:20px}}
</style>
</head>
<body>
<div class="header">
  <div class="brand">BUROCRACIA ZERO</div>
  <div class="brand-sub">Estado de tu tramite</div>
  <div class="who">&#x1F464; {solicitante} &nbsp;&middot;&nbsp; {tramite_nombre}</div>
</div>

<div class="card">
  <div class="meta">{meta_html}</div>
  <div class="estado">{estado_txt}</div>
</div>

<div class="card">
  <h2>&#x1F4CB; Documentacion</h2>
  {docs_html}
</div>

<div class="card">
  <h2>&#x1F4E1; Historial del tramite</h2>
  {seguimiento_html}
</div>

<div class="card">
  <h2>&#x1F4C5; Proximas gestiones</h2>
  <ul>{tareas_html}</ul>
</div>

<div class="footer">
  Generado por Burocracia Zero &middot; {date.today().isoformat()}<br>
  Documento informativo generado automaticamente.
</div>
</body>
</html>"""
