"""Interfaz grafica para la revision de expedientes de extranjeria.

Ejecutar con:
    streamlit run app.py
"""

import base64
import os
import re
from datetime import date

import anthropic
import pandas as pd
import streamlit as st

from revision import (
    analizador,
    comunicacion,
    config,
    ficha,
    historial,
    informe,
    tramites,
)

st.set_page_config(
    page_title="Burocracia Zero · Extranjeria",
    page_icon="⚖️",
    layout="wide",
)

# --------------------------------------------------------------------------- #
#  Burocracia Zero — CSS global
# --------------------------------------------------------------------------- #
_CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap');

html, body, [class*="css"] {
    font-family: 'Inter', sans-serif !important;
}

/* ── SIDEBAR ──────────────────────────────────────────────── */
[data-testid="stSidebar"] {
    background-color: #0D0B12 !important;
    border-right: 1px solid #2A243A !important;
}
[data-testid="stSidebar"] > div:first-child {
    padding-top: 1.2rem;
}
[data-testid="stSidebar"] * {
    color: #E0D9EF !important;
}
[data-testid="stSidebar"] hr {
    border-color: #2A243A !important;
}
[data-testid="stSidebar"] .stSelectbox label,
[data-testid="stSidebar"] .stTextInput label,
[data-testid="stSidebar"] .stNumberInput label,
[data-testid="stSidebar"] .stCaption,
[data-testid="stSidebar"] small {
    color: #8A7FA8 !important;
    font-size: 0.78rem !important;
}
[data-testid="stSidebar"] [data-baseweb="select"] > div {
    background-color: #18132A !important;
    border-color: #3A2F56 !important;
    border-radius: 8px !important;
    color: #E0D9EF !important;
}
[data-testid="stSidebar"] [data-baseweb="input"] > div {
    background-color: #18132A !important;
    border-color: #3A2F56 !important;
    border-radius: 8px !important;
}
[data-testid="stSidebar"] [data-baseweb="input"] input {
    color: #E0D9EF !important;
}
/* Nav radio */
[data-testid="stSidebar"] .stRadio > div {
    gap: 2px;
}
[data-testid="stSidebar"] .stRadio label {
    display: block !important;
    padding: 8px 14px !important;
    border-radius: 8px !important;
    color: #C4BAD8 !important;
    font-size: 0.88rem !important;
    font-weight: 400 !important;
    cursor: pointer !important;
    transition: background 0.15s, color 0.15s !important;
}
[data-testid="stSidebar"] .stRadio label:hover {
    background-color: #231A38 !important;
    color: #FFFFFF !important;
}
[data-testid="stSidebar"] .stRadio [aria-checked="true"] + label,
[data-testid="stSidebar"] .stRadio label:has(input:checked) {
    background-color: #9373B2 !important;
    color: #FFFFFF !important;
    font-weight: 600 !important;
}
/* Success/info chips in sidebar */
[data-testid="stSidebar"] [data-testid="stAlert"] {
    background-color: #18132A !important;
    border-left-color: #9373B2 !important;
}
[data-testid="stSidebar"] [data-testid="stAlert"] * {
    color: #C4BAD8 !important;
}

/* ── MAIN LAYOUT ──────────────────────────────────────────── */
.main .block-container {
    padding-top: 2rem !important;
    padding-bottom: 3rem !important;
    max-width: 1200px !important;
}

/* ── HEADINGS ─────────────────────────────────────────────── */
h1 {
    font-size: 1.75rem !important;
    font-weight: 700 !important;
    color: #0D0B12 !important;
    padding-bottom: 0.4rem !important;
    border-bottom: 3px solid #9373B2 !important;
    margin-bottom: 1.2rem !important;
}
h2, h3 {
    font-weight: 600 !important;
    color: #1A1426 !important;
}

/* ── PRIMARY BUTTONS ──────────────────────────────────────── */
button[kind="primary"],
.stButton > button[data-testid*="primary"],
.stButton > button[kind="primary"] {
    background: #9373B2 !important;
    color: #FFFFFF !important;
    border: none !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
    font-size: 0.88rem !important;
    padding: 0.5rem 1.4rem !important;
    box-shadow: 0 2px 8px rgba(147,115,178,0.30) !important;
    transition: all 0.18s !important;
}
.stButton > button[kind="primary"]:hover {
    background: #7D5F9E !important;
    box-shadow: 0 4px 14px rgba(147,115,178,0.45) !important;
    transform: translateY(-1px) !important;
}
/* Secondary / default buttons */
.stButton > button:not([kind="primary"]) {
    background: #FFFFFF !important;
    color: #9373B2 !important;
    border: 1.5px solid #9373B2 !important;
    border-radius: 8px !important;
    font-weight: 500 !important;
    font-size: 0.88rem !important;
    transition: all 0.18s !important;
}
.stButton > button:not([kind="primary"]):hover {
    background: #F5F2FA !important;
    border-color: #7D5F9E !important;
}

/* ── DOWNLOAD BUTTONS ─────────────────────────────────────── */
[data-testid="stDownloadButton"] > button {
    background: #FFEA63 !important;
    color: #0D0B12 !important;
    border: none !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
    font-size: 0.86rem !important;
    box-shadow: 0 2px 6px rgba(255,234,99,0.35) !important;
    transition: all 0.18s !important;
}
[data-testid="stDownloadButton"] > button:hover {
    background: #F5DE52 !important;
    box-shadow: 0 4px 12px rgba(255,234,99,0.5) !important;
    transform: translateY(-1px) !important;
}

/* ── FORM SUBMIT ──────────────────────────────────────────── */
[data-testid="stFormSubmitButton"] > button {
    background: #9373B2 !important;
    color: #FFFFFF !important;
    border: none !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
    box-shadow: 0 2px 8px rgba(147,115,178,0.30) !important;
    transition: all 0.18s !important;
}
[data-testid="stFormSubmitButton"] > button:hover {
    background: #7D5F9E !important;
}

/* ── METRICS ──────────────────────────────────────────────── */
[data-testid="stMetric"] {
    background: #FFFFFF !important;
    border: 1px solid #E4DCF2 !important;
    border-radius: 12px !important;
    padding: 1rem 1.4rem !important;
    box-shadow: 0 2px 10px rgba(147,115,178,0.08) !important;
}
[data-testid="stMetricLabel"] p {
    color: #6B5F82 !important;
    font-size: 0.75rem !important;
    text-transform: uppercase !important;
    letter-spacing: 0.6px !important;
    font-weight: 500 !important;
}
[data-testid="stMetricValue"] {
    color: #9373B2 !important;
    font-weight: 700 !important;
    font-size: 2rem !important;
}

/* ── EXPANDERS ────────────────────────────────────────────── */
[data-testid="stExpander"] {
    border: 1px solid #E4DCF2 !important;
    border-radius: 10px !important;
    margin-bottom: 6px !important;
    overflow: hidden !important;
    background: #FFFFFF !important;
}
[data-testid="stExpander"] details summary {
    padding: 10px 16px !important;
    background: #FAFAFA !important;
    font-weight: 500 !important;
}
[data-testid="stExpander"] details summary:hover {
    background: #F5F2FA !important;
}
[data-testid="stExpander"] details[open] summary {
    background: #F0EBF8 !important;
    color: #5E3A8C !important;
    border-bottom: 1px solid #E4DCF2 !important;
}

/* ── ALERTS ───────────────────────────────────────────────── */
[data-testid="stAlert"] {
    border-radius: 10px !important;
    border-left-width: 4px !important;
}
[data-testid="stAlert"][data-baseweb*="positive"],
div[class*="stSuccess"] {
    background-color: #EDFAED !important;
    border-left-color: #2E7D32 !important;
}
[data-testid="stAlert"][data-baseweb*="negative"],
div[class*="stError"] {
    background-color: #FFF0F0 !important;
    border-left-color: #C62828 !important;
}
[data-testid="stAlert"][data-baseweb*="warning"],
div[class*="stWarning"] {
    background-color: #FFFDE7 !important;
    border-left-color: #FFEA63 !important;
}
[data-testid="stAlert"][data-baseweb*="info"],
div[class*="stInfo"] {
    background-color: #F5F0FB !important;
    border-left-color: #9373B2 !important;
}

/* ── INPUTS ───────────────────────────────────────────────── */
[data-baseweb="input"] > div,
[data-baseweb="textarea"] > div {
    border-color: #D9D0EC !important;
    border-radius: 8px !important;
    transition: border-color 0.15s !important;
}
[data-baseweb="input"] > div:focus-within,
[data-baseweb="textarea"] > div:focus-within {
    border-color: #9373B2 !important;
    box-shadow: 0 0 0 2px rgba(147,115,178,0.18) !important;
}
[data-baseweb="select"] > div:first-child {
    border-color: #D9D0EC !important;
    border-radius: 8px !important;
}
[data-baseweb="select"] > div:first-child:focus-within {
    border-color: #9373B2 !important;
    box-shadow: 0 0 0 2px rgba(147,115,178,0.18) !important;
}

/* ── PROGRESS BAR ─────────────────────────────────────────── */
[data-testid="stProgress"] > div > div > div > div {
    background-color: #9373B2 !important;
}

/* ── DATAFRAME ────────────────────────────────────────────── */
[data-testid="stDataFrame"] {
    border-radius: 10px !important;
    overflow: hidden !important;
    border: 1px solid #E4DCF2 !important;
}

/* ── DATA EDITOR ──────────────────────────────────────────── */
[data-testid="stDataEditor"] {
    border-radius: 10px !important;
    overflow: hidden !important;
    border: 1px solid #E4DCF2 !important;
}

/* ── DIVIDER ──────────────────────────────────────────────── */
hr {
    border-color: #E4DCF2 !important;
    margin: 1.5rem 0 !important;
}

/* ── TABS ─────────────────────────────────────────────────── */
[data-baseweb="tab-list"] {
    border-bottom-color: #E4DCF2 !important;
}
[data-baseweb="tab"] {
    color: #6B5F82 !important;
    font-weight: 500 !important;
}
[data-baseweb="tab"][aria-selected="true"] {
    color: #9373B2 !important;
    border-bottom-color: #9373B2 !important;
    font-weight: 600 !important;
}

/* ── CHECKBOX / RADIO ─────────────────────────────────────── */
[data-testid="stCheckbox"] label {
    font-size: 0.88rem !important;
}

/* ── CAPTION / SMALL TEXT ─────────────────────────────────── */
.stCaption, small, [data-testid="stCaptionContainer"] {
    color: #6B5F82 !important;
    font-size: 0.78rem !important;
}

/* ── PAGE SUBTITLE STRIP ──────────────────────────────────── */
.bz-page-subtitle {
    color: #6B5F82;
    font-size: 0.875rem;
    margin-top: -0.8rem;
    margin-bottom: 1.5rem;
}

/* ── BADGE COLORS (checklist) ─────────────────────────────── */
.bz-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 0.76rem;
    font-weight: 600;
    line-height: 1.4;
}
.bz-ok   { background:#E8F5E9; color:#1B5E20; }
.bz-warn { background:#FFFDE7; color:#5D4037; border:1px solid #FFEA63; }
.bz-soon { background:#FFF3E0; color:#E65100; }
.bz-exp  { background:#FFEBEE; color:#B71C1C; }
.bz-miss { background:#FCE4EC; color:#880E4F; }
.bz-opt  { background:#F3F3F3; color:#555555; }
</style>
"""

MODELOS = {
    "Claude Opus 4.8 (maxima precision)": "claude-opus-4-8",
    "Claude Sonnet 4.6 (equilibrado, mas economico)": "claude-sonnet-4-6",
    "Claude Haiku 4.5 (rapido y barato)": "claude-haiku-4-5",
}

_BADGE = {
    "correcto": ("✅", "Correcto"),
    "con_incidencias": ("⚠️", "Revisar"),
    "proximo_a_caducar": ("🟠", "Caduca pronto"),
    "caducado": ("⛔", "Caducado"),
    "falta": ("❌", "Falta"),
    "falta_opcional": ("➖", "Falta (opcional)"),
}


def obtener_cliente(api_key):
    return anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()


def _slug(texto):
    texto = (texto or "").strip().lower()
    for a, b in {"á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n"}.items():
        texto = texto.replace(a, b)
    texto = re.sub(r"[^a-z0-9]+", "_", texto).strip("_")
    return texto or "tramite"


# --------------------------------------------------------------------------- #
#  Barra lateral: perfil + configuracion comun
# --------------------------------------------------------------------------- #
def barra_lateral():
    with st.sidebar:
        st.markdown(
            """
            <div style="padding:0 4px 12px 4px;">
              <div style="font-size:1.25rem;font-weight:800;color:#FFFFFF;
                          letter-spacing:-0.5px;line-height:1.1;">
                BUROCRACIA ZERO
              </div>
              <div style="font-size:0.7rem;font-weight:600;color:#9373B2;
                          letter-spacing:1.5px;text-transform:uppercase;
                          margin-top:2px;">
                Revision de Extranjeria
              </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        # Perfil de trabajo (cada uno con sus tramites, gestoria e historial)
        perfiles = config.listar_perfiles()
        opciones = perfiles + ["➕ Nuevo perfil"]
        sel = st.selectbox("Perfil de trabajo", opciones, index=0)
        if sel == "➕ Nuevo perfil":
            perfil = st.text_input("Nombre del nuevo perfil", value="principal") or "principal"
        else:
            perfil = sel

        if st.session_state.get("perfil_activo") != perfil:
            config.establecer_perfil(perfil)
            st.session_state["perfil_activo"] = perfil
            for clave in ("resultados", "previews", "tramite_sugerido"):
                st.session_state.pop(clave, None)
        else:
            config.establecer_perfil(perfil)

        st.divider()
        pagina = st.radio(
            "Menu",
            [
                "Revisar expediente",
                "Historial",
                "Seguimiento",
                "Caducidades",
                "Calendario",
                "Estadisticas",
                "Tramites",
                "Gestoria",
                "Ajustes",
            ],
            label_visibility="collapsed",
        )
        st.divider()

        api_key_env = os.environ.get("ANTHROPIC_API_KEY")
        if api_key_env:
            st.success("Clave de API detectada en el entorno.")
            api_key = None
        else:
            api_key = st.text_input(
                "Clave de API de Anthropic",
                type="password",
                help="Se usa solo en esta sesion. Tambien puedes definir ANTHROPIC_API_KEY.",
            )

        nombre_modelo = st.selectbox("Modelo de IA", list(MODELOS.keys()))
        modelo = MODELOS[nombre_modelo]
        dias_aviso = st.number_input(
            "Avisar si caduca en menos de (dias)",
            min_value=0, max_value=365, value=analizador.DIAS_AVISO_CADUCIDAD, step=15,
        )
        if not analizador._HEIC_OK:
            st.caption("HEIC no disponible: instala 'pillow-heif' para fotos de iPhone.")
        st.caption(f"Datos: `{config.BASE_DIR}`")
    return pagina, api_key, modelo, int(dias_aviso)


# --------------------------------------------------------------------------- #
#  Pagina: Revisar expediente
# --------------------------------------------------------------------------- #
def pagina_revisar(api_key, modelo, dias_aviso):
    st.title("Revisar expediente")
    st.markdown(
        '<p class="bz-page-subtitle">Sube los documentos (PDF o fotos de WhatsApp) y la '
        "herramienta los lee, clasifica y comprueba que documentacion falta, esta caducada "
        'o tiene incidencias.</p>',
        unsafe_allow_html=True,
    )

    if not tramites.lista_tramites():
        st.warning("No hay tramites definidos. Ve a la pestana 'Tramites' para crear uno.")
        return

    opciones = tramites.lista_tramites()
    etiquetas = [n for _, n in opciones]
    sugerido = st.session_state.get("tramite_sugerido")
    idx_def = next((i for i, (t, _) in enumerate(opciones) if t == sugerido), 0)

    col1, col2 = st.columns(2)
    with col1:
        idx = st.selectbox(
            "Tipo de tramite", range(len(opciones)),
            index=idx_def, format_func=lambda i: etiquetas[i],
        )
        tramite_id = opciones[idx][0]
    with col2:
        solicitante = st.text_input("Nombre del solicitante (opcional)")

    st.info(tramites.TRAMITES[tramite_id].get("descripcion", ""))
    with st.expander("Ver documentacion exigida para este tramite"):
        for doc in tramites.documentos_de(tramite_id):
            marca = "**(obligatorio)**" if doc["obligatorio"] else "(opcional)"
            st.markdown(f"- {doc['nombre']} {marca} — {doc.get('notas', '')}")

    archivos = st.file_uploader(
        "Documentos del expediente (PDF, JPG, PNG, HEIC)",
        type=analizador.extensiones_admitidas(),
        accept_multiple_files=True,
        help="Puedes subir varias fotos y PDF a la vez.",
    )

    items, grupos, modelo_sec = None, None, None
    if archivos:
        st.markdown("##### Agrupar paginas de un mismo documento")
        st.caption(
            "Pon el **mismo numero de grupo** a las fotos que sean el mismo documento "
            "(p.ej. las 4 fotos de un pasaporte). Por defecto cada archivo va por separado."
        )
        col_grupo = "Grupo (mismo nº = mismo documento)"
        df = pd.DataFrame(
            {"Archivo": [a.name for a in archivos], col_grupo: list(range(1, len(archivos) + 1))}
        )
        editado = st.data_editor(
            df, disabled=["Archivo"], hide_index=True, use_container_width=True,
            column_config={col_grupo: st.column_config.NumberColumn(min_value=1, step=1, format="%d")},
            key="editor_grupos",
        )
        grupos = {}
        for i, archivo in enumerate(archivos):
            clave = int(editado.iloc[i][col_grupo])
            grupos.setdefault(clave, []).append((archivo.name, archivo.getvalue()))
        items = [grupos[k] for k in sorted(grupos)]

        doble = st.checkbox(
            "Doble verificacion (dos modelos revisan; mas fiable y mas lento)"
        )
        if doble:
            nombres_mod = list(MODELOS)
            idx_sec = 1 if MODELOS[nombres_mod[0]] == modelo else 0
            sec = st.selectbox("Segundo modelo", nombres_mod, index=idx_sec)
            modelo_sec = MODELOS[sec]

        c1, c2 = st.columns(2)
        analizar = c1.button("🔍 Analizar expediente", type="primary", use_container_width=True)
        if c2.button("🔎 Sugerir tramite (IA)", use_container_width=True):
            try:
                cliente = obtener_cliente(api_key)
                with st.spinner("Analizando para sugerir el tramite..."):
                    sug = analizador.sugerir_tramite(cliente, items, modelo=modelo)
                if sug:
                    st.session_state["tramite_sugerido"] = sug["tramite_id"]
                    nombre = tramites.TRAMITES[sug["tramite_id"]]["nombre"]
                    st.success(f"La IA sugiere: **{nombre}**. {sug.get('justificacion', '')}")
                    st.caption("Seleccionalo en el desplegable de arriba si procede.")
                else:
                    st.warning("No se ha podido determinar el tramite automaticamente.")
            except Exception as exc:  # noqa: BLE001
                st.error(f"No se pudo sugerir el tramite: {exc}")
    else:
        analizar = False

    if analizar and items:
        try:
            cliente = obtener_cliente(api_key)
        except Exception as exc:  # noqa: BLE001
            st.error(f"No se pudo iniciar el cliente de IA: {exc}")
            return

        hoy = date.today()
        resultados = []
        previews = {}
        barra = st.progress(0.0, text="Analizando documentos...")
        for i, paginas in enumerate(items, start=1):
            nombres = ", ".join(n for n, _ in paginas)
            barra.progress(i / len(items), text=f"Analizando {nombres} ({i}/{len(items)})")
            try:
                datos = analizador.analizar_documento(
                    cliente, paginas, tramite_id, modelo=modelo, hoy=hoy,
                    dias_aviso=dias_aviso, modelo_secundario=modelo_sec,
                )
            except Exception as exc:  # noqa: BLE001
                datos = {
                    "archivo": nombres, "archivos": [n for n, _ in paginas],
                    "tipo_id": "no_identificado", "tipo_nombre": "Error al analizar",
                    "estado": "desconocido", "legibilidad": "-",
                    "incidencias": [f"No se pudo analizar: {exc}"], "resumen": "",
                    "fecha_caducidad": None,
                }
            resultados.append(datos)
            previews[datos["archivo"]] = paginas
        barra.empty()

        try:
            historial.guardar(tramite_id, solicitante, resultados)
        except Exception:  # noqa: BLE001
            pass

        st.session_state["resultados"] = resultados
        st.session_state["previews"] = previews
        st.session_state["tramite_id"] = tramite_id
        st.session_state["solicitante"] = solicitante
        st.session_state["hoy"] = hoy

    if "resultados" in st.session_state:
        mostrar_resultados(
            st.session_state["resultados"], st.session_state["tramite_id"],
            st.session_state["solicitante"], st.session_state["hoy"],
            previews=st.session_state.get("previews"),
        )


# --------------------------------------------------------------------------- #
#  Pagina: Historial (con filtros y agrupacion por cliente)
# --------------------------------------------------------------------------- #
def pagina_historial():
    st.title("Historial de expedientes")
    registros = historial.listar()
    if not registros:
        st.info("Aun no hay expedientes revisados.")
        return

    nombres_tramite = {tid: t["nombre"] for tid, t in tramites.TRAMITES.items()}

    f1, f2, f3, f4 = st.columns([2, 2, 2, 1])
    busqueda = f1.text_input("Buscar por solicitante").strip().lower()
    tramites_presentes = sorted({r["tramite_id"] for r in registros})
    filtro_tramite = f2.multiselect(
        "Tramite", tramites_presentes, format_func=lambda t: nombres_tramite.get(t, t)
    )
    filtro_estado = f3.selectbox("Estado", ["Todos", "Listo", "Incompleto"])
    agrupar = f4.checkbox("Por cliente")

    filtrados = []
    for r in registros:
        if busqueda and busqueda not in (r["solicitante"] or "").lower():
            continue
        if filtro_tramite and r["tramite_id"] not in filtro_tramite:
            continue
        if filtro_estado == "Listo" and not r["listo"]:
            continue
        if filtro_estado == "Incompleto" and r["listo"]:
            continue
        filtrados.append(r)

    if not filtrados:
        st.warning("Ningun expediente coincide con los filtros.")
        return

    if agrupar:
        por_cliente = {}
        for r in filtrados:
            por_cliente.setdefault(r["solicitante"] or "(sin nombre)", []).append(r)
        for cliente in sorted(por_cliente):
            with st.expander(f"👤 {cliente} ({len(por_cliente[cliente])})"):
                _tabla_historial(por_cliente[cliente], nombres_tramite)
    else:
        _tabla_historial(filtrados, nombres_tramite)

    st.divider()
    etiquetas = {
        r["id"]: f"{r['fecha'].replace('T', ' ')} · {r['solicitante'] or 'sin nombre'}"
        for r in filtrados
    }
    sel = st.selectbox("Ver expediente", list(etiquetas), format_func=lambda i: etiquetas[i])
    c1, c2 = st.columns(2)
    abrir = c1.button("Abrir expediente", type="primary")
    if c2.button("🗑️ Eliminar del historial"):
        historial.eliminar(sel)
        st.success("Expediente eliminado.")
        st.rerun()

    if abrir:
        registro = historial.cargar(sel)
        if not registro:
            st.error("No se pudo cargar el expediente.")
            return
        st.divider()
        mostrar_resultados(
            registro["resultados"], registro["tramite_id"], registro["solicitante"],
            date.fromisoformat(registro["fecha"][:10]), prefijo=f"hist_{sel}",
        )


def _tabla_historial(registros, nombres_tramite):
    tabla = pd.DataFrame(
        [
            {
                "Fecha": r["fecha"].replace("T", " "),
                "Solicitante": r["solicitante"] or "-",
                "Tramite": nombres_tramite.get(r["tramite_id"], r["tramite_id"]),
                "Resultado": "✅ Listo" if r["listo"] else "⛔ Incompleto",
                "Faltan": r["faltan"], "Caducados": r["caducados"], "Avisos": r["avisos"],
            }
            for r in registros
        ]
    )
    st.dataframe(tabla, hide_index=True, use_container_width=True)


# --------------------------------------------------------------------------- #
#  Pagina: Caducidades (seguimiento proactivo)
# --------------------------------------------------------------------------- #
def pagina_caducidades():
    st.title("Avisos de caducidad")
    st.markdown(
        '<p class="bz-page-subtitle">Documentos de expedientes ya revisados que estan caducados '
        "o caducaran pronto, calculado a dia de hoy. Util para avisar al cliente con "
        "tiempo.</p>",
        unsafe_allow_html=True,
    )
    dias = st.slider("Mostrar lo que caduca en los proximos (dias)", 0, 365, 90, step=15)
    avisos = historial.proximas_caducidades(dias)
    if not avisos:
        st.success("No hay documentos caducados ni proximos a caducar en el historial.")
        return

    vencidos = [a for a in avisos if a["vencido"]]
    if vencidos:
        st.error(f"⛔ {len(vencidos)} documento(s) ya vencido(s).")

    tabla = pd.DataFrame(
        [
            {
                "Solicitante": a["solicitante"],
                "Tramite": a["tramite"],
                "Documento": a["documento"],
                "Caduca": a["fecha_caducidad"],
                "Dias": a["dias_restantes"],
                "Estado": "⛔ Vencido" if a["vencido"] else "🟠 Caduca pronto",
            }
            for a in avisos
        ]
    )
    st.dataframe(tabla, hide_index=True, use_container_width=True)


# --------------------------------------------------------------------------- #
#  Pagina: Tramites (editor de checklists)
# --------------------------------------------------------------------------- #
def pagina_tramites():
    st.title("Tramites y documentacion")
    st.markdown(
        '<p class="bz-page-subtitle">Edita la documentacion exigida por cada tramite. '
        "Los cambios se guardan en el perfil activo y se usan en las "
        "revisiones.</p>",
        unsafe_allow_html=True,
    )

    with st.expander("➕ Crear un nuevo tramite"):
        nuevo_nombre = st.text_input("Nombre del nuevo tramite", key="nuevo_tramite_nombre")
        if st.button("Crear tramite"):
            if nuevo_nombre.strip():
                tid = _slug(nuevo_nombre)
                if tid in tramites.TRAMITES:
                    st.warning("Ya existe un tramite con ese identificador.")
                else:
                    tramites.TRAMITES[tid] = {
                        "nombre": nuevo_nombre.strip(), "descripcion": "",
                        "anios_permanencia": None, "documentos": [],
                    }
                    config.guardar_tramites(tramites.TRAMITES)
                    st.success(f"Tramite '{nuevo_nombre}' creado.")
                    st.rerun()
            else:
                st.warning("Indica un nombre.")

    opciones = tramites.lista_tramites()
    if not opciones:
        st.info("No hay tramites. Crea uno arriba.")
        return

    etiquetas = [n for _, n in opciones]
    idx = st.selectbox("Tramite a editar", range(len(opciones)), format_func=lambda i: etiquetas[i])
    tramite_id = opciones[idx][0]
    tramite = tramites.TRAMITES[tramite_id]

    nombre = st.text_input("Nombre", value=tramite["nombre"], key=f"nom_{tramite_id}")
    descripcion = st.text_area(
        "Descripcion", value=tramite.get("descripcion", ""), key=f"desc_{tramite_id}"
    )
    anios = st.number_input(
        "Anios de permanencia exigidos (0 = no aplica)",
        min_value=0, max_value=20, value=int(tramite.get("anios_permanencia") or 0),
        key=f"anios_{tramite_id}",
    )

    st.markdown("##### Documentos exigidos")
    st.caption(
        "Anade, edita o elimina filas. 'Obligatorio' marca los que bloquean la "
        "presentacion; 'Caduca' los que conviene vigilar por fecha de caducidad."
    )
    df = pd.DataFrame(
        [
            {
                "ID": d["id"], "Documento": d["nombre"],
                "Obligatorio": bool(d["obligatorio"]), "Caduca": bool(d.get("caduca", False)),
                "Notas": d.get("notas", ""),
            }
            for d in tramite["documentos"]
        ]
    )
    if df.empty:
        df = pd.DataFrame(
            [{"ID": "", "Documento": "", "Obligatorio": True, "Caduca": False, "Notas": ""}]
        )
    editado = st.data_editor(
        df, num_rows="dynamic", hide_index=True, use_container_width=True,
        column_config={
            "Obligatorio": st.column_config.CheckboxColumn(),
            "Caduca": st.column_config.CheckboxColumn(),
        },
        key=f"docs_{tramite_id}",
    )

    c1, c2, c3 = st.columns(3)
    if c1.button("💾 Guardar tramite", type="primary"):
        documentos = []
        for _, fila in editado.iterrows():
            doc_nombre = str(fila["Documento"]).strip()
            if not doc_nombre:
                continue
            doc_id = str(fila["ID"]).strip() or _slug(doc_nombre)
            documentos.append(
                {
                    "id": doc_id, "nombre": doc_nombre,
                    "obligatorio": bool(fila["Obligatorio"]), "caduca": bool(fila["Caduca"]),
                    "notas": str(fila["Notas"]).strip(),
                }
            )
        tramites.TRAMITES[tramite_id] = {
            "nombre": nombre.strip() or tramite["nombre"],
            "descripcion": descripcion.strip(),
            "anios_permanencia": int(anios) or None,
            "documentos": documentos,
        }
        config.guardar_tramites(tramites.TRAMITES)
        st.success("Tramite guardado.")
        st.rerun()

    if c2.button("🗑️ Eliminar este tramite"):
        del tramites.TRAMITES[tramite_id]
        config.guardar_tramites(tramites.TRAMITES)
        st.success("Tramite eliminado.")
        st.rerun()

    if c3.button("↩️ Restablecer todos por defecto"):
        config.restablecer_tramites()
        st.success("Tramites restablecidos a los valores por defecto.")
        st.rerun()


# --------------------------------------------------------------------------- #
#  Pagina: Gestoria (membrete)
# --------------------------------------------------------------------------- #
def pagina_gestoria():
    st.title("Datos de la gestoria")
    st.markdown(
        '<p class="bz-page-subtitle">Estos datos y el logo apareceran como membrete '
        "en informes y cartas.</p>",
        unsafe_allow_html=True,
    )
    cfg = config.cargar_config()

    nombre = st.text_input("Nombre de la gestoria", value=cfg.get("nombre_gestoria", ""))
    direccion = st.text_input("Direccion", value=cfg.get("direccion", ""))
    col1, col2 = st.columns(2)
    telefono = col1.text_input("Telefono", value=cfg.get("telefono", ""))
    email = col2.text_input("Email", value=cfg.get("email", ""))

    if st.button("💾 Guardar datos", type="primary"):
        config.guardar_config(
            {
                "nombre_gestoria": nombre.strip(), "direccion": direccion.strip(),
                "telefono": telefono.strip(), "email": email.strip(),
                "logo_path": cfg.get("logo_path", ""),
            }
        )
        st.success("Datos guardados.")
        st.rerun()

    st.divider()
    st.markdown("##### Logo")
    logo_actual = cfg.get("logo_path", "")
    if logo_actual and os.path.exists(logo_actual):
        st.image(logo_actual, width=160)
        if st.button("Quitar logo"):
            config.eliminar_logo()
            st.rerun()
    logo = st.file_uploader("Subir logo (PNG o JPG)", type=["png", "jpg", "jpeg"])
    if logo is not None and st.button("Guardar logo"):
        try:
            config.guardar_logo(logo.getvalue(), logo.name)
            st.success("Logo guardado.")
            st.rerun()
        except ValueError as exc:
            st.error(str(exc))


# --------------------------------------------------------------------------- #
#  Render comun de resultados + descargas
# --------------------------------------------------------------------------- #
def mostrar_resultados(resultados, tramite_id, solicitante, hoy, prefijo="rev", previews=None):
    if tramite_id not in tramites.TRAMITES:
        st.error("El tramite de este expediente ya no existe. Vuelve a crearlo para verlo.")
        return

    checklist, no_identificados = analizador.evaluar_expediente(resultados, tramite_id)
    listo = analizador.expediente_listo(checklist)

    if listo:
        st.success("✅ Expediente completo: no faltan obligatorios ni hay caducados.")
    else:
        st.error("⛔ Expediente incompleto: revisa los documentos marcados abajo.")

    faltan = sum(1 for c in checklist if c["estado"] == "falta")
    caducados = sum(1 for c in checklist if c["estado"] == "caducado")
    avisos = sum(1 for c in checklist if c["estado"] in ("con_incidencias", "proximo_a_caducar"))
    m1, m2, m3 = st.columns(3)
    m1.metric("Obligatorios que faltan", faltan)
    m2.metric("Caducados", caducados)
    m3.metric("A revisar / caducan pronto", avisos)

    # Comprobaciones automaticas (coherencia + fechas + permanencia)
    docs_todos = [d for fila in checklist for d in fila["documentos"]] + no_identificados
    incidencias = analizador.incidencias_expediente(docs_todos, hoy)
    permanencia = analizador.calcular_permanencia(docs_todos, tramite_id, hoy=hoy)
    if incidencias or permanencia:
        st.subheader("Comprobaciones automaticas")
        for aviso in incidencias:
            st.warning(aviso)
        if not incidencias:
            st.caption("Coherencia: nombres, numeros y fechas coinciden entre los documentos.")
        if permanencia:
            req = permanencia["requeridos"]
            if permanencia["anios"] is None:
                st.info(f"Permanencia: el tramite exige {req} anos; no se ha podido calcular la fecha de inicio.")
            elif permanencia["cumple"]:
                st.success(
                    f"Permanencia: {permanencia['anios']} anos acreditados desde "
                    f"{permanencia['fecha_inicio']} (exigidos {req})."
                )
            else:
                st.error(
                    f"Permanencia: solo {permanencia['anios']} anos acreditados desde "
                    f"{permanencia['fecha_inicio']} (exigidos {req})."
                )

    st.subheader("Checklist de documentacion")
    for fila in checklist:
        icono, etiqueta = _BADGE.get(fila["estado"], ("•", fila["estado"]))
        oblig = " · obligatorio" if fila["obligatorio"] else " · opcional"
        with st.expander(f"{icono} {fila['nombre']} — {etiqueta}{oblig}"):
            if fila["documentos"]:
                for doc in fila["documentos"]:
                    _mostrar_documento(doc, previews)
            else:
                st.write(fila.get("notas", "No aportado."))

    if no_identificados:
        st.subheader("Documentos no identificados")
        st.caption("No encajan con ningun requisito del tramite. Revisar a mano.")
        for doc in no_identificados:
            _mostrar_documento(doc, previews)

    gestoria = config.cargar_config()
    texto_informe = informe.generar_informe(
        checklist, no_identificados, tramite_id, solicitante=solicitante, hoy=hoy
    )

    st.subheader("Informe de revision")
    st.markdown(texto_informe)

    nombre_base = (solicitante or "expediente").strip().replace(" ", "_").lower() or "expediente"
    fecha = hoy.isoformat()
    d1, d2, d3 = st.columns(3)
    d1.download_button(
        "⬇️ Markdown (.md)", data=texto_informe,
        file_name=f"informe_{nombre_base}_{fecha}.md", mime="text/markdown",
        use_container_width=True, key=f"{prefijo}_md",
    )
    with d2:
        try:
            docx_bytes = informe.generar_docx(
                checklist, no_identificados, tramite_id,
                solicitante=solicitante, hoy=hoy, gestoria=gestoria,
            )
            st.download_button(
                "⬇️ Word (.docx)", data=docx_bytes,
                file_name=f"informe_{nombre_base}_{fecha}.docx",
                mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                use_container_width=True, key=f"{prefijo}_docx",
            )
        except Exception as exc:  # noqa: BLE001
            st.caption(f"Word no disponible: {exc}")
    with d3:
        try:
            pdf_bytes = informe.generar_pdf(
                checklist, no_identificados, tramite_id,
                solicitante=solicitante, hoy=hoy, gestoria=gestoria,
            )
            st.download_button(
                "⬇️ PDF (.pdf)", data=pdf_bytes,
                file_name=f"informe_{nombre_base}_{fecha}.pdf", mime="application/pdf",
                use_container_width=True, key=f"{prefijo}_pdf",
            )
        except Exception as exc:  # noqa: BLE001
            st.caption(f"PDF no disponible: {exc}")

    # Carta de requerimiento al cliente
    st.subheader("Carta de requerimiento al cliente")
    carta = informe.generar_requerimiento(
        checklist, tramite_id, solicitante=solicitante, gestoria=gestoria, hoy=hoy
    )
    with st.expander("Ver / copiar texto de la carta"):
        st.text_area("Carta", value=carta, height=300, key=f"{prefijo}_carta_txt")
    r1, r2 = st.columns(2)
    r1.download_button(
        "⬇️ Carta (.txt)", data=carta,
        file_name=f"requerimiento_{nombre_base}_{fecha}.txt", mime="text/plain",
        use_container_width=True, key=f"{prefijo}_req_txt",
    )
    with r2:
        try:
            req_docx = informe.generar_requerimiento_docx(
                checklist, tramite_id, solicitante=solicitante, gestoria=gestoria, hoy=hoy
            )
            st.download_button(
                "⬇️ Carta (.docx)", data=req_docx,
                file_name=f"requerimiento_{nombre_base}_{fecha}.docx",
                mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                use_container_width=True, key=f"{prefijo}_req_docx",
            )
        except Exception as exc:  # noqa: BLE001
            st.caption(f"Carta Word no disponible: {exc}")

    # Ficha estructurada (Excel / CSV)
    st.subheader("Ficha del expediente (datos)")
    meta_ficha = {"solicitante": solicitante, "tramite_id": tramite_id, "fecha": fecha}
    e1, e2 = st.columns(2)
    with e1:
        try:
            xlsx = ficha.exportar_excel(resultados, meta_ficha)
            st.download_button(
                "⬇️ Excel (.xlsx)", data=xlsx,
                file_name=f"ficha_{nombre_base}_{fecha}.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                use_container_width=True, key=f"{prefijo}_xlsx",
            )
        except Exception as exc:  # noqa: BLE001
            st.caption(f"Excel no disponible: {exc}")
    e2.download_button(
        "⬇️ CSV (.csv)", data=ficha.exportar_csv(resultados),
        file_name=f"ficha_{nombre_base}_{fecha}.csv", mime="text/csv",
        use_container_width=True, key=f"{prefijo}_csv",
    )

    # Enviar al cliente (WhatsApp / email)
    st.subheader("Enviar al cliente")
    col_wa, col_mail = st.columns(2)
    with col_wa:
        st.markdown("**WhatsApp**")
        texto_wa = comunicacion.mensaje_whatsapp(checklist, tramite_id, solicitante, gestoria)
        st.text_area("Mensaje", value=texto_wa, height=180, key=f"{prefijo}_wa")
        tel = st.text_input("Telefono del cliente (con prefijo, opcional)", key=f"{prefijo}_tel")
        enlace = comunicacion.enlace_whatsapp(texto_wa, tel)
        st.markdown(f"[📲 Abrir en WhatsApp]({enlace})")
    with col_mail:
        st.markdown("**Email**")
        with st.form(f"{prefijo}_form_email"):
            destino = st.text_input("Email del cliente")
            adjuntar = st.checkbox("Adjuntar informe PDF y carta Word", value=True)
            enviar = st.form_submit_button("Enviar email")
        if enviar:
            adjuntos = []
            if adjuntar:
                try:
                    adjuntos.append((
                        f"informe_{nombre_base}.pdf",
                        informe.generar_pdf(checklist, no_identificados, tramite_id,
                                            solicitante=solicitante, hoy=hoy, gestoria=gestoria),
                        "application/pdf",
                    ))
                    adjuntos.append((
                        f"requerimiento_{nombre_base}.docx",
                        informe.generar_requerimiento_docx(checklist, tramite_id,
                                                           solicitante=solicitante,
                                                           gestoria=gestoria, hoy=hoy),
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    ))
                except Exception:  # noqa: BLE001
                    pass
            asunto = f"Documentacion de su tramite ({tramites.TRAMITES[tramite_id]['nombre']})"
            ok, msg = comunicacion.enviar_email(gestoria, destino, asunto, carta, adjuntos)
            (st.success if ok else st.error)(msg)


def _mostrar_documento(doc, previews=None):
    cols = st.columns([2, 1])
    with cols[0]:
        st.write(f"**Archivo:** {doc.get('archivo', '-')}")
        if doc.get("titular"):
            st.write(f"**Titular:** {doc['titular']}")
        if doc.get("numero"):
            st.write(f"**Numero:** {doc['numero']}")
        if doc.get("pais_emision"):
            st.write(f"**Pais/autoridad:** {doc['pais_emision']}")
        if doc.get("resumen"):
            st.caption(doc["resumen"])
    with cols[1]:
        if doc.get("fecha_emision"):
            st.write(f"**Emision:** {doc['fecha_emision']}")
        if doc.get("fecha_caducidad"):
            st.write(f"**Caducidad:** {doc['fecha_caducidad']}")
        st.write(f"**Estado:** {doc.get('estado', '-')}")
        st.write(f"**Legibilidad:** {doc.get('legibilidad', '-')}")
    for inc in doc.get("incidencias", []):
        st.warning(inc)
    _vista_previa(doc, previews)


def _vista_previa(doc, previews):
    if not previews:
        return
    paginas = previews.get(doc.get("archivo"))
    if not paginas:
        return
    with st.expander("👁️ Ver documento"):
        for nombre, datos in paginas:
            ext = nombre.lower().rsplit(".", 1)[-1] if "." in nombre else ""
            if ext == "pdf":
                b64 = base64.b64encode(datos).decode("utf-8")
                st.markdown(
                    f'<iframe src="data:application/pdf;base64,{b64}" '
                    f'width="100%" height="450"></iframe>',
                    unsafe_allow_html=True,
                )
            else:
                try:
                    st.image(analizador.miniatura(datos), caption=nombre, use_container_width=True)
                except Exception:  # noqa: BLE001
                    st.caption(f"(no se pudo previsualizar {nombre})")


# --------------------------------------------------------------------------- #
#  Pagina: Seguimiento del expediente presentado
# --------------------------------------------------------------------------- #
def pagina_seguimiento(api_key, modelo, dias_aviso):
    st.title("Seguimiento de expedientes")
    st.info(
        "El sistema oficial no ofrece una consulta automatica fiable, por lo que "
        "el seguimiento del estado se registra a mano: cada vez que consultes "
        "'Como va lo mio' con el nº de expediente, anota aqui el estado y la app "
        "guarda la linea de tiempo. Programa un recordatorio en el Calendario."
    )
    registros = historial.listar()
    if not registros:
        st.info("Aun no hay expedientes. Revisa uno primero.")
        return

    etiquetas = {
        r["id"]: f"{r['fecha'].replace('T', ' ')} · {r['solicitante'] or 'sin nombre'}"
        for r in registros
    }
    eid = st.selectbox("Expediente", list(etiquetas), format_func=lambda i: etiquetas[i])
    reg = historial.cargar(eid)
    if not reg:
        return

    st.markdown("##### Datos de presentacion")
    c1, c2, c3 = st.columns(3)
    numero = c1.text_input("Nº de expediente", value=reg.get("numero_expediente", ""))
    nie = c2.text_input("NIE", value=reg.get("nie", ""))
    resultado = c3.selectbox(
        "Resultado final",
        ["pendiente", "aprobado", "denegado"],
        index=["pendiente", "aprobado", "denegado"].index(reg.get("resultado_final", "pendiente"))
        if reg.get("resultado_final") in ("pendiente", "aprobado", "denegado")
        else 0,
    )
    b1, b2 = st.columns(2)
    if b1.button("💾 Guardar datos de presentacion", type="primary"):
        historial.marcar_presentado(eid, numero.strip(), nie.strip())
        historial.marcar_resultado(eid, resultado)
        st.success("Datos guardados.")
        st.rerun()
    if b2.button("🔒 Anonimizar (RGPD)"):
        historial.anonimizar(eid)
        st.success("Datos personales del expediente eliminados.")
        st.rerun()

    st.markdown("##### Linea de tiempo del expediente")
    seguimiento = reg.get("seguimiento", [])
    if seguimiento:
        for ev in seguimiento:
            st.write(f"- **{ev['fecha']}** — {ev['estado']}" + (f": {ev['nota']}" if ev.get("nota") else ""))
    else:
        st.caption("Sin anotaciones todavia.")
    with st.form(f"seg_{eid}"):
        estado = st.text_input("Nuevo estado (p.ej. 'En tramite', 'Requerido', 'Resuelto')")
        nota = st.text_input("Nota (opcional)")
        if st.form_submit_button("Anadir al seguimiento") and estado.strip():
            historial.anadir_seguimiento(eid, estado.strip(), nota.strip())
            st.rerun()

    st.markdown("##### Tareas / recordatorios de este expediente")
    for i, tarea in enumerate(reg.get("tareas", [])):
        marca = "✅" if tarea.get("hecha") else "⬜"
        cols = st.columns([4, 1])
        cols[0].write(f"{marca} {tarea['fecha']} — {tarea['descripcion']}")
        if not tarea.get("hecha") and cols[1].button("Hecha", key=f"t_{eid}_{i}"):
            historial.marcar_tarea(eid, i, True)
            st.rerun()
    with st.form(f"tarea_{eid}"):
        cols = st.columns([3, 2])
        desc = cols[0].text_input("Nueva tarea")
        fecha_t = cols[1].date_input("Fecha")
        if st.form_submit_button("Anadir tarea") and desc.strip():
            historial.anadir_tarea(eid, desc.strip(), fecha_t.isoformat())
            st.rerun()

    st.markdown("##### Anadir documentos al expediente (version nueva)")
    st.caption(
        "Si el cliente reenvia un documento (p.ej. un pasaporte renovado), subelo "
        "aqui: sustituye al anterior, que queda archivado como version previa."
    )
    nuevos = st.file_uploader(
        "Documentos nuevos", type=analizador.extensiones_admitidas(),
        accept_multiple_files=True, key=f"add_{eid}",
    )
    if nuevos and st.button("Analizar y anadir al expediente"):
        try:
            cliente = obtener_cliente(api_key)
        except Exception as exc:  # noqa: BLE001
            st.error(f"No se pudo iniciar el cliente de IA: {exc}")
            return
        resultados_nuevos = []
        barra = st.progress(0.0, text="Analizando...")
        for j, archivo in enumerate(nuevos, start=1):
            barra.progress(j / len(nuevos), text=f"Analizando {archivo.name}")
            try:
                datos = analizador.analizar_documento(
                    cliente, [(archivo.name, archivo.getvalue())], reg["tramite_id"],
                    modelo=modelo, dias_aviso=dias_aviso,
                )
            except Exception as exc:  # noqa: BLE001
                datos = {
                    "archivo": archivo.name, "tipo_id": "no_identificado",
                    "tipo_nombre": "Error", "estado": "desconocido",
                    "incidencias": [str(exc)], "legibilidad": "-",
                }
            resultados_nuevos.append(datos)
        barra.empty()
        historial.anadir_documentos(eid, resultados_nuevos)
        st.success("Documentos anadidos. Las versiones anteriores se han archivado.")
        st.rerun()


# --------------------------------------------------------------------------- #
#  Pagina: Calendario de tareas
# --------------------------------------------------------------------------- #
def pagina_calendario():
    st.title("Calendario de tareas")
    st.markdown(
        '<p class="bz-page-subtitle">Recordatorios de todos los expedientes '
        "(presentaciones, renovaciones, consultas).</p>",
        unsafe_allow_html=True,
    )
    tareas = historial.todas_las_tareas(incluir_hechas=False)
    if not tareas:
        st.success("No hay tareas pendientes.")
        return
    hoy = date.today().isoformat()
    for t in tareas:
        vencida = t["fecha"] < hoy
        icono = "🔴" if vencida else "🗓️"
        cols = st.columns([5, 1])
        cols[0].write(
            f"{icono} **{t['fecha']}** — {t['descripcion']}  _(— {t['solicitante']})_"
        )
        if cols[1].button("Hecha", key=f"cal_{t['expediente_id']}_{t['indice']}"):
            historial.marcar_tarea(t["expediente_id"], t["indice"], True)
            st.rerun()


# --------------------------------------------------------------------------- #
#  Pagina: Estadisticas
# --------------------------------------------------------------------------- #
def pagina_estadisticas():
    st.title("Estadisticas")
    st.markdown(
        '<p class="bz-page-subtitle">Metricas del perfil activo a partir del historial '
        "de expedientes.</p>",
        unsafe_allow_html=True,
    )
    e = historial.estadisticas()
    if e["total"] == 0:
        st.info("Aun no hay expedientes para calcular estadisticas.")
        return
    m1, m2, m3 = st.columns(3)
    m1.metric("Expedientes", e["total"])
    m2.metric("Completos a la primera", f"{e['porcentaje_completos']} %")
    m3.metric("Aprobados", e["por_resultado"].get("aprobado", 0))

    if e["por_tramite"]:
        st.subheader("Expedientes por tramite")
        st.bar_chart(pd.Series(e["por_tramite"]))
    if e["por_resultado"]:
        st.subheader("Resultado de los tramites")
        st.bar_chart(pd.Series(e["por_resultado"]))
    if e["fallos_doc"]:
        st.subheader("Documentos que mas fallan (incidencias o caducados)")
        st.bar_chart(pd.Series(e["fallos_doc"]))


# --------------------------------------------------------------------------- #
#  Pagina: Ajustes (SMTP, RGPD, copia de seguridad)
# --------------------------------------------------------------------------- #
def pagina_ajustes():
    st.title("Ajustes")
    cfg = config.cargar_config()

    st.subheader("Envio de email (SMTP)")
    st.caption("Necesario para enviar las cartas al cliente por correo.")
    with st.form("smtp"):
        c1, c2 = st.columns(2)
        host = c1.text_input("Servidor SMTP", value=cfg.get("smtp_host", ""))
        port = c2.number_input("Puerto", value=int(cfg.get("smtp_port", 587) or 587), step=1)
        user = c1.text_input("Usuario", value=cfg.get("smtp_user", ""))
        password = c2.text_input("Contrasena", value=cfg.get("smtp_password", ""), type="password")
        remitente = c1.text_input("Remitente (From)", value=cfg.get("smtp_remitente", ""))
        tls = c2.checkbox("Usar TLS (587)", value=bool(cfg.get("smtp_tls", True)))
        if st.form_submit_button("💾 Guardar SMTP"):
            cfg.update({
                "smtp_host": host.strip(), "smtp_port": int(port),
                "smtp_user": user.strip(), "smtp_password": password,
                "smtp_remitente": remitente.strip(), "smtp_tls": tls,
            })
            config.guardar_config(cfg)
            st.success("Configuracion de email guardada.")
    st.caption("La contrasena se guarda en local. Usa una contrasena de aplicacion si tu correo lo permite.")

    st.divider()
    st.subheader("Proteccion de datos (RGPD)")
    dias = st.number_input(
        "Conservar expedientes (dias; 0 = sin limite)",
        min_value=0, max_value=3650, value=int(cfg.get("rgpd_retencion_dias", 0) or 0), step=30,
    )
    cc1, cc2 = st.columns(2)
    if cc1.button("Guardar retencion"):
        cfg["rgpd_retencion_dias"] = int(dias)
        config.guardar_config(cfg)
        st.success("Guardado.")
    if cc2.button("🧹 Borrar expedientes antiguos ahora"):
        n = historial.borrar_antiguos(int(dias))
        st.success(f"Eliminados {n} expediente(s) anteriores al limite.")

    st.divider()
    st.subheader("Copia de seguridad del perfil")
    st.download_button(
        "⬇️ Exportar perfil (.zip)",
        data=config.exportar_perfil(),
        file_name=f"copia_{config.PERFIL_ACTUAL or 'perfil'}.zip",
        mime="application/zip",
    )
    subido = st.file_uploader("Importar perfil (.zip)", type=["zip"])
    if subido is not None and st.button("Restaurar desde el ZIP"):
        n = config.importar_perfil(subido.getvalue())
        st.success(f"Restaurados {n} archivos. Recarga la pagina.")


# --------------------------------------------------------------------------- #
#  Main
# --------------------------------------------------------------------------- #
def main():
    st.markdown(_CSS, unsafe_allow_html=True)
    pagina, api_key, modelo, dias_aviso = barra_lateral()
    if pagina == "Revisar expediente":
        pagina_revisar(api_key, modelo, dias_aviso)
    elif pagina == "Historial":
        pagina_historial()
    elif pagina == "Seguimiento":
        pagina_seguimiento(api_key, modelo, dias_aviso)
    elif pagina == "Caducidades":
        pagina_caducidades()
    elif pagina == "Calendario":
        pagina_calendario()
    elif pagina == "Estadisticas":
        pagina_estadisticas()
    elif pagina == "Tramites":
        pagina_tramites()
    elif pagina == "Gestoria":
        pagina_gestoria()
    elif pagina == "Ajustes":
        pagina_ajustes()


if __name__ == "__main__":
    main()
