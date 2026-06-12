"""Interfaz grafica para la revision de expedientes de extranjeria.

Ejecutar con:
    streamlit run app.py
"""

import base64
import os
import re
from datetime import date
from pathlib import Path

import anthropic
import pandas as pd
import streamlit as st
from PIL import Image as _PIL_Image

from revision import (
    analizador,
    citas,
    comunicacion,
    config,
    ficha,
    formularios,
    historial,
    imap_import,
    informe,
    ocr_analisis,
    portal,
    tramites,
)

_FAVICON_PATH = Path(__file__).parent / "assets" / "bz_favicon.png"
_favicon = _PIL_Image.open(_FAVICON_PATH) if _FAVICON_PATH.exists() else "⚖️"

st.set_page_config(
    page_title="Burocracia Zero · Extranjeria",
    page_icon=_favicon,
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

/* ── FICHA: tarjetas con icono para lectura rapida ────────── */
.bz-ficha-dato {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: #F5F2FA;
    border: 1px solid #E4DCEF;
    border-radius: 10px;
    padding: 10px 14px;
    margin-bottom: 10px;
}
.bz-ficha-icono {
    font-size: 1.15rem;
    margin-right: 6px;
}
.bz-ficha-etiqueta {
    color: #6B5F82;
    font-size: 0.74rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}
.bz-ficha-valor {
    color: #000000;
    font-size: 1rem;
    font-weight: 600;
}

/* ── HERO "HOY" (resumen destacado del dashboard) ─────────── */
.bz-hero-hoy {
    background: linear-gradient(120deg, #9373B2 0%, #6B5F9E 100%);
    border-radius: 16px;
    padding: 1.4rem 1.8rem;
    margin-bottom: 1.4rem;
    color: #FFFFFF;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2.2rem;
}
.bz-hero-hoy .bz-hero-titulo {
    font-size: 1.15rem;
    font-weight: 700;
    margin-bottom: 2px;
}
.bz-hero-hoy .bz-hero-sub {
    font-size: 0.85rem;
    color: #EDE6F6;
}
.bz-hero-chip {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255,255,255,0.14);
    border-radius: 12px;
    padding: 10px 16px;
}
.bz-hero-chip .bz-hero-icono { font-size: 1.6rem; }
.bz-hero-chip .bz-hero-num { font-size: 1.4rem; font-weight: 800; line-height: 1; }
.bz-hero-chip .bz-hero-label { font-size: 0.72rem; color: #EDE6F6; text-transform: uppercase; letter-spacing: 0.04em; }
.bz-hero-chip.bz-hero-ok { background: rgba(255,234,99,0.92); color: #4A3B00; }
.bz-hero-chip.bz-hero-ok .bz-hero-num,
.bz-hero-chip.bz-hero-ok .bz-hero-label { color: #4A3B00; }

/* ── TARJETAS DE LISTA (tareas, caducidades, actividad reciente) ───── */
.bz-list-card {
    display: flex;
    align-items: center;
    gap: 14px;
    background: #FFFFFF;
    border: 1px solid #E4DCEF;
    border-left: 5px solid #C9A8E8;
    border-radius: 12px;
    padding: 12px 16px;
    margin-bottom: 10px;
    box-shadow: 0 1px 3px rgba(60, 40, 90, 0.06);
}
.bz-list-card .bz-card-icono {
    font-size: 1.7rem;
    line-height: 1;
}
.bz-list-card .bz-card-texto { flex: 1; min-width: 0; }
.bz-list-card .bz-card-titulo {
    font-weight: 700;
    color: #2B2440;
    font-size: 0.92rem;
}
.bz-list-card .bz-card-sub {
    color: #6B5F82;
    font-size: 0.78rem;
    margin-top: 1px;
}
.bz-list-card.bz-card-urgente { border-left-color: #E53935; background: #FFF6F6; }
.bz-list-card.bz-card-aviso   { border-left-color: #FB8C00; background: #FFFAF3; }
.bz-list-card.bz-card-ok      { border-left-color: #43A047; background: #F5FBF5; }
.bz-list-card.bz-card-info    { border-left-color: #7E57C2; background: #FAF7FE; }

/* Barra de progreso de dias restantes hasta caducidad */
.bz-cad-bar-track {
    background: #EFEAF6;
    border-radius: 6px;
    height: 7px;
    overflow: hidden;
    margin-top: 8px;
}
.bz-cad-bar-fill { height: 100%; border-radius: 6px; }

/* ── ACCIONES RÁPIDAS (tarjetas de inicio del dashboard) ──── */
.bz-accion-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    background: #FFFFFF;
    border: 2px solid #E4DCEF;
    border-radius: 16px;
    padding: 1.3rem 1rem 0.8rem 1rem;
    box-shadow: 0 2px 8px rgba(60, 40, 90, 0.07);
    gap: 6px;
    margin-bottom: 0;
    transition: border-color 0.15s, box-shadow 0.15s;
}
.bz-accion-card .bz-ac-icono {
    font-size: 2.2rem;
    line-height: 1;
}
.bz-accion-card .bz-ac-titulo {
    font-weight: 700;
    color: #2B2440;
    font-size: 0.88rem;
}
.bz-accion-card .bz-ac-sub {
    color: #6B5F82;
    font-size: 0.74rem;
}
</style>
"""

# ── MODO OSCURO: capa de overrides que se inyecta encima de _CSS ──────────── #
_CSS_DARK = """
<style>
[data-testid="stAppViewContainer"],
.main, .main .block-container, [data-testid="stHeader"] {
    background-color: #15121E !important;
}
html, body, [class*="css"], p, span, label, li, .stMarkdown, .stMarkdown p {
    color: #E4DEF0 !important;
}
h1 { color: #FFFFFF !important; border-bottom-color: #9373B2 !important; }
h2, h3, h4 { color: #E4DEF0 !important; }
.bz-page-subtitle, .stCaption, small, [data-testid="stCaptionContainer"] {
    color: #A99CC4 !important;
}

[data-testid="stMetric"] {
    background: #1F1A2C !important;
    border-color: #3A2F56 !important;
}
[data-testid="stMetricValue"] { color: #C9A8E8 !important; }
[data-testid="stMetricLabel"] p { color: #A99CC4 !important; }

[data-testid="stExpander"] {
    background: #1B1726 !important;
    border-color: #3A2F56 !important;
}
[data-testid="stExpander"] details summary {
    background: #221D33 !important;
    color: #E4DEF0 !important;
}
[data-testid="stExpander"] details summary:hover { background: #2C2440 !important; }
[data-testid="stExpander"] details[open] summary {
    background: #2C2440 !important;
    color: #D9C2F0 !important;
    border-bottom-color: #3A2F56 !important;
}

[data-baseweb="input"] > div, [data-baseweb="textarea"] > div,
[data-baseweb="select"] > div:first-child, [data-baseweb="popover"] {
    background-color: #1F1A2C !important;
    border-color: #3A2F56 !important;
    color: #E4DEF0 !important;
}
[data-baseweb="input"] input, [data-baseweb="textarea"] textarea {
    color: #E4DEF0 !important;
}

[data-testid="stDataFrame"], [data-testid="stDataEditor"] {
    border-color: #3A2F56 !important;
}

.bz-ficha-dato { background: #1F1A2C !important; border-color: #3A2F56 !important; }
.bz-ficha-etiqueta { color: #A99CC4 !important; }
.bz-ficha-valor { color: #FFFFFF !important; }

.bz-list-card {
    background: #1F1A2C !important;
    border-color: #3A2F56 !important;
    box-shadow: none !important;
}
.bz-list-card .bz-card-titulo { color: #EFEAF7 !important; }
.bz-list-card .bz-card-sub { color: #A99CC4 !important; }
.bz-list-card.bz-card-urgente { background: #2E1B22 !important; }
.bz-list-card.bz-card-aviso   { background: #2E2519 !important; }
.bz-list-card.bz-card-ok      { background: #1A2A1E !important; }
.bz-list-card.bz-card-info    { background: #241D38 !important; }
.bz-cad-bar-track { background: #3A2F56 !important; }
.bz-accion-card { background: #1F1A2C !important; border-color: #3A2F56 !important; }
.bz-accion-card .bz-ac-titulo { color: #EFEAF7 !important; }
.bz-accion-card .bz-ac-sub { color: #A99CC4 !important; }

[data-testid="stAlert"][data-baseweb*="positive"], div[class*="stSuccess"] {
    background-color: #1B2E1D !important; border-left-color: #4CAF50 !important;
}
[data-testid="stAlert"][data-baseweb*="negative"], div[class*="stError"] {
    background-color: #341A1A !important; border-left-color: #E57373 !important;
}
[data-testid="stAlert"][data-baseweb*="warning"], div[class*="stWarning"] {
    background-color: #332E14 !important; border-left-color: #FFEA63 !important;
}
[data-testid="stAlert"][data-baseweb*="info"], div[class*="stInfo"] {
    background-color: #251F35 !important; border-left-color: #9373B2 !important;
}
[data-testid="stAlert"] * { color: #E4DEF0 !important; }

.stButton > button:not([kind="primary"]) {
    background: #1F1A2C !important;
    color: #C9A8E8 !important;
    border-color: #6B5F9E !important;
}
.stButton > button:not([kind="primary"]):hover { background: #2C2440 !important; }
hr { border-color: #3A2F56 !important; }
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
    clave = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not clave:
        raise ValueError(
            "No hay clave de API configurada. "
            "Introduce tu clave de Anthropic en el panel lateral izquierdo "
            "o define la variable de entorno ANTHROPIC_API_KEY."
        )
    return anthropic.Anthropic(api_key=clave)


def _aviso_sin_clave(api_key):
    """Muestra un aviso visible si no hay clave de API y devuelve True si falta."""
    if api_key or os.environ.get("ANTHROPIC_API_KEY"):
        return False
    st.warning(
        "⚠️ **Clave de API no configurada.** "
        "Para usar la IA necesitas introducir tu clave de Anthropic en el "
        "panel lateral izquierdo (campo *Clave de API de Anthropic*) o definir "
        "la variable de entorno `ANTHROPIC_API_KEY`.",
        icon=None,
    )
    return True


def _slug(texto):
    texto = (texto or "").strip().lower()
    for a, b in {"á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n"}.items():
        texto = texto.replace(a, b)
    texto = re.sub(r"[^a-z0-9]+", "_", texto).strip("_")
    return texto or "tramite"


def _rellenar_plantilla(texto, contexto):
    """Sustituye los comodines {solicitante}, {tramite}... sin romper si faltan datos."""
    class _Defecto(dict):
        def __missing__(self, clave):
            return ""
    try:
        return texto.format_map(_Defecto(contexto))
    except (ValueError, IndexError):
        return texto


def _buscar_expedientes(consulta, limite=8):
    """Busca expedientes por nombre, NIE, pasaporte, teléfono, email o nº expediente."""
    consulta = (consulta or "").strip().lower()
    if not consulta:
        return []
    encontrados = []
    for meta in historial.listar():
        registro = historial.cargar(meta["id"])
        if not registro:
            continue
        campos = (
            registro.get("solicitante", ""),
            registro.get("nombre", ""),
            registro.get("nie", ""),
            registro.get("numero_expediente", ""),
            registro.get("num_pasaporte", ""),
            registro.get("telefono", ""),
            registro.get("email_cliente", ""),
        )
        if any(consulta in (c or "").lower() for c in campos):
            encontrados.append(registro)
        if len(encontrados) >= limite:
            break
    return encontrados


# --------------------------------------------------------------------------- #
#  Barra lateral: perfil + configuracion comun
# --------------------------------------------------------------------------- #
def barra_lateral():
    # Aplicar navegacion pendiente ANTES de que el radio se renderice.
    if "_menu_nav" in st.session_state:
        st.session_state["menu_radio"] = st.session_state.pop("_menu_nav")
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
            for clave in ("resultados", "previews", "tramite_sugerido", "eid_actual"):
                st.session_state.pop(clave, None)
        else:
            config.establecer_perfil(perfil)

        # Busqueda global: localiza un expediente por nombre, NIE o nº y abre
        # directamente su seguimiento, sin tener que pasar por el Historial.
        busqueda = st.text_input("🔍 Buscar expediente", placeholder="Nombre, NIE o nº de expediente")
        if busqueda.strip():
            encontrados = _buscar_expedientes(busqueda)
            if not encontrados:
                st.caption("Sin resultados.")
            else:
                for reg in encontrados:
                    etiqueta = f"{reg.get('solicitante') or 'sin nombre'} · {reg.get('fecha', '')[:10]}"
                    if st.button(f"👤 {etiqueta}", key=f"buscar_{reg['id']}", use_container_width=True):
                        st.session_state["_menu_nav"] = "Seguimiento"
                        st.session_state["seguimiento_eid_sugerido"] = reg["id"]
                        st.rerun()

        st.divider()
        pagina = st.radio(
            "Menu",
            [
                "Dashboard",
                "Urgente",
                "Revisar expediente",
                "Primera consulta",
                "Tablero",
                "Historial",
                "Seguimiento",
                "Caducidades",
                "Citas",
                "Calendario",
                "Estadisticas",
                "Asistente IA",
                "Tramites",
                "Plantillas",
                "Gestoria",
                "Ajustes",
            ],
            label_visibility="collapsed",
            key="menu_radio",
        )
        st.divider()

        st.checkbox("🌙 Modo oscuro", key="modo_oscuro")

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
    st.title("Nuevo expediente")
    st.markdown(
        '<p class="bz-page-subtitle">Da de alta un cliente rellenando sus datos, '
        "o sube directamente los documentos para que la IA los analice.</p>",
        unsafe_allow_html=True,
    )

    if not tramites.lista_tramites():
        st.warning("No hay tramites definidos. Ve a la pestana 'Tramites' para crear uno.")
        return

    tab_alta, tab_docs, tab_ocr = st.tabs([
        "➕  Alta de cliente",
        "📄  Analizar con IA",
        "🔍  Analizar con OCR (sin IA)",
    ])

    # ── TAB 1: ALTA RÁPIDA ─────────────────────────────────────────────────── #
    with tab_alta:
        _pagina_alta_rapida()

    # ── TAB 2: ANÁLISIS CON IA ─────────────────────────────────────────────── #
    with tab_docs:
        _pagina_analizar_docs(api_key, modelo, dias_aviso)

    # ── TAB 3: ANÁLISIS CON OCR ────────────────────────────────────────────── #
    with tab_ocr:
        _pagina_ocr()


def _pagina_alta_rapida():
    """Formulario de alta de cliente sin documentos."""
    opciones = tramites.lista_tramites_con_icono()
    etiquetas = [n for _, n in opciones]

    st.markdown("#### 👤 Datos personales")
    c1, c2, c3 = st.columns(3)
    nombre       = c1.text_input("Nombre completo *", key="ar_nombre")
    fnac_raw     = c2.date_input("Fecha de nacimiento", value=None, key="ar_fnac")
    nacionalidad = c3.text_input("Nacionalidad / País de origen", key="ar_nac")

    c4, c5, c6 = st.columns(3)
    nie          = c4.text_input("NIE / TIE (si ya lo tiene)", key="ar_nie")
    num_pas      = c5.text_input("Nº de pasaporte", key="ar_numpas")
    cad_pas_raw  = c6.date_input("Caducidad del pasaporte", value=None, key="ar_cadpas")

    c7, c8 = st.columns(2)
    fentrada_raw = c7.date_input("Fecha de entrada en España", value=None, key="ar_fentrada")
    tramite_idx  = c8.selectbox(
        "Tipo de trámite *", range(len(opciones)),
        format_func=lambda i: etiquetas[i], key="ar_tramite",
    )
    tramite_id_ar = opciones[tramite_idx][0]

    st.markdown("#### 📞 Datos de contacto")
    d1, d2 = st.columns(2)
    telefono = d1.text_input("Teléfono", key="ar_tel")
    email_cl = d2.text_input("Email del cliente", key="ar_email")

    d3, d4 = st.columns([3, 1])
    direccion = d3.text_input("Dirección", key="ar_dir")
    ciudad    = d4.text_input("Ciudad", key="ar_ciudad")

    st.markdown("#### 💼 Datos laborales *(si aplica)*")
    l1, l2, l3 = st.columns(3)
    empleador     = l1.text_input("Empresa / empleador", key="ar_emp")
    fecha_cont    = l2.date_input("Fecha inicio contrato", value=None, key="ar_fcont")
    tipo_cont     = l3.selectbox(
        "Tipo de contrato", ["", "Indefinido", "Temporal", "A tiempo parcial", "Otro"],
        key="ar_tcont",
    )

    st.markdown("#### 📝 Notas iniciales")
    notas = st.text_area("Notas u observaciones internas", height=80, key="ar_notas")

    st.divider()
    btn1, btn2 = st.columns([3, 2])
    boton_alta = btn1.button(
        "✅ Crear expediente", type="primary", use_container_width=True, key="ar_crear",
    )
    if btn2.button("📋 Descargar lista de docs", use_container_width=True, key="ar_lista"):
        gestoria_cfg = config.cargar_config()
        docx_bytes = informe.generar_lista_docs_docx(
            tramite_id_ar, solicitante=nombre.strip(), gestoria=gestoria_cfg,
        )
        st.download_button(
            "⬇️ Descargar Word (.docx)", data=docx_bytes,
            file_name=f"lista_docs_{tramite_id_ar}.docx",
            mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            key="ar_lista_dl",
        )

    if boton_alta:
        if not nombre.strip():
            st.error("El nombre del cliente es obligatorio.")
            return

        def _d(v):
            return v.isoformat() if v else ""

        datos = {
            "nombre":               nombre.strip(),
            "fecha_nacimiento":     _d(fnac_raw),
            "nacionalidad":         nacionalidad.strip(),
            "nie":                  nie.strip(),
            "num_pasaporte":        num_pas.strip(),
            "cad_pasaporte":        _d(cad_pas_raw),
            "fecha_entrada_espana": _d(fentrada_raw),
            "telefono":             telefono.strip(),
            "email_cliente":        email_cl.strip(),
            "direccion":            direccion.strip(),
            "ciudad":               ciudad.strip(),
            "empleador":            empleador.strip(),
            "fecha_contrato":       _d(fecha_cont),
            "tipo_contrato":        tipo_cont if tipo_cont else "",
            "notas":                notas.strip(),
        }
        try:
            eid = historial.alta_rapida(tramite_id_ar, datos)
            st.success(f"✅ Expediente creado correctamente (ID: `{eid}`)")
            st.info("Ve a **Seguimiento** para ver la ficha, añadir documentos o enviar mensajes.")
            if st.button("Ir a Seguimiento →", key="ar_ir_seg"):
                st.session_state["_menu_nav"] = "Seguimiento"
                st.session_state["seguimiento_eid_sugerido"] = eid
                st.rerun()
        except Exception as exc:  # noqa: BLE001
            st.error(f"Error al crear el expediente: {exc}")

    # ── Importar desde Excel ─────────────────────────────────────────────────── #
    st.divider()
    with st.expander("📥 Importar clientes desde Excel"):
        st.caption(
            "Sube un Excel con columnas: **Nombre** (obligatorio), Tramite, NIE, Telefono, "
            "Email, Nacionalidad, Direccion, Ciudad, Empleador, Notas. "
            "El valor de 'Tramite' debe coincidir con el nombre del tramite en la app."
        )
        xl_file = st.file_uploader(
            "Archivo Excel (.xlsx / .xls)", type=["xlsx", "xls"], key="xl_upload"
        )
        if xl_file:
            try:
                df_xl = pd.read_excel(xl_file)
                df_xl.columns = [c.strip() for c in df_xl.columns]
                if "Nombre" not in df_xl.columns:
                    st.error("El Excel debe tener al menos una columna 'Nombre'.")
                else:
                    st.dataframe(df_xl.head(10), hide_index=True, use_container_width=True)
                    st.caption(f"{len(df_xl)} fila(s) detectadas.")
                    # Mapear nombres de trámite → id
                    nombre_a_id = {v["nombre"].lower(): k for k, v in tramites.TRAMITES.items()}
                    opciones_tr = tramites.lista_tramites_con_icono()
                    # Tramite por defecto = primero disponible
                    tramite_def = opciones_tr[0][0] if opciones_tr else ""
                    if st.button("✅ Importar todos", type="primary", key="xl_importar"):
                        ok_n = 0
                        err_n = 0
                        for _, fila in df_xl.iterrows():
                            nombre_xl = str(fila.get("Nombre", "") or "").strip()
                            if not nombre_xl:
                                err_n += 1
                                continue
                            tr_nombre = str(fila.get("Tramite", "") or "").strip().lower()
                            tr_id = nombre_a_id.get(tr_nombre, tramite_def)
                            def _sv(v):
                                return "" if pd.isna(v) else str(v).strip()
                            datos_xl = {
                                "nombre":       nombre_xl,
                                "nie":          _sv(fila.get("NIE")),
                                "telefono":     _sv(fila.get("Telefono")),
                                "email_cliente":_sv(fila.get("Email")),
                                "nacionalidad": _sv(fila.get("Nacionalidad")),
                                "direccion":    _sv(fila.get("Direccion")),
                                "ciudad":       _sv(fila.get("Ciudad")),
                                "empleador":    _sv(fila.get("Empleador")),
                                "notas":        _sv(fila.get("Notas")),
                            }
                            try:
                                historial.alta_rapida(tr_id, datos_xl)
                                ok_n += 1
                            except Exception:  # noqa: BLE001
                                err_n += 1
                        st.success(f"Importados: {ok_n} expedientes correctamente.")
                        if err_n:
                            st.warning(f"{err_n} fila(s) omitidas (sin nombre o error).")
                        st.rerun()
            except Exception as exc:  # noqa: BLE001
                st.error(f"Error al leer el Excel: {exc}")


def _pagina_analizar_docs(api_key, modelo, dias_aviso):
    """Flujo original: subir documentos → IA → guardar expediente."""
    _aviso_sin_clave(api_key)
    opciones = tramites.lista_tramites_con_icono()
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
            marca = "🔴 **obligatorio**" if doc["obligatorio"] else "⚪ opcional"
            icono = tramites.icono_documento(doc["id"])
            st.markdown(f"{icono} **{doc['nombre']}** — {marca}  \n*{doc.get('notas', '')}*")

    # Importar desde email (IMAP) -----------------------------------------------
    cfg_imap = config.cargar_config()
    if cfg_imap.get("imap_host"):
        with st.expander("📧 Importar adjuntos desde email"):
            if st.button("Conectar y ver emails recientes", key="imap_connect"):
                try:
                    imap = imap_import.conectar(
                        cfg_imap["imap_host"], cfg_imap["imap_port"],
                        cfg_imap["imap_user"], cfg_imap["imap_password"],
                        ssl=cfg_imap.get("imap_ssl", True),
                    )
                    emails = imap_import.listar_emails(imap, cfg_imap.get("imap_carpeta", "INBOX"))
                    st.session_state["imap_conn"] = imap
                    st.session_state["imap_emails"] = emails
                except Exception as exc:  # noqa: BLE001
                    st.error(f"No se pudo conectar al servidor IMAP: {exc}")

            emails_cargados = st.session_state.get("imap_emails", [])
            if emails_cargados:
                opciones_email = {
                    e["uid"]: f"{e['fecha'][:16]}  ·  {e['remitente'][:30]}  —  {e['asunto']}"
                    for e in emails_cargados
                    if e.get("tiene_adjuntos")
                }
                if opciones_email:
                    uid_sel = st.selectbox(
                        "Email con adjuntos", list(opciones_email),
                        format_func=lambda u: opciones_email[u], key="imap_uid",
                    )
                    if st.button("Descargar adjuntos de este email", key="imap_dl"):
                        imap = st.session_state.get("imap_conn")
                        if imap:
                            adjuntos = imap_import.descargar_adjuntos(imap, uid_sel)
                            st.session_state["imap_adjuntos"] = adjuntos
                            st.success(f"{len(adjuntos)} adjunto(s) descargados.")
                        else:
                            st.warning("Reconecta primero.")
                else:
                    st.info("No se encontraron emails con adjuntos admitidos.")

            # Mostrar adjuntos descargados como archivos "virtuales"
            imap_adj = st.session_state.get("imap_adjuntos", [])
            if imap_adj:
                st.caption(
                    "Adjuntos listos. Se analizaran junto con los archivos subidos abajo."
                )

    archivos = st.file_uploader(
        "Documentos del expediente (PDF, JPG, PNG, HEIC)",
        type=analizador.extensiones_admitidas(),
        accept_multiple_files=True,
        help="Puedes subir varias fotos y PDF a la vez.",
    )
    # Combinar archivos subidos + adjuntos de email
    imap_adj = st.session_state.get("imap_adjuntos", [])
    archivos_virtuales = [(n, d) for n, d in imap_adj]  # (nombre, bytes)

    items, grupos, modelo_sec = None, None, None
    todos_archivos = list(archivos or [])
    # Archivos virtuales de IMAP se tratan como un archivo adicional por nombre
    if archivos or archivos_virtuales:
        st.markdown("##### Agrupar paginas de un mismo documento")
        st.caption(
            "Pon el **mismo numero de grupo** a las fotos que sean el mismo documento "
            "(p.ej. las 4 fotos de un pasaporte). Por defecto cada archivo va por separado."
        )
        col_grupo = "Grupo (mismo nº = mismo documento)"
        nombres_todos = [a.name for a in todos_archivos] + [n for n, _ in archivos_virtuales]
        df = pd.DataFrame(
            {"Archivo": nombres_todos, col_grupo: list(range(1, len(nombres_todos) + 1))}
        )
        editado = st.data_editor(
            df, disabled=["Archivo"], hide_index=True, use_container_width=True,
            column_config={col_grupo: st.column_config.NumberColumn(min_value=1, step=1, format="%d")},
            key="editor_grupos",
        )
        grupos = {}
        datos_todos = [(a.name, a.getvalue()) for a in todos_archivos] + archivos_virtuales
        for i, (nombre, datos) in enumerate(datos_todos):
            clave = int(editado.iloc[i][col_grupo])
            grupos.setdefault(clave, []).append((nombre, datos))
        items = [grupos[k] for k in sorted(grupos)]

        doble = st.checkbox(
            "Doble verificacion (dos modelos revisan; mas fiable y mas lento)"
        )
        if doble:
            nombres_mod = list(MODELOS)
            idx_sec = 1 if MODELOS[nombres_mod[0]] == modelo else 0
            sec = st.selectbox("Segundo modelo", nombres_mod, index=idx_sec)
            modelo_sec = MODELOS[sec]

        c1, c2, c3 = st.columns(3)
        analizar = c1.button("🔍 Analizar expediente", type="primary", use_container_width=True)
        if c3.button("📊 Comparar tramites", use_container_width=True):
            st.session_state["mostrar_comparador"] = True
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

    # Comparador de tramites
    if st.session_state.get("mostrar_comparador") and items:
        st.session_state["mostrar_comparador"] = False
        _mostrar_comparador(items, tramite_id)

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

        nuevo_eid = None
        datos_cliente_auto = {}
        try:
            nuevo_eid = historial.guardar(tramite_id, solicitante, resultados)
            historial.generar_tareas_automaticas(nuevo_eid, hoy=hoy)
            # Extraer y guardar datos personales detectados en los documentos
            datos_cliente_auto = analizador.extraer_datos_cliente(resultados)
            if datos_cliente_auto:
                # Si el usuario ya tecleo un nombre, respetarlo
                if solicitante and "nombre" not in datos_cliente_auto:
                    datos_cliente_auto["nombre"] = solicitante
                elif solicitante:
                    pass  # el nombre del form tiene prioridad
                historial.actualizar(nuevo_eid, **datos_cliente_auto)
                # Actualizar solicitante con el nombre detectado si no habia uno
                if not solicitante and datos_cliente_auto.get("nombre"):
                    historial.actualizar(nuevo_eid, solicitante=datos_cliente_auto["nombre"])
        except Exception:  # noqa: BLE001
            pass

        st.session_state["resultados"] = resultados
        st.session_state["previews"] = previews
        st.session_state["tramite_id"] = tramite_id
        st.session_state["solicitante"] = solicitante
        st.session_state["hoy"] = hoy
        st.session_state["eid_actual"] = nuevo_eid
        st.session_state["datos_cliente_auto"] = datos_cliente_auto

    if "resultados" in st.session_state:
        # Banner de datos auto-detectados
        dca = st.session_state.get("datos_cliente_auto", {})
        if dca:
            _LABELS_DCA = {
                "nombre": ("👤", "Nombre"),
                "nacionalidad": ("🌍", "Nacionalidad"),
                "fecha_nacimiento": ("🎂", "F. nacimiento"),
                "num_pasaporte": ("🛂", "Pasaporte"),
                "cad_pasaporte": ("⏳", "Cad. pasaporte"),
                "nie": ("🪪", "NIE"),
                "fecha_entrada_espana": ("✈️", "Entrada en España"),
            }
            chips_dca = "".join(
                f"<span style='display:inline-block;background:#2A1D3E;border:1px solid #4A3870;"
                f"border-radius:20px;padding:3px 10px;margin:3px;font-size:0.82rem;color:#C4BAD8;'>"
                f"{ico} <b style='color:#9373B2;'>{lab}:</b> {dca[k]}</span>"
                for k, (ico, lab) in _LABELS_DCA.items() if k in dca
            )
            st.markdown(
                f"<div style='background:#150F23;border:1px solid #4A3870;border-radius:10px;"
                f"padding:10px 14px;margin-bottom:12px;'>"
                f"<div style='font-size:0.85rem;color:#9373B2;font-weight:600;margin-bottom:6px;'>"
                f"✨ Datos detectados automaticamente en los documentos</div>"
                f"{chips_dca}"
                f"<div style='font-size:0.75rem;color:#6B5F82;margin-top:6px;'>"
                f"Guardados en el expediente. Puedes editarlos en Seguimiento → Datos del cliente.</div>"
                f"</div>",
                unsafe_allow_html=True,
            )
        mostrar_resultados(
            st.session_state["resultados"], st.session_state["tramite_id"],
            st.session_state["solicitante"], st.session_state["hoy"],
            previews=st.session_state.get("previews"),
            eid=st.session_state.get("eid_actual"),
        )


# --------------------------------------------------------------------------- #
#  OCR: Analisis sin IA
# --------------------------------------------------------------------------- #
def _pagina_ocr():
    st.markdown(
        "Extrae datos de los documentos usando **OCR** (reconocimiento optico de "
        "caracteres), sin necesidad de clave de API ni conexion a internet. "
        "Funciona mejor con documentos de buena calidad y texto legible. "
        "Para documentos borrosos o complejos, usa la pestaña **Analizar con IA**.",
    )

    ocr_ok, ocr_msg = ocr_analisis.verificar_disponible()
    if not ocr_ok:
        st.error(f"⚠️ El OCR no esta disponible en este servidor.\n\n{ocr_msg}")
        return

    opciones = tramites.lista_tramites_con_icono()
    etiquetas = [n for _, n in opciones]
    idx_def_ocr = 0
    sugerido_ocr = st.session_state.get("tramite_sugerido")
    if sugerido_ocr:
        t_ids_ocr = [t for t, _ in opciones]
        if sugerido_ocr in t_ids_ocr:
            idx_def_ocr = t_ids_ocr.index(sugerido_ocr)

    col_ocr1, col_ocr2 = st.columns([3, 1])
    idx_tramite_ocr = col_ocr1.selectbox(
        "Tramite", range(len(etiquetas)),
        format_func=lambda i: etiquetas[i],
        index=idx_def_ocr,
        key="ocr_tramite",
    )
    tramite_id_ocr = opciones[idx_tramite_ocr][0]
    solicitante_ocr = col_ocr2.text_input("Solicitante (opcional)", key="ocr_sol")

    archivos_ocr = st.file_uploader(
        "Sube los documentos (PDF, JPG, PNG…)",
        type=analizador.extensiones_admitidas(),
        accept_multiple_files=True,
        key="ocr_files",
    )

    if not archivos_ocr:
        st.caption("Sube uno o mas documentos para comenzar.")
        return

    st.info(
        f"{len(archivos_ocr)} archivo(s) cargado(s). "
        "Puedes agrupar varias paginas del mismo documento subiendo varios archivos; "
        "la app los tratara por separado.",
    )

    if not st.button("🔍 Analizar con OCR", type="primary", use_container_width=False, key="ocr_btn"):
        return

    resultados_ocr = []
    barra_ocr = st.progress(0.0, text="Extrayendo texto...")
    for i, archivo in enumerate(archivos_ocr, start=1):
        barra_ocr.progress(i / len(archivos_ocr), text=f"Analizando {archivo.name} ({i}/{len(archivos_ocr)})")
        try:
            res = ocr_analisis.analizar_con_ocr(archivo.name, archivo.getvalue())
        except Exception as exc:  # noqa: BLE001
            res = {
                "tipo_id": "no_identificado", "tipo_nombre": "Error",
                "titular": None, "numero": None, "pais_emision": None,
                "nacionalidad_doc": None, "fecha_nacimiento": None, "sexo": None,
                "fecha_emision": None, "fecha_caducidad": None,
                "fecha_acredita_desde": None,
                "estado": "desconocido", "legibilidad": "mala",
                "incidencias": [f"Error al procesar: {exc}"],
                "resumen": f"Error: {exc}",
                "archivo": archivo.name, "archivos": [archivo.name],
                "_modo": "ocr", "_ocr_texto": "",
            }
        resultados_ocr.append(res)
    barra_ocr.empty()

    # ── Guardar en historial ─────────────────────────────────────────────── #
    eid_ocr = None
    datos_cliente_ocr = {}
    try:
        eid_ocr = historial.guardar(tramite_id_ocr, solicitante_ocr, resultados_ocr)
        historial.generar_tareas_automaticas(eid_ocr)
        datos_cliente_ocr = analizador.extraer_datos_cliente(resultados_ocr)
        if datos_cliente_ocr:
            if not solicitante_ocr and datos_cliente_ocr.get("nombre"):
                historial.actualizar(eid_ocr, solicitante=datos_cliente_ocr["nombre"])
            historial.actualizar(eid_ocr, **datos_cliente_ocr)
    except Exception:  # noqa: BLE001
        pass

    # ── Banner de datos detectados ───────────────────────────────────────── #
    if datos_cliente_ocr:
        _LABELS_OCR = {
            "nombre": ("👤", "Nombre"),
            "nacionalidad": ("🌍", "Nacionalidad"),
            "fecha_nacimiento": ("🎂", "F. nacimiento"),
            "num_pasaporte": ("🛂", "Pasaporte"),
            "cad_pasaporte": ("⏳", "Cad. pasaporte"),
            "nie": ("🪪", "NIE"),
            "fecha_entrada_espana": ("✈️", "Entrada en España"),
        }
        chips_ocr = "".join(
            f"<span style='display:inline-block;background:#1A2A1A;border:1px solid #4A7A4A;"
            f"border-radius:20px;padding:3px 10px;margin:3px;font-size:0.82rem;color:#C4D8C4;'>"
            f"{ico} <b style='color:#6AAF6A;'>{lab}:</b> {datos_cliente_ocr[k]}</span>"
            for k, (ico, lab) in _LABELS_OCR.items() if k in datos_cliente_ocr
        )
        st.markdown(
            f"<div style='background:#0F1F0F;border:1px solid #4A7A4A;border-radius:10px;"
            f"padding:10px 14px;margin-bottom:12px;'>"
            f"<div style='font-size:0.85rem;color:#6AAF6A;font-weight:600;margin-bottom:6px;'>"
            f"✨ Datos extraidos por OCR y guardados en el expediente</div>"
            f"{chips_ocr}</div>",
            unsafe_allow_html=True,
        )

    # ── Resultados por documento ─────────────────────────────────────────── #
    st.subheader("Resultados del analisis OCR")
    nombres_tramite = {tid: t["nombre"] for tid, t in tramites.TRAMITES.items()}
    _ESTADO_COLOR = {
        "vigente": "bz-card-ok", "sin_caducidad": "bz-card-ok",
        "proximo_a_caducar": "bz-card-aviso", "caducado": "bz-card-urgente",
        "desconocido": "bz-card-info", "ilegible": "bz-card-urgente",
    }
    _ESTADO_ICO = {
        "vigente": "✅", "sin_caducidad": "✅",
        "proximo_a_caducar": "🟠", "caducado": "⛔",
        "desconocido": "❓", "ilegible": "🔴",
    }
    for res in resultados_ocr:
        clase = _ESTADO_COLOR.get(res.get("estado", ""), "bz-card-info")
        ico_estado = _ESTADO_ICO.get(res.get("estado", ""), "❓")
        st.markdown(
            f"<div class='bz-list-card {clase}'>"
            f"<span class='bz-card-icono'>{ico_estado}</span>"
            "<div class='bz-card-texto'>"
            f"<div class='bz-card-titulo'>{res.get('tipo_nombre','?')} — {res.get('archivo','')}</div>"
            f"<div class='bz-card-sub'>{res.get('resumen','')}</div>"
            "</div></div>",
            unsafe_allow_html=True,
        )
        if res.get("incidencias"):
            for inc in res["incidencias"]:
                st.warning(f"⚠️ {inc}", icon=None)
        # Mostrar texto OCR extraido en un expander (util para depuracion)
        texto_raw = res.get("_ocr_texto", "")
        if texto_raw:
            with st.expander(f"Texto extraido — {res.get('archivo','')}"):
                st.text(texto_raw)

    # ── Checklist del tramite ────────────────────────────────────────────── #
    st.subheader("Checklist del tramite")
    checklist_ocr, no_id_ocr = analizador.evaluar_expediente(resultados_ocr, tramite_id_ocr)
    _ICONO_CL = {
        "correcto": "✅", "falta": "❌", "caducado": "⛔",
        "proximo_a_caducar": "🟠", "con_incidencias": "⚠️", "falta_opcional": "⬜",
    }
    for fila in checklist_ocr:
        ico_cl = _ICONO_CL.get(fila["estado"], "❓")
        oblig = "**Obligatorio**" if fila["obligatorio"] else "Opcional"
        st.write(f"{ico_cl} {fila['nombre']} — {oblig}")

    if eid_ocr:
        st.success(f"Expediente guardado en el historial (ID: {eid_ocr[:16]}).")
        if st.button("Ver expediente en Seguimiento", key="ocr_ver_seg"):
            st.session_state["seguimiento_eid_sugerido"] = eid_ocr
            st.session_state["_menu_nav"] = "Seguimiento"
            st.rerun()


# --------------------------------------------------------------------------- #
#  Pagina: Tablero (vista Kanban de expedientes por fase)
# --------------------------------------------------------------------------- #
def pagina_tablero():
    st.title("Tablero de expedientes")
    st.markdown(
        '<p class="bz-page-subtitle">Vision visual del flujo de trabajo: cada '
        "expediente aparece en su fase actual, de un vistazo.</p>",
        unsafe_allow_html=True,
    )

    grupos = historial.tablero()
    nombres_tramite = {tid: t["nombre"] for tid, t in tramites.TRAMITES.items()}
    if not any(grupos.values()):
        st.info("Aun no hay expedientes. Revisa uno primero.")
        return

    columnas = st.columns(len(historial.COLUMNAS_TABLERO))
    for col, (clave, titulo) in zip(columnas, historial.COLUMNAS_TABLERO):
        with col:
            elementos = grupos[clave]
            st.markdown(f"##### {titulo}  ·  {len(elementos)}")
            if not elementos:
                st.caption("Sin expedientes en esta fase.")
            for meta in elementos:
                tramite_n = nombres_tramite.get(meta["tramite_id"], meta["tramite_id"])
                icono_t = tramites.icono_tramite(meta["tramite_id"])
                # Progreso documental
                docs_ob = [d for d in tramites.documentos_de(meta["tramite_id"]) if d["obligatorio"]]
                total_ob = len(docs_ob)
                faltan = (meta.get("faltan") or 0) + (meta.get("caducados") or 0)
                ok = max(0, total_ob - faltan)
                pct = round(ok / total_ob * 100) if total_ob else 100
                color_p = "#43A047" if pct == 100 else ("#FB8C00" if pct >= 50 else "#E53935")
                barra_html = (
                    f"<div class='bz-cad-bar-track' style='margin-top:6px;'>"
                    f"<div class='bz-cad-bar-fill' style='width:{pct}%;background:{color_p};'>"
                    f"</div></div>"
                    f"<div style='font-size:0.72rem;color:#6B5F82;margin-top:2px;'>"
                    f"{ok}/{total_ob} docs · {pct}%</div>"
                )
                st.markdown(
                    f"<div class='bz-ficha-dato'>"
                    f"<span class='bz-ficha-etiqueta'>{icono_t} {tramite_n}</span>"
                    f"<span class='bz-ficha-valor'>{meta.get('solicitante') or 'sin nombre'}</span>"
                    f"<span style='color:#6B5F82;font-size:0.78rem;'>{meta['fecha'][:10]}</span>"
                    f"{barra_html}</div>",
                    unsafe_allow_html=True,
                )
                if st.button("Ver seguimiento", key=f"tab_{clave}_{meta['id']}", use_container_width=True):
                    st.session_state["_menu_nav"] = "Seguimiento"
                    st.session_state["seguimiento_eid_sugerido"] = meta["id"]
                    st.rerun()


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
            date.fromisoformat(registro["fecha"][:10]), prefijo=f"hist_{sel}", eid=sel,
        )


def _tabla_historial(registros, nombres_tramite):
    filas = []
    for r in registros:
        docs_ob = [d for d in tramites.documentos_de(r["tramite_id"]) if d["obligatorio"]]
        total_ob = len(docs_ob)
        faltan = (r.get("faltan") or 0) + (r.get("caducados") or 0)
        ok = max(0, total_ob - faltan)
        pct = round(ok / total_ob * 100) if total_ob else 100
        filas.append({
            "Fecha": r["fecha"].replace("T", " "),
            "Solicitante": r["solicitante"] or "-",
            "Tramite": nombres_tramite.get(r["tramite_id"], r["tramite_id"]),
            "Progreso": pct,
            "Estado": "✅ Listo" if r["listo"] else "⛔ Incompleto",
            "Faltan": r.get("faltan", 0),
            "Caducados": r.get("caducados", 0),
        })
    tabla = pd.DataFrame(filas)
    st.dataframe(
        tabla,
        hide_index=True,
        use_container_width=True,
        column_config={
            "Progreso": st.column_config.ProgressColumn(
                "Progreso", min_value=0, max_value=100, format="%d%%"
            )
        },
    )


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

    cfg = config.cargar_config()
    dias_notif = int(cfg.get("notif_caducidad_dias", 30) or 30)
    ultima_notif = cfg.get("notif_caducidad_ultima", "")

    with st.expander("📧 Enviar avisos por email a los clientes"):
        st.caption(
            "Envia un email a los clientes que tienen documentos que caducan pronto. "
            "Solo se envia a expedientes con email del cliente registrado (Seguimiento)."
        )
        if ultima_notif:
            st.caption(f"Ultimo envio: {ultima_notif}")
        d_notif = st.number_input(
            "Avisar a clientes con documentos que caducan en menos de (dias)",
            min_value=1, max_value=365, value=dias_notif, step=15,
        )
        if st.button("📤 Enviar avisos ahora", type="primary"):
            gestoria = config.cargar_config()
            env, fall, s_email = comunicacion.enviar_avisos_caducidad(gestoria, gestoria, int(d_notif))
            cfg["notif_caducidad_dias"] = int(d_notif)
            cfg["notif_caducidad_ultima"] = date.today().isoformat()
            config.guardar_config(cfg)
            if env or fall or s_email:
                st.success(
                    f"Enviados: {env} · Fallidos: {fall} · Sin email registrado: {s_email}"
                )
            else:
                st.info("No hay documentos que caduquen en ese periodo.")

    dias = st.slider("Mostrar lo que caduca en los proximos (dias)", 0, 365, 90, step=15)
    avisos = historial.proximas_caducidades(dias)
    if not avisos:
        st.success("No hay documentos caducados ni proximos a caducar en el historial.")
        return

    vencidos = [a for a in avisos if a["vencido"]]
    semana = [a for a in avisos if not a["vencido"] and a["dias_restantes"] <= 7]
    resto = [a for a in avisos if not a["vencido"] and a["dias_restantes"] > 7]

    chips = (
        f"<div class='bz-hero-chip'><span class='bz-hero-icono'>⛔</span>"
        f"<div><div class='bz-hero-num'>{len(vencidos)}</div>"
        f"<div class='bz-hero-label'>Ya vencidos</div></div></div>"
        f"<div class='bz-hero-chip'><span class='bz-hero-icono'>🟠</span>"
        f"<div><div class='bz-hero-num'>{len(semana)}</div>"
        f"<div class='bz-hero-label'>Caducan en 7 dias</div></div></div>"
        f"<div class='bz-hero-chip'><span class='bz-hero-icono'>📋</span>"
        f"<div><div class='bz-hero-num'>{len(avisos)}</div>"
        f"<div class='bz-hero-label'>Total en {dias} dias</div></div></div>"
    )
    st.markdown(
        "<div class='bz-hero-hoy'>"
        "<div><div class='bz-hero-titulo'>📑 Resumen de caducidades</div>"
        f"<div class='bz-hero-sub'>Documentos analizados a fecha de hoy</div></div>"
        f"{chips}</div>",
        unsafe_allow_html=True,
    )

    def _tarjeta_caducidad(av):
        vencido = av["vencido"]
        dias_r = av["dias_restantes"]
        clase = "bz-card-urgente" if vencido else ("bz-card-aviso" if dias_r <= 7 else "bz-card-info")
        icono = "⛔" if vencido else ("🟠" if dias_r <= 7 else "🟡")
        texto = "Ya ha caducado" if vencido else f"Caduca en {dias_r} dia(s)"
        periodo = max(dias, 1)
        pct = 0 if vencido else max(4, min(100, round(100 - (dias_r / periodo) * 100)))
        color = "#E53935" if vencido or dias_r <= 3 else ("#FB8C00" if dias_r <= 10 else "#FDD835")
        st.markdown(
            f"<div class='bz-list-card {clase}'>"
            f"<span class='bz-card-icono'>{icono}</span>"
            "<div class='bz-card-texto'>"
            f"<div class='bz-card-titulo'>{av['documento']} — {av['solicitante']}</div>"
            f"<div class='bz-card-sub'>{av['tramite']} · {texto} · vence el {av['fecha_caducidad']}</div>"
            f"<div class='bz-cad-bar-track'><div class='bz-cad-bar-fill' "
            f"style='width:{pct}%; background:{color};'></div></div>"
            "</div></div>",
            unsafe_allow_html=True,
        )

    if vencidos:
        st.error(f"⛔ {len(vencidos)} documento(s) ya vencido(s) — conviene avisar cuanto antes.")
        st.subheader("⛔ Ya vencidos")
        for av in vencidos:
            _tarjeta_caducidad(av)

    if semana:
        st.subheader("🟠 Caducan en los proximos 7 dias")
        for av in semana:
            _tarjeta_caducidad(av)

    if resto:
        st.subheader("🟡 Caducan mas adelante")
        for av in resto:
            _tarjeta_caducidad(av)

    with st.expander("📊 Ver como tabla"):
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

    opciones = tramites.lista_tramites_con_icono()
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
                "Icono": tramites.icono_documento(d["id"]),
                "ID": d["id"], "Documento": d["nombre"],
                "Obligatorio": bool(d["obligatorio"]), "Caduca": bool(d.get("caduca", False)),
                "Notas": d.get("notas", ""),
            }
            for d in tramite["documentos"]
        ]
    )
    if df.empty:
        df = pd.DataFrame(
            [{"Icono": "📄", "ID": "", "Documento": "", "Obligatorio": True, "Caduca": False, "Notas": ""}]
        )
    editado = st.data_editor(
        df, num_rows="dynamic", hide_index=True, use_container_width=True,
        column_config={
            "Icono": st.column_config.TextColumn(disabled=True, help="Se asigna automaticamente segun el ID del documento"),
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
#  Pagina: Plantillas de mensajes
# --------------------------------------------------------------------------- #
def pagina_plantillas():
    st.title("Plantillas de mensajes")
    st.markdown(
        '<p class="bz-page-subtitle">Textos reutilizables para situaciones '
        "habituales con el cliente. Usa "
        "<code>{solicitante}</code>, <code>{tramite}</code>, "
        "<code>{numero_expediente}</code> y <code>{gestoria}</code> como "
        "comodines: se sustituyen automaticamente al usarlas en Seguimiento.</p>",
        unsafe_allow_html=True,
    )

    plantillas = config.cargar_plantillas()
    df = pd.DataFrame(
        [
            {"ID": pid, "Nombre": p["nombre"], "Texto": p["texto"]}
            for pid, p in plantillas.items()
        ]
    )
    if df.empty:
        df = pd.DataFrame([{"ID": "", "Nombre": "", "Texto": ""}])

    editado = st.data_editor(
        df, num_rows="dynamic", hide_index=True, use_container_width=True,
        column_config={"Texto": st.column_config.TextColumn(width="large")},
        key="editor_plantillas",
    )

    c1, c2 = st.columns(2)
    if c1.button("💾 Guardar plantillas", type="primary"):
        nuevas = {}
        for _, fila in editado.iterrows():
            nombre = str(fila["Nombre"]).strip()
            texto = str(fila["Texto"]).strip()
            if not nombre or not texto:
                continue
            pid = str(fila["ID"]).strip() or _slug(nombre)
            nuevas[pid] = {"nombre": nombre, "texto": texto}
        config.guardar_plantillas(nuevas)
        st.success("Plantillas guardadas.")
        st.rerun()
    if c2.button("↩️ Restablecer por defecto"):
        config.restablecer_plantillas()
        st.success("Plantillas restablecidas a los valores por defecto.")
        st.rerun()

    # ── Envío masivo ──────────────────────────────────────────────────────── #
    st.divider()
    st.subheader("📤 Envío masivo a clientes")
    st.caption(
        "Selecciona una plantilla y los expedientes destinatarios. "
        "Se genera un enlace de WhatsApp para cada uno, listo para enviar."
    )
    plantillas_act = config.cargar_plantillas()
    if not plantillas_act:
        st.info("No hay plantillas disponibles.")
    else:
        registros_em = historial.listar()
        if not registros_em:
            st.info("No hay expedientes en el historial.")
        else:
            gestoria_em = config.cargar_config()
            p_ids = list(plantillas_act)
            sel_p = st.selectbox(
                "Plantilla", p_ids,
                format_func=lambda pid: plantillas_act[pid]["nombre"],
                key="masivo_plant",
            )
            opciones_em = {
                r["id"]: f"{r['solicitante'] or 'sin nombre'} — {r['fecha'][:10]}"
                for r in registros_em
            }
            seleccionados = st.multiselect(
                "Expedientes destinatarios",
                list(opciones_em),
                format_func=lambda i: opciones_em[i],
                key="masivo_eids",
            )
            if seleccionados:
                if st.button("🔗 Generar enlaces de WhatsApp", key="masivo_gen"):
                    st.session_state["masivo_links"] = []
                    for eid_m in seleccionados:
                        reg_m = historial.cargar(eid_m)
                        if not reg_m:
                            continue
                        ctx = {
                            "solicitante": reg_m.get("solicitante") or "cliente",
                            "tramite": tramites.TRAMITES.get(reg_m["tramite_id"], {}).get("nombre", ""),
                            "numero_expediente": reg_m.get("numero_expediente") or "(sin asignar)",
                            "gestoria": gestoria_em.get("nombre_gestoria", ""),
                        }
                        texto_m = _rellenar_plantilla(plantillas_act[sel_p]["texto"], ctx)
                        tel_m = reg_m.get("telefono", "")
                        enlace_m = comunicacion.enlace_whatsapp(texto_m, tel_m)
                        st.session_state["masivo_links"].append({
                            "nombre": reg_m.get("solicitante") or eid_m,
                            "texto": texto_m,
                            "enlace": enlace_m,
                        })

                for link in st.session_state.get("masivo_links", []):
                    with st.expander(f"📲 {link['nombre']}"):
                        st.text_area("Mensaje", value=link["texto"], height=80,
                                     key=f"masivo_txt_{link['nombre']}", disabled=True)
                        st.markdown(f"[Abrir en WhatsApp]({link['enlace']})")


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
def mostrar_resultados(resultados, tramite_id, solicitante, hoy, prefijo="rev", previews=None, eid=None):
    firma_cliente = historial.obtener_firma(eid) if eid else None
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
        badge, etiqueta = _BADGE.get(fila["estado"], ("•", fila["estado"]))
        icono_doc = tramites.icono_documento(fila["id"])
        oblig = " · obligatorio" if fila["obligatorio"] else " · opcional"
        with st.expander(f"{badge} {icono_doc} {fila['nombre']} — {etiqueta}{oblig}"):
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
                checklist, tramite_id, solicitante=solicitante, gestoria=gestoria, hoy=hoy,
                firma_imagen=firma_cliente,
            )
            st.download_button(
                "⬇️ Carta (.docx)", data=req_docx,
                file_name=f"requerimiento_{nombre_base}_{fecha}.docx",
                mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                use_container_width=True, key=f"{prefijo}_req_docx",
            )
        except Exception as exc:  # noqa: BLE001
            st.caption(f"Carta Word no disponible: {exc}")

    # Formularios oficiales pre-rellenados
    st.subheader("Formularios oficiales (pre-rellenados)")
    st.caption(
        "Campos rellenados automaticamente con los datos extraidos. "
        "Revisa y completa antes de presentar."
    )
    f1, f2 = st.columns(2)
    with f1:
        try:
            ex01 = formularios.generar_ex01(
                resultados, solicitante=solicitante, tramite_id=tramite_id, gestoria=gestoria
            )
            st.download_button(
                "⬇️ EX-01 (circunstancias excepcionales)", data=ex01,
                file_name=f"EX01_{nombre_base}_{fecha}.pdf", mime="application/pdf",
                use_container_width=True, key=f"{prefijo}_ex01",
            )
        except Exception as exc:  # noqa: BLE001
            st.caption(f"EX-01 no disponible: {exc}")
    with f2:
        try:
            ex03 = formularios.generar_ex03(
                resultados, solicitante=solicitante, tramite_id=tramite_id, gestoria=gestoria
            )
            st.download_button(
                "⬇️ EX-03 (renovacion residencia)", data=ex03,
                file_name=f"EX03_{nombre_base}_{fecha}.pdf", mime="application/pdf",
                use_container_width=True, key=f"{prefijo}_ex03",
            )
        except Exception as exc:  # noqa: BLE001
            st.caption(f"EX-03 no disponible: {exc}")

    # Ficha estructurada (Excel / CSV)
    st.subheader("Ficha del expediente (datos)")
    meta_ficha = {"solicitante": solicitante, "tramite_id": tramite_id, "fecha": fecha}
    datos_ficha = ficha.construir_ficha(resultados, meta_ficha)
    _ICONOS_FICHA = {
        "Solicitante": "🧑", "Titular (documentos)": "🪪", "Nº de pasaporte": "🛂",
        "Pais/nacionalidad": "🌍", "NIE": "🔢", "Nº de expediente": "📁",
        "Tramite": tramites.icono_tramite(tramite_id), "Fecha de revision": "📅",
        "Documentos aportados": "📎",
    }
    fc1, fc2 = st.columns(2)
    for i, (clave, valor) in enumerate(datos_ficha.items()):
        col = fc1 if i % 2 == 0 else fc2
        icono = _ICONOS_FICHA.get(clave, "•")
        col.markdown(
            f"<div class='bz-ficha-dato'><span class='bz-ficha-icono'>{icono}</span>"
            f"<span class='bz-ficha-etiqueta'>{clave}</span><br>"
            f"<span class='bz-ficha-valor'>{valor or '—'}</span></div>",
            unsafe_allow_html=True,
        )
    st.markdown("")
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
                                                           gestoria=gestoria, hoy=hoy,
                                                           firma_imagen=firma_cliente),
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
    ids = list(etiquetas)
    sugerido_eid = st.session_state.pop("seguimiento_eid_sugerido", None)
    idx_def = ids.index(sugerido_eid) if sugerido_eid in ids else 0
    eid = st.selectbox("Expediente", ids, index=idx_def, format_func=lambda i: etiquetas[i])
    reg = historial.cargar(eid)
    if not reg:
        return

    # ── Datos del cliente (alta rapida) ─────────────────────────────────────── #
    _CAMPOS_CLIENTE = [
        ("nombre",               "👤", "Nombre completo"),
        ("fecha_nacimiento",     "🎂", "Fecha de nacimiento"),
        ("nacionalidad",         "🌍", "Nacionalidad"),
        ("num_pasaporte",        "🛂", "Nº de pasaporte"),
        ("cad_pasaporte",        "⏳", "Caducidad del pasaporte"),
        ("fecha_entrada_espana", "✈️", "Entrada en España"),
        ("telefono",             "📞", "Teléfono"),
        ("email_cliente",        "📧", "Email"),
        ("direccion",            "🏠", "Dirección"),
        ("ciudad",               "🏙️", "Ciudad"),
        ("empleador",            "💼", "Empleador"),
        ("fecha_contrato",       "📄", "Fecha de contrato"),
        ("tipo_contrato",        "🗂️", "Tipo de contrato"),
        ("notas",                "📝", "Notas"),
    ]
    campos_rellenos = [(k, ico, lab) for k, ico, lab in _CAMPOS_CLIENTE
                       if reg.get(k) not in (None, "")]

    if campos_rellenos or True:  # siempre mostramos el bloque para poder editar
        with st.expander("👤 Datos del cliente", expanded=bool(campos_rellenos)):
            if campos_rellenos:
                fc1, fc2 = st.columns(2)
                for i, (k, ico, lab) in enumerate(campos_rellenos):
                    col = fc1 if i % 2 == 0 else fc2
                    val = reg.get(k, "")
                    # Notas ocupan ancho completo
                    if k == "notas":
                        st.markdown(
                            f"<div class='bz-ficha-dato'>"
                            f"<span class='bz-ficha-icono'>{ico}</span>"
                            f"<span class='bz-ficha-etiqueta'>{lab}</span><br>"
                            f"<span class='bz-ficha-valor'>{val}</span></div>",
                            unsafe_allow_html=True,
                        )
                    else:
                        col.markdown(
                            f"<div class='bz-ficha-dato'>"
                            f"<span class='bz-ficha-icono'>{ico}</span>"
                            f"<span class='bz-ficha-etiqueta'>{lab}</span><br>"
                            f"<span class='bz-ficha-valor'>{val}</span></div>",
                            unsafe_allow_html=True,
                        )
                st.markdown("")
            with st.form(f"edit_cliente_{eid}"):
                st.markdown("###### ✏️ Editar datos del cliente")
                e1, e2, e3 = st.columns(3)
                v_nombre   = e1.text_input("Nombre completo",       value=reg.get("nombre", "") or reg.get("solicitante", ""), key=f"ec_nombre_{eid}")
                v_fnac     = e2.text_input("Fecha de nacimiento",   value=reg.get("fecha_nacimiento", ""), key=f"ec_fnac_{eid}")
                v_nac      = e3.text_input("Nacionalidad",          value=reg.get("nacionalidad", ""), key=f"ec_nac_{eid}")
                e4, e5, e6 = st.columns(3)
                v_pas      = e4.text_input("Nº pasaporte",          value=reg.get("num_pasaporte", ""), key=f"ec_pas_{eid}")
                v_cadpas   = e5.text_input("Caducidad pasaporte",   value=reg.get("cad_pasaporte", ""), key=f"ec_cadpas_{eid}")
                v_fent     = e6.text_input("Entrada en España",     value=reg.get("fecha_entrada_espana", ""), key=f"ec_fent_{eid}")
                e7, e8 = st.columns(2)
                v_tel      = e7.text_input("Teléfono",              value=reg.get("telefono", ""), key=f"ec_tel_{eid}")
                v_email    = e8.text_input("Email",                 value=reg.get("email_cliente", ""), key=f"ec_email_{eid}")
                e9, e10 = st.columns([3, 1])
                v_dir      = e9.text_input("Dirección",             value=reg.get("direccion", ""), key=f"ec_dir_{eid}")
                v_ciudad   = e10.text_input("Ciudad",               value=reg.get("ciudad", ""), key=f"ec_ciudad_{eid}")
                e11, e12, e13 = st.columns(3)
                v_emp      = e11.text_input("Empleador",            value=reg.get("empleador", ""), key=f"ec_emp_{eid}")
                v_fcont    = e12.text_input("Fecha contrato",       value=reg.get("fecha_contrato", ""), key=f"ec_fcont_{eid}")
                v_tcont    = e13.text_input("Tipo contrato",        value=reg.get("tipo_contrato", ""), key=f"ec_tcont_{eid}")
                v_notas    = st.text_area("Notas",                  value=reg.get("notas", ""), height=70, key=f"ec_notas_{eid}")
                if st.form_submit_button("💾 Guardar datos del cliente", type="primary"):
                    nombre_limpio = v_nombre.strip()
                    historial.actualizar(
                        eid,
                        nombre=nombre_limpio,
                        solicitante=nombre_limpio or reg.get("solicitante", ""),
                        fecha_nacimiento=v_fnac.strip(),
                        nacionalidad=v_nac.strip(),
                        num_pasaporte=v_pas.strip(),
                        cad_pasaporte=v_cadpas.strip(),
                        fecha_entrada_espana=v_fent.strip(),
                        telefono=v_tel.strip(),
                        email_cliente=v_email.strip(),
                        direccion=v_dir.strip(),
                        ciudad=v_ciudad.strip(),
                        empleador=v_emp.strip(),
                        fecha_contrato=v_fcont.strip(),
                        tipo_contrato=v_tcont.strip(),
                        notas=v_notas.strip(),
                    )
                    st.success("Datos del cliente guardados.")
                    st.rerun()

    st.markdown("##### Datos de presentacion")
    c1, c2, c3 = st.columns(3)
    numero = c1.text_input("Nº de expediente", value=reg.get("numero_expediente", ""))
    nie = c2.text_input("NIE", value=reg.get("nie", ""))
    email_cliente = c3.text_input(
        "Email del cliente (para avisos)", value=reg.get("email_cliente", ""),
        help="Se usa para enviar avisos automaticos de caducidad."
    )
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
        historial.actualizar(eid, email_cliente=email_cliente.strip())
        st.success("Datos guardados.")
        st.rerun()
    if b2.button("🔒 Anonimizar (RGPD)"):
        historial.anonimizar(eid)
        st.success("Datos personales del expediente eliminados.")
        st.rerun()

    # Portal de estado para el cliente
    st.markdown("##### 🌐 Portal de estado para el cliente")
    st.caption(
        "Genera un HTML que puedes enviar al cliente (por email o WhatsApp). "
        "Muestra el estado del expediente, documentos pendientes y el historial."
    )
    _IDIOMAS_PORTAL = {
        "es": "🇪🇸 Español",
        "ar": "🇲🇦 Árabe",
        "ro": "🇷🇴 Rumano",
        "en": "🇬🇧 Inglés",
        "zh": "🇨🇳 Chino",
    }
    idioma_sel = st.selectbox(
        "Idioma del portal",
        list(_IDIOMAS_PORTAL.keys()),
        format_func=lambda k: _IDIOMAS_PORTAL[k],
        key=f"portal_idioma_{eid}",
    )
    _TRADUCCIONES_PORTAL = {
        "es": {},
        "ar": {
            "Estado de tu expediente": "حالة ملفك",
            "Tramite": "الإجراء",
            "Documentos": "الوثائق",
            "Pendiente": "قيد الانتظار",
            "Aprobado": "موافق عليه",
            "Denegado": "مرفوض",
            "Listo para presentar": "جاهز للتقديم",
            "Falta": "مفقود",
        },
        "ro": {
            "Estado de tu expediente": "Starea dosarului tău",
            "Tramite": "Procedură",
            "Documentos": "Documente",
            "Pendiente": "În așteptare",
            "Aprobado": "Aprobat",
            "Denegado": "Respins",
            "Listo para presentar": "Gata de depus",
            "Falta": "Lipsește",
        },
        "en": {
            "Estado de tu expediente": "Your case status",
            "Tramite": "Procedure",
            "Documentos": "Documents",
            "Pendiente": "Pending",
            "Aprobado": "Approved",
            "Denegado": "Denied",
            "Listo para presentar": "Ready to submit",
            "Falta": "Missing",
        },
        "zh": {
            "Estado de tu expediente": "您的案件状态",
            "Tramite": "程序",
            "Documentos": "文件",
            "Pendiente": "待处理",
            "Aprobado": "已批准",
            "Denegado": "已拒绝",
            "Listo para presentar": "准备提交",
            "Falta": "缺少",
        },
    }

    if st.button("🌐 Generar portal del cliente", key=f"gen_portal_{eid}", use_container_width=False):
        try:
            checklist_p, _ = analizador.evaluar_expediente(reg.get("resultados", []), reg["tramite_id"])
            tramite_n = tramites.TRAMITES.get(reg["tramite_id"], {}).get("nombre", reg["tramite_id"])
            html_portal = portal.generar_html(reg, checklist_p, tramite_n)
            # Aplicar traducciones al HTML si el idioma no es español
            traducciones = _TRADUCCIONES_PORTAL.get(idioma_sel, {})
            for es_txt, trad_txt in traducciones.items():
                html_portal = html_portal.replace(es_txt, trad_txt)
            token = portal.obtener_o_crear_token(eid)
            st.download_button(
                "⬇️ Descargar portal (.html)",
                data=html_portal.encode("utf-8"),
                file_name=f"estado_{eid[:12]}_{idioma_sel}.html",
                mime="text/html",
                key=f"portal_{eid}",
            )
            st.caption(f"Token de acceso: `{token}` (guardado en el expediente).")
        except Exception as exc:  # noqa: BLE001
            st.error(f"No se pudo generar el portal: {exc}")

    # Mensajes rapidos a partir de plantillas reutilizables ---------------------
    st.markdown("##### Mensajes rapidos")
    st.caption(
        "Elige una plantilla (editable en 'Plantillas') y se rellena sola con los "
        "datos de este expediente, lista para copiar o enviar por WhatsApp."
    )
    plantillas_msg = config.cargar_plantillas()
    if plantillas_msg:
        gestoria_msg = config.cargar_config()
        ids_plantilla = list(plantillas_msg)
        sel_plantilla = st.selectbox(
            "Plantilla", ids_plantilla,
            format_func=lambda pid: plantillas_msg[pid]["nombre"], key=f"plant_sel_{eid}",
        )
        contexto_msg = {
            "solicitante": reg.get("solicitante") or "cliente",
            "tramite": tramites.TRAMITES.get(reg["tramite_id"], {}).get("nombre", reg["tramite_id"]),
            "numero_expediente": reg.get("numero_expediente") or "(sin asignar)",
            "gestoria": gestoria_msg.get("nombre_gestoria", ""),
        }
        texto_rellenado = _rellenar_plantilla(plantillas_msg[sel_plantilla]["texto"], contexto_msg)
        st.text_area("Mensaje", value=texto_rellenado, height=140, key=f"plant_txt_{eid}")
        tel_msg = st.text_input("Telefono del cliente (opcional, para abrir en WhatsApp)", key=f"plant_tel_{eid}")
        st.markdown(f"[📲 Abrir en WhatsApp]({comunicacion.enlace_whatsapp(texto_rellenado, tel_msg)})")
    else:
        st.caption("No hay plantillas disponibles. Crea alguna en la pagina 'Plantillas'.")

    # Firma del cliente (constancia visual de conformidad) ----------------------
    st.markdown("##### Firma del cliente")
    st.caption(
        "Sube una foto o escaneo de la firma del cliente (en papel o tableta). "
        "Se incorporara a la carta de requerimiento como constancia de conformidad."
    )
    firma_actual = historial.obtener_firma(eid)
    if firma_actual:
        st.image(firma_actual, caption="Firma guardada", width=240)
        if st.button("🗑️ Eliminar firma", key=f"firma_del_{eid}"):
            historial.eliminar_firma(eid)
            st.success("Firma eliminada.")
            st.rerun()
    else:
        archivo_firma = st.file_uploader(
            "Imagen de la firma (PNG o JPG)", type=["png", "jpg", "jpeg"], key=f"firma_up_{eid}"
        )
        if archivo_firma and st.button("💾 Guardar firma", key=f"firma_save_{eid}"):
            ext = archivo_firma.name.rsplit(".", 1)[-1].lower()
            historial.guardar_firma(eid, archivo_firma.getvalue(), ext)
            st.success("Firma guardada. Se incluira en la proxima carta generada.")
            st.rerun()

    # ── Honorarios ─────────────────────────────────────────────────────────── #
    st.markdown("##### 💶 Honorarios")
    hon = reg.get("honorarios") or {}
    h1, h2, h3 = st.columns(3)
    imp_v  = h1.number_input("Importe acordado (€)", min_value=0.0, step=50.0,
                              value=float(hon.get("importe", 0)), key=f"hon_imp_{eid}")
    cob_v  = h2.number_input("Cobrado (€)",           min_value=0.0, step=50.0,
                              value=float(hon.get("cobrado", 0)), key=f"hon_cob_{eid}")
    conc_v = h3.text_input("Concepto / notas",        value=hon.get("concepto", ""), key=f"hon_conc_{eid}")
    pendiente_hon = round(imp_v - cob_v, 2)
    if pendiente_hon > 0:
        st.warning(f"Pendiente de cobro: **{pendiente_hon:.2f} €**")
    elif imp_v > 0:
        st.success("Honorarios completamente cobrados.")
    if st.button("💾 Guardar honorarios", key=f"hon_save_{eid}"):
        historial.guardar_honorarios(eid, imp_v, cob_v, conc_v)
        st.success("Honorarios guardados.")
        st.rerun()

    # ── Documentos descargables ────────────────────────────────────────────── #
    st.markdown("##### 📥 Documentos descargables")
    gestoria_dl = config.cargar_config()
    dc1, dc2, dc3, dc4 = st.columns(4)
    try:
        ficha_bytes = informe.generar_ficha_completa_pdf(reg, gestoria_dl)
        dc1.download_button(
            "🖨️ Ficha PDF",
            data=ficha_bytes,
            file_name=f"ficha_{eid[:12]}.pdf",
            mime="application/pdf",
            key=f"ficha_dl_{eid}",
            use_container_width=True,
        )
    except Exception as exc_fi:
        dc1.caption(f"Ficha: {exc_fi}")
    try:
        encargo_bytes = informe.generar_hoja_encargo_docx(reg, gestoria_dl)
        dc2.download_button(
            "📝 Hoja encargo",
            data=encargo_bytes,
            file_name=f"encargo_{eid[:12]}.docx",
            mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            key=f"encargo_dl_{eid}",
            use_container_width=True,
        )
    except Exception as exc_en:
        dc2.caption(f"Encargo: {exc_en}")
    try:
        presup_bytes = informe.generar_presupuesto_pdf(reg, gestoria_dl)
        dc3.download_button(
            "🧾 Presupuesto PDF",
            data=presup_bytes,
            file_name=f"presupuesto_{eid[:12]}.pdf",
            mime="application/pdf",
            key=f"presup_dl_{eid}",
            use_container_width=True,
        )
    except Exception as exc_pr:
        dc3.caption(f"Presupuesto: {exc_pr}")
    # Duplicar expediente
    if dc4.button("📋 Duplicar expediente", key=f"dup_btn_{eid}", use_container_width=True):
        st.session_state[f"dup_show_{eid}"] = True
    if st.session_state.get(f"dup_show_{eid}"):
        with st.form(f"dup_form_{eid}"):
            st.caption("Elige el tramite para el nuevo expediente (los datos personales se copian).")
            t_ids = list(tramites.TRAMITES.keys())
            nuevo_t = st.selectbox(
                "Nuevo tramite",
                t_ids,
                format_func=lambda tid: tramites.TRAMITES[tid]["nombre"],
                key=f"dup_t_{eid}",
            )
            if st.form_submit_button("✅ Crear duplicado"):
                nuevo_eid = historial.duplicar(eid, nuevo_t)
                st.success(f"Expediente duplicado creado: {nuevo_eid[:16]}")
                st.session_state[f"dup_show_{eid}"] = False
                st.session_state["seguimiento_eid_sugerido"] = nuevo_eid
                st.session_state["_menu_nav"] = "Seguimiento"
                st.rerun()

    # ── Registro de comunicaciones ─────────────────────────────────────────── #
    st.markdown("##### 💬 Comunicaciones con el cliente")
    comunicaciones = reg.get("comunicaciones", [])
    if comunicaciones:
        for com in reversed(comunicaciones[-10:]):
            icono_com = {"whatsapp": "📲", "email": "📧", "sms": "💬", "llamada": "📞"}.get(
                com.get("canal", ""), "💬"
            )
            st.markdown(
                f"<div class='bz-list-card bz-card-info'>"
                f"<span class='bz-card-icono'>{icono_com}</span>"
                "<div class='bz-card-texto'>"
                f"<div class='bz-card-titulo'>{com.get('texto','')[:120]}</div>"
                f"<div class='bz-card-sub'>{com.get('canal','').capitalize()} · {com.get('fecha','')[:16]}</div>"
                "</div></div>",
                unsafe_allow_html=True,
            )
    else:
        st.caption("Sin comunicaciones registradas.")
    with st.form(f"com_{eid}"):
        com_cols = st.columns([2, 4])
        canal_sel = com_cols[0].selectbox(
            "Canal", ["whatsapp", "email", "sms", "llamada", "otro"], key=f"com_canal_{eid}"
        )
        texto_com = com_cols[1].text_input("Texto del mensaje enviado", key=f"com_txt_{eid}")
        if st.form_submit_button("📤 Registrar comunicacion") and texto_com.strip():
            historial.registrar_comunicacion(eid, canal_sel, texto_com.strip())
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
        # Siempre renderizamos el botón (DOM estable), disabled cuando ya está hecha
        if cols[1].button("Hecha", key=f"t_{eid}_{i}", disabled=bool(tarea.get("hecha"))):
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
        # Auto-completar datos del cliente con lo detectado en los nuevos docs
        datos_nuevos = analizador.extraer_datos_cliente(resultados_nuevos)
        reg_actualizado = historial.cargar(eid)
        if datos_nuevos and reg_actualizado:
            # Solo rellenar campos vacíos (no sobrescribir los ya introducidos)
            a_rellenar = {
                k: v for k, v in datos_nuevos.items()
                if not reg_actualizado.get(k)
            }
            if a_rellenar:
                historial.actualizar(eid, **a_rellenar)
                campos_txt = ", ".join(a_rellenar.keys())
                st.success(
                    f"Documentos anadidos y datos del cliente actualizados automaticamente: "
                    f"{campos_txt}."
                )
            else:
                st.success("Documentos anadidos. Las versiones anteriores se han archivado.")
        else:
            st.success("Documentos anadidos. Las versiones anteriores se han archivado.")
        st.rerun()


# --------------------------------------------------------------------------- #
#  Pagina: Calendario de tareas
# --------------------------------------------------------------------------- #
def pagina_citas():
    st.title("Agenda de citas previas")
    st.markdown(
        '<p class="bz-page-subtitle">Citas en oficinas de extranjeria, SEPE, '
        "comisarias y notarias. El dashboard te avisa cuando se acerca la fecha.</p>",
        unsafe_allow_html=True,
    )

    registros_citas = historial.listar()
    opciones_exp = {"": "— Sin expediente asociado —"}
    opciones_exp.update({
        r["id"]: f"{r['solicitante'] or 'sin nombre'} · {r['fecha'][:10]}"
        for r in registros_citas
    })

    with st.expander("➕ Nueva cita", expanded=not citas.listar()):
        with st.form("nueva_cita"):
            nc1, nc2, nc3 = st.columns(3)
            fecha_c  = nc1.date_input("Fecha *", key="nc_fecha")
            hora_c   = nc2.text_input("Hora (HH:MM)", placeholder="10:30", key="nc_hora")
            tipo_c   = nc3.selectbox("Tipo de oficina", citas.TIPOS_OFICINA, key="nc_tipo")
            nc4, nc5 = st.columns(2)
            oficina_c = nc4.text_input("Nombre / dirección de la oficina", key="nc_oficina")
            reserva_c = nc5.text_input("Nº de reserva / referencia", key="nc_reserva")
            exp_c = st.selectbox(
                "Expediente asociado (opcional)", list(opciones_exp),
                format_func=lambda i: opciones_exp[i], key="nc_exp",
            )
            notas_c = st.text_input("Notas", key="nc_notas")
            if st.form_submit_button("✅ Guardar cita", type="primary"):
                citas.guardar_cita(
                    exp_c or "", fecha_c.isoformat(), hora_c.strip(),
                    tipo_c, oficina_c.strip(), reserva_c.strip(), notas_c.strip(),
                )
                st.success("Cita guardada.")
                st.rerun()

    todas = citas.listar()
    if not todas:
        st.info("No hay citas registradas. Usa el formulario de arriba para añadir una.")
        return

    hoy_s = date.today().isoformat()
    pendientes = [c for c in todas if not c.get("hecha") and c.get("fecha", "") >= hoy_s]
    pasadas    = [c for c in todas if c.get("hecha") or c.get("fecha", "") < hoy_s]

    nombres_tramite_c = {tid: t["nombre"] for tid, t in tramites.TRAMITES.items()}

    def _tarjeta_cita(c, mostrar_botones=True):
        fecha_str = c.get("fecha", "")
        hora_str  = c.get("hora", "")
        dias_rest = (date.fromisoformat(fecha_str) - date.today()).days if fecha_str else 0
        urgente = 0 <= dias_rest <= 3
        clase = "bz-card-urgente" if urgente else ("bz-card-info" if dias_rest >= 0 else "bz-card-ok")
        icono = "🔴" if urgente else ("🗓️" if dias_rest >= 0 else "✅")
        sub_exp = ""
        if c.get("expediente_id") and c["expediente_id"] in opciones_exp:
            sub_exp = f" · {opciones_exp[c['expediente_id']]}"
        sub = f"{c.get('tipo','')} · {hora_str}{sub_exp}"
        if c.get("reserva"):
            sub += f" · Ref: {c['reserva']}"
        st.markdown(
            f"<div class='bz-list-card {clase}'>"
            f"<span class='bz-card-icono'>{icono}</span>"
            "<div class='bz-card-texto'>"
            f"<div class='bz-card-titulo'>{c.get('oficina') or c.get('tipo','')} — {fecha_str}</div>"
            f"<div class='bz-card-sub'>{sub}</div>"
            + (f"<div class='bz-card-sub'>{c['notas']}</div>" if c.get("notas") else "")
            + "</div></div>",
            unsafe_allow_html=True,
        )
        if mostrar_botones:
            bc1, bc2 = st.columns(2)
            # Siempre renderizamos ambos botones (DOM estable); disabled cuando no aplica
            if bc1.button(
                "✓ Hecha", key=f"cita_ok_{c['id']}",
                disabled=bool(c.get("hecha")), use_container_width=True,
            ):
                citas.actualizar_cita(c["id"], hecha=True)
                st.rerun()
            if bc2.button("🗑️ Eliminar", key=f"cita_del_{c['id']}", use_container_width=True):
                citas.eliminar_cita(c["id"])
                st.rerun()

    if pendientes:
        st.subheader(f"📅 Próximas citas ({len(pendientes)})")
        for c in pendientes:
            _tarjeta_cita(c)

    if pasadas:
        with st.expander(f"Citas pasadas / completadas ({len(pasadas)})"):
            for c in pasadas:
                _tarjeta_cita(c, mostrar_botones=True)


def pagina_calendario():
    st.title("Calendario de tareas")
    st.markdown(
        '<p class="bz-page-subtitle">Recordatorios de todos los expedientes '
        "(presentaciones, renovaciones, consultas).</p>",
        unsafe_allow_html=True,
    )

    with st.expander("📤 Exportar a Outlook / Google Calendar (.ics)"):
        st.caption(
            "Descarga un archivo .ics con las tareas pendientes y las proximas "
            "caducidades como eventos de dia completo. Para verlo siempre actualizado "
            "en Outlook, importalo y repite la descarga periodicamente, o publica el "
            "archivo en una URL fija y suscribela como 'calendario desde Internet'."
        )
        incluir_cad = st.checkbox("Incluir proximas caducidades de documentos", value=True)
        dias_cad = st.slider("Caducidades dentro de (dias)", 7, 180, 60, step=7)
        ics = historial.exportar_ics(incluir_caducidades=incluir_cad, dias_caducidad=dias_cad)
        st.download_button(
            "⬇️ Descargar calendario (.ics)", data=ics,
            file_name="burocracia_zero_calendario.ics", mime="text/calendar",
            use_container_width=True,
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
    import altair as alt

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

    # ── KPIs ─────────────────────────────────────────────────────────────────
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Expedientes", e["total"])
    m2.metric("Completos a la primera", f"{e['porcentaje_completos']} %")
    m3.metric("Aprobados", e["por_resultado"].get("aprobado", 0))
    m4.metric("Denegados", e["por_resultado"].get("denegado", 0))

    # ── Actividad mensual ────────────────────────────────────────────────────
    if e.get("por_mes"):
        st.subheader("Actividad mensual")
        df_mes = pd.DataFrame(
            [{"Mes": k, "Expedientes": v} for k, v in e["por_mes"].items()]
        )
        chart_mes = (
            alt.Chart(df_mes)
            .mark_bar(color="#9373B2", cornerRadiusTopLeft=4, cornerRadiusTopRight=4)
            .encode(
                x=alt.X("Mes:O", axis=alt.Axis(labelAngle=-45)),
                y=alt.Y("Expedientes:Q"),
                tooltip=["Mes", "Expedientes"],
            )
            .properties(height=220)
        )
        st.altair_chart(chart_mes, use_container_width=True)

    col_a, col_b = st.columns(2)

    # ── Tramites ─────────────────────────────────────────────────────────────
    if e["por_tramite"]:
        with col_a:
            st.subheader("Expedientes por tramite")
            df_tr = pd.DataFrame(
                [{"Tramite": k, "Total": v} for k, v in e["por_tramite"].items()]
            ).sort_values("Total", ascending=False)
            chart_tr = (
                alt.Chart(df_tr)
                .mark_arc(innerRadius=45)
                .encode(
                    theta=alt.Theta("Total:Q"),
                    color=alt.Color("Tramite:N", legend=alt.Legend(orient="bottom")),
                    tooltip=["Tramite", "Total"],
                )
                .properties(height=260)
            )
            st.altair_chart(chart_tr, use_container_width=True)

    # ── Resultados ───────────────────────────────────────────────────────────
    if e["por_resultado"]:
        with col_b:
            st.subheader("Resultado de los tramites")
            _COLORES_RES = {
                "aprobado": "#43A047", "denegado": "#E53935",
                "pendiente": "#FB8C00", "sin_marcar": "#9E9E9E",
            }
            df_res = pd.DataFrame(
                [{"Estado": k, "Total": v} for k, v in e["por_resultado"].items() if v > 0]
            )
            if not df_res.empty:
                chart_res = (
                    alt.Chart(df_res)
                    .mark_bar(cornerRadiusTopLeft=4, cornerRadiusTopRight=4)
                    .encode(
                        x=alt.X("Estado:O"),
                        y=alt.Y("Total:Q"),
                        color=alt.Color(
                            "Estado:N",
                            scale=alt.Scale(
                                domain=list(_COLORES_RES.keys()),
                                range=list(_COLORES_RES.values()),
                            ),
                            legend=None,
                        ),
                        tooltip=["Estado", "Total"],
                    )
                    .properties(height=260)
                )
                st.altair_chart(chart_res, use_container_width=True)

    # ── Documentos que mas fallan ────────────────────────────────────────────
    if e["fallos_doc"]:
        st.subheader("Documentos que mas fallan (incidencias o caducados)")
        df_doc = pd.DataFrame(
            [{"Documento": k, "Incidencias": v}
             for k, v in list(e["fallos_doc"].items())[:12]]
        )
        chart_doc = (
            alt.Chart(df_doc)
            .mark_bar(color="#E57373", cornerRadiusTopLeft=4, cornerRadiusTopRight=4)
            .encode(
                x=alt.X("Incidencias:Q"),
                y=alt.Y("Documento:N", sort="-x"),
                tooltip=["Documento", "Incidencias"],
            )
            .properties(height=max(200, len(df_doc) * 28))
        )
        st.altair_chart(chart_doc, use_container_width=True)

    # ── Rentabilidad por tramite ─────────────────────────────────────────────
    rent = e.get("rentabilidad", {})
    if rent:
        st.subheader("Rentabilidad por tramite")
        df_rent = pd.DataFrame([
            {
                "Tramite": k,
                "Facturado (EUR)": round(v["total"], 2),
                "Cobrado (EUR)": round(v["cobrado"], 2),
                "Expedientes": v["count"],
                "Media por exp.": round(v["total"] / v["count"], 2) if v["count"] else 0,
            }
            for k, v in rent.items()
        ]).sort_values("Facturado (EUR)", ascending=False)
        st.dataframe(df_rent, hide_index=True, use_container_width=True)

        df_rent_chart = pd.DataFrame([
            {"Tramite": k, "EUR": round(v["total"], 2), "Tipo": "Facturado"}
            for k, v in rent.items()
        ] + [
            {"Tramite": k, "EUR": round(v["cobrado"], 2), "Tipo": "Cobrado"}
            for k, v in rent.items()
        ])
        chart_rent = (
            alt.Chart(df_rent_chart)
            .mark_bar()
            .encode(
                x=alt.X("EUR:Q"),
                y=alt.Y("Tramite:N", sort="-x"),
                color=alt.Color(
                    "Tipo:N",
                    scale=alt.Scale(domain=["Facturado", "Cobrado"], range=["#9373B2", "#43A047"]),
                ),
                yOffset="Tipo:N",
                tooltip=["Tramite", "Tipo", "EUR"],
            )
            .properties(height=max(200, len(rent) * 48))
        )
        st.altair_chart(chart_rent, use_container_width=True)


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
    st.subheader("Recepcion de email (IMAP)")
    st.caption("Permite importar documentos directamente desde la bandeja de entrada.")
    with st.form("imap"):
        c1, c2 = st.columns(2)
        imap_host = c1.text_input("Servidor IMAP", value=cfg.get("imap_host", ""))
        imap_port = c2.number_input("Puerto IMAP", value=int(cfg.get("imap_port", 993) or 993), step=1)
        imap_user = c1.text_input("Usuario IMAP", value=cfg.get("imap_user", ""))
        imap_pass = c2.text_input("Contrasena IMAP", value=cfg.get("imap_password", ""), type="password")
        imap_ssl = c1.checkbox("Usar SSL (993)", value=bool(cfg.get("imap_ssl", True)))
        imap_carpeta = c2.text_input("Carpeta", value=cfg.get("imap_carpeta", "INBOX"))
        if st.form_submit_button("💾 Guardar IMAP"):
            cfg.update({
                "imap_host": imap_host.strip(), "imap_port": int(imap_port),
                "imap_user": imap_user.strip(), "imap_password": imap_pass,
                "imap_ssl": imap_ssl, "imap_carpeta": imap_carpeta.strip() or "INBOX",
            })
            config.guardar_config(cfg)
            st.success("Configuracion IMAP guardada.")

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
#  Comparador de tramites
# --------------------------------------------------------------------------- #
def _mostrar_comparador(items, tramite_actual):
    """Muestra una tabla comparando cuantos documentos cumple el expediente para cada tramite."""
    # Usamos los datos ya cargados si existen; si no, una evaluacion rapida sin IA
    resultados_cache = st.session_state.get("resultados")
    if not resultados_cache:
        st.info("Analiza el expediente primero para comparar tramites con datos reales.")
        return

    nombres_tramite = {tid: t["nombre"] for tid, t in tramites.TRAMITES.items()}
    filas = []
    for tid in tramites.TRAMITES:
        checklist, _ = analizador.evaluar_expediente(resultados_cache, tid)
        total = len([c for c in checklist if c["obligatorio"]])
        correctos = sum(1 for c in checklist if c["obligatorio"] and c["estado"] == "correcto")
        faltan = sum(1 for c in checklist if c["estado"] == "falta")
        caducados = sum(1 for c in checklist if c["estado"] == "caducado")
        listo = analizador.expediente_listo(checklist)
        pct = round(100 * correctos / total) if total else 0
        filas.append({
            "Tramite": nombres_tramite[tid],
            "Compatibilidad": pct,
            "Correctos": correctos,
            "Faltan": faltan,
            "Caducados": caducados,
            "Listo": "✅" if listo else "❌",
            "_id": tid,
        })

    filas.sort(key=lambda x: -x["Compatibilidad"])
    st.subheader("Comparador de tramites")
    st.caption("Que tramites podria solicitar el cliente con la documentacion aportada.")
    df_comp = pd.DataFrame(
        [{k: v for k, v in f.items() if k != "_id"} for f in filas]
    )
    st.dataframe(df_comp, hide_index=True, use_container_width=True)

    mejor = filas[0]
    if mejor["_id"] != tramite_actual:
        st.info(
            f"El tramite con mayor compatibilidad es **{mejor['Tramite']}** "
            f"({mejor['Compatibilidad']} %). "
            "Seleccionalo en el desplegable de arriba si procede."
        )


# --------------------------------------------------------------------------- #
#  Pagina: Dashboard
# --------------------------------------------------------------------------- #
def pagina_dashboard():
    st.title("Dashboard")
    st.markdown(
        '<p class="bz-page-subtitle">Resumen del dia: tareas pendientes, caducidades urgentes '
        "y actividad reciente.</p>",
        unsafe_allow_html=True,
    )

    hoy = date.today().isoformat()
    todas_tareas = historial.todas_las_tareas(incluir_hechas=False)
    tareas_hoy = [t for t in todas_tareas if t["fecha"] <= hoy]
    cad7 = historial.proximas_caducidades(7)
    cad30 = historial.proximas_caducidades(30)
    registros = historial.listar()
    citas7 = citas.proximas_citas(7)
    hon = historial.resumen_honorarios()

    urgentes_vencidas = sum(1 for t in tareas_hoy if t["fecha"] < hoy)
    urgentes_cad = sum(1 for av in cad7 if av["vencido"])
    if not tareas_hoy and not cad7:
        chips = (
            "<div class='bz-hero-chip bz-hero-ok'>"
            "<span class='bz-hero-icono'>🎉</span>"
            "<div><div class='bz-hero-num'>Todo al dia</div>"
            "<div class='bz-hero-label'>Sin tareas ni caducidades urgentes</div></div></div>"
        )
    else:
        chips = (
            f"<div class='bz-hero-chip'><span class='bz-hero-icono'>📋</span>"
            f"<div><div class='bz-hero-num'>{len(tareas_hoy)}</div>"
            f"<div class='bz-hero-label'>Tareas para hoy</div></div></div>"
            f"<div class='bz-hero-chip'><span class='bz-hero-icono'>🔴</span>"
            f"<div><div class='bz-hero-num'>{urgentes_vencidas}</div>"
            f"<div class='bz-hero-label'>Vencidas</div></div></div>"
            f"<div class='bz-hero-chip'><span class='bz-hero-icono'>⏰</span>"
            f"<div><div class='bz-hero-num'>{len(cad7)}</div>"
            f"<div class='bz-hero-label'>Caducan esta semana</div></div></div>"
            f"<div class='bz-hero-chip'><span class='bz-hero-icono'>⛔</span>"
            f"<div><div class='bz-hero-num'>{urgentes_cad}</div>"
            f"<div class='bz-hero-label'>Ya vencidas</div></div></div>"
        )
    chips += (
        f"<div class='bz-hero-chip'><span class='bz-hero-icono'>🗓️</span>"
        f"<div><div class='bz-hero-num'>{len(citas7)}</div>"
        f"<div class='bz-hero-label'>Citas en 7 dias</div></div></div>"
    )
    if hon["pendiente"] > 0:
        chips += (
            f"<div class='bz-hero-chip'><span class='bz-hero-icono'>💶</span>"
            f"<div><div class='bz-hero-num'>{hon['pendiente']:.0f}€</div>"
            f"<div class='bz-hero-label'>Pendiente de cobro</div></div></div>"
        )
    st.markdown(
        "<div class='bz-hero-hoy'>"
        "<div><div class='bz-hero-titulo'>👋 Resumen de hoy</div>"
        f"<div class='bz-hero-sub'>{date.today().strftime('%d/%m/%Y')}</div></div>"
        f"{chips}</div>",
        unsafe_allow_html=True,
    )

    # ── Acciones rápidas ──────────────────────────────────────────────────── #
    _QA = [
        ("➕", "Nuevo expediente", "Revisar documentos de un cliente", "Revisar expediente"),
        ("🧙", "Primera consulta", "Asistente para nuevos clientes",   "Primera consulta"),
        ("🚦", "Urgente",          "Tareas y caducidades criticas",    "Urgente"),
        ("🗓️", "Citas",           "Agenda de citas previas",           "Citas"),
    ]
    qa_cols = st.columns(4)
    for col, (ico, titulo, sub, destino) in zip(qa_cols, _QA):
        with col:
            st.markdown(
                f"<div class='bz-accion-card'>"
                f"<span class='bz-ac-icono'>{ico}</span>"
                f"<div class='bz-ac-titulo'>{titulo}</div>"
                f"<div class='bz-ac-sub'>{sub}</div>"
                "</div>",
                unsafe_allow_html=True,
            )
            if st.button(titulo, key=f"qa_{destino}", use_container_width=True):
                st.session_state["_menu_nav"] = destino
                st.rerun()

    st.divider()
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Expedientes totales", len(registros))
    m2.metric("Tareas vencidas / hoy", len(tareas_hoy))
    m3.metric("Caducan esta semana", len(cad7))
    m4.metric("Caducan este mes", len(cad30))

    c1, c2 = st.columns(2)

    with c1:
        st.subheader("📋 Tareas para hoy")
        if not tareas_hoy:
            st.success("No hay tareas vencidas ni para hoy.")
        else:
            for t in tareas_hoy[:8]:
                vencida = t["fecha"] < hoy
                clase = "bz-card-urgente" if vencida else "bz-card-info"
                icono = "🔴" if vencida else "🗓️"
                etiqueta = "Vencida" if vencida else ("Para hoy" if t["fecha"] == hoy else "Proxima")
                st.markdown(
                    f"<div class='bz-list-card {clase}'>"
                    f"<span class='bz-card-icono'>{icono}</span>"
                    "<div class='bz-card-texto'>"
                    f"<div class='bz-card-titulo'>{t['descripcion']}</div>"
                    f"<div class='bz-card-sub'>{t['solicitante']} · {etiqueta} ({t['fecha']})</div>"
                    "</div></div>",
                    unsafe_allow_html=True,
                )
                if st.button(
                    "✓ Marcar hecha", key=f"dash_t_{t['expediente_id']}_{t['indice']}",
                    use_container_width=True,
                ):
                    historial.marcar_tarea(t["expediente_id"], t["indice"], True)
                    st.rerun()

    with c2:
        st.subheader("⏰ Caducidades urgentes (7 dias)")
        if not cad7:
            st.success("Ninguna caducidad urgente.")
        else:
            for av in cad7[:8]:
                vencido = av["vencido"]
                dias_r = av["dias_restantes"]
                clase = "bz-card-urgente" if vencido else "bz-card-aviso"
                icono = "⛔" if vencido else "🟠"
                texto = "Ya ha caducado" if vencido else f"Caduca en {dias_r} dia(s)"
                pct = 0 if vencido else max(6, min(100, round((dias_r / 7) * 100)))
                color = "#E53935" if vencido or dias_r <= 2 else "#FB8C00"
                st.markdown(
                    f"<div class='bz-list-card {clase}'>"
                    f"<span class='bz-card-icono'>{icono}</span>"
                    "<div class='bz-card-texto'>"
                    f"<div class='bz-card-titulo'>{av['documento']} — {av['solicitante']}</div>"
                    f"<div class='bz-card-sub'>{texto} · vence el {av['fecha_caducidad']}</div>"
                    f"<div class='bz-cad-bar-track'><div class='bz-cad-bar-fill' "
                    f"style='width:{pct}%; background:{color};'></div></div>"
                    "</div></div>",
                    unsafe_allow_html=True,
                )

    # ── Panel de renovaciones ─────────────────────────────────────────────── #
    renovaciones_dash = historial.proximas_renovaciones(60)
    if renovaciones_dash:
        st.divider()
        st.subheader("🔔 Proximas renovaciones (60 dias)")
        for rv in renovaciones_dash[:6]:
            clase_rv = "bz-card-urgente" if rv["vencido"] or rv["dias_restantes"] <= 15 else "bz-card-aviso"
            txt_rv = "Vencido" if rv["vencido"] else f"Caduca en {rv['dias_restantes']}d"
            st.markdown(
                f"<div class='bz-list-card {clase_rv}'>"
                f"<span class='bz-card-icono'>🔔</span>"
                "<div class='bz-card-texto'>"
                f"<div class='bz-card-titulo'>{rv['documento']} — {rv['solicitante']}</div>"
                f"<div class='bz-card-sub'>{txt_rv} · {rv['fecha_caducidad']}</div>"
                "</div></div>",
                unsafe_allow_html=True,
            )

    st.divider()
    st.subheader("🕘 Actividad reciente")
    if not registros:
        st.info("Aun no hay expedientes revisados.")
    else:
        nombres_tramite = {tid: t["nombre"] for tid, t in tramites.TRAMITES.items()}
        for r in registros[:6]:
            listo = r["listo"]
            clase = "bz-card-ok" if listo else "bz-card-aviso"
            icono_estado = "✅" if listo else "⏳"
            estado_txt = "Listo para presentar" if listo else "Pendiente de documentacion"
            tramite_n = nombres_tramite.get(r["tramite_id"], r["tramite_id"])
            icono_tr = tramites.icono_tramite(r["tramite_id"])
            st.markdown(
                f"<div class='bz-list-card {clase}'>"
                f"<span class='bz-card-icono'>{icono_tr}</span>"
                "<div class='bz-card-texto'>"
                f"<div class='bz-card-titulo'>{r['solicitante'] or 'Sin nombre'} — {tramite_n}</div>"
                f"<div class='bz-card-sub'>{icono_estado} {estado_txt} · {r['fecha'][:10]}</div>"
                "</div></div>",
                unsafe_allow_html=True,
            )


# --------------------------------------------------------------------------- #
#  Pagina: Asistente IA (chat con el expediente)
# --------------------------------------------------------------------------- #
def pagina_asistente(api_key, modelo):
    st.title("Asistente IA")
    st.markdown(
        '<p class="bz-page-subtitle">Pregunta sobre cualquier expediente del historial: '
        "documentos que faltan, caducidades, requisitos del tramite o cualquier duda.</p>",
        unsafe_allow_html=True,
    )
    if _aviso_sin_clave(api_key):
        return

    registros = historial.listar()
    if not registros:
        st.info("Aun no hay expedientes en el historial. Revisa uno primero.")
        return

    etiquetas = {
        r["id"]: f"{r['fecha'][:10]}  ·  {r['solicitante'] or 'sin nombre'}  —  "
                 f"{tramites.TRAMITES.get(r['tramite_id'], {}).get('nombre', r['tramite_id'])}"
        for r in registros
    }
    eid = st.selectbox(
        "Expediente de contexto", list(etiquetas), format_func=lambda i: etiquetas[i]
    )

    # Limpiar historial de chat si cambia el expediente
    if st.session_state.get("chat_eid") != eid:
        st.session_state["chat_eid"] = eid
        st.session_state["chat_msgs"] = []

    registro = historial.cargar(eid)
    if not registro:
        st.error("No se pudo cargar el expediente.")
        return

    # Mostrar contexto resumido
    tramite_nombre = tramites.TRAMITES.get(registro["tramite_id"], {}).get("nombre", "")
    checklist, _ = analizador.evaluar_expediente(registro.get("resultados", []), registro["tramite_id"])
    faltan = sum(1 for c in checklist if c["estado"] == "falta")
    caducados = sum(1 for c in checklist if c["estado"] == "caducado")
    with st.expander("Ver resumen del expediente en contexto"):
        st.write(f"**Tramite:** {tramite_nombre}")
        st.write(f"**Solicitante:** {registro.get('solicitante') or '-'}")
        st.write(f"**NIE:** {registro.get('nie') or '-'}")
        st.write(f"**Documentos que faltan:** {faltan}  |  **Caducados:** {caducados}")

    # Chat
    msgs = st.session_state.get("chat_msgs", [])
    for msg in msgs:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    if prompt := st.chat_input("Pregunta sobre este expediente..."):
        msgs.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)

        with st.chat_message("assistant"):
            with st.spinner("Consultando..."):
                try:
                    respuesta = _chat_expediente(api_key, modelo, registro, checklist, msgs)
                except Exception as exc:  # noqa: BLE001
                    respuesta = f"No se pudo obtener respuesta: {exc}"
            st.markdown(respuesta)

        msgs.append({"role": "assistant", "content": respuesta})
        st.session_state["chat_msgs"] = msgs

    if msgs and st.button("Limpiar conversacion"):
        st.session_state["chat_msgs"] = []
        st.rerun()


def _chat_expediente(api_key, modelo, registro, checklist, mensajes):
    """Llama a Claude con el expediente como contexto del sistema."""
    tramite_nombre = tramites.TRAMITES.get(registro["tramite_id"], {}).get("nombre", registro["tramite_id"])
    lineas = [
        f"Expediente de extranjeria:",
        f"- Solicitante: {registro.get('solicitante') or 'desconocido'}",
        f"- Tramite: {tramite_nombre}",
        f"- Fecha revision: {registro.get('fecha', '')[:10]}",
        f"- Nº expediente: {registro.get('numero_expediente') or 'no registrado'}",
        f"- NIE: {registro.get('nie') or 'no registrado'}",
        "",
        "Estado del checklist:",
    ]
    for item in checklist:
        lineas.append(f"  - {item['nombre']}: {item['estado']}")
    lineas.append("")
    lineas.append("Documentos analizados:")
    for doc in registro.get("resultados", []):
        linea = f"  - {doc.get('tipo_nombre') or doc.get('tipo_id')}: {doc.get('estado', '-')}"
        if doc.get("fecha_caducidad"):
            linea += f" (caduca: {doc['fecha_caducidad']})"
        if doc.get("incidencias"):
            linea += f" | Incidencias: {'; '.join(doc['incidencias'])}"
        lineas.append(linea)

    seguimiento = registro.get("seguimiento", [])
    if seguimiento:
        lineas.append("")
        lineas.append("Historial de seguimiento:")
        for ev in seguimiento[-5:]:
            lineas.append(f"  - {ev['fecha']}: {ev['estado']} {ev.get('nota', '')}")

    system = (
        "Eres un asistente especializado en derecho de extranjeria espanol (tramites de residencia "
        "y trabajo: arraigo, regularizacion, etc.). Tienes acceso al expediente de un cliente "
        "concreto. Responde de forma concisa y practica. Si no sabes algo con certeza, indicalo. "
        "No inventes normativa.\n\n"
        + "\n".join(lineas)
    )

    cliente = obtener_cliente(api_key)
    resp = cliente.messages.create(
        model=modelo,
        max_tokens=1024,
        system=system,
        messages=[{"role": m["role"], "content": m["content"]} for m in mensajes],
    )
    return resp.content[0].text


# --------------------------------------------------------------------------- #
#  Pagina: Bandeja urgente
# --------------------------------------------------------------------------- #
def pagina_bandeja_urgente():
    st.title("🚦 Bandeja urgente")
    st.markdown(
        '<p class="bz-page-subtitle">Todo lo que necesita atencion inmediata: tareas '
        "vencidas, caducidades criticas, citas de manana y expedientes inactivos.</p>",
        unsafe_allow_html=True,
    )
    hoy = date.today().isoformat()
    manana = date.today().replace(day=date.today().day + 1).isoformat() if date.today().day < 28 else (
        date.today().isoformat()  # fallback seguro
    )

    # Calcular manana de forma robusta
    from datetime import timedelta as _td
    manana = (date.today() + _td(days=1)).isoformat()

    todas_tareas = historial.todas_las_tareas(incluir_hechas=False)
    tareas_venc = [t for t in todas_tareas if t["fecha"] < hoy]
    cad_criticas = historial.proximas_caducidades(7)
    citas_manana = [c for c in citas.listar() if not c.get("hecha") and c.get("fecha") == manana]
    renovaciones = historial.proximas_renovaciones(30)

    # KPIs
    k1, k2, k3, k4 = st.columns(4)
    k1.metric("Tareas vencidas", len(tareas_venc), delta=None)
    k2.metric("Docs caducan 7d", len(cad_criticas))
    k3.metric("Citas manana", len(citas_manana))
    k4.metric("Renovaciones 30d", len(renovaciones))

    st.divider()
    col_izq, col_der = st.columns(2)

    with col_izq:
        # Tareas vencidas
        st.subheader("⬛ Tareas vencidas")
        if not tareas_venc:
            st.success("Sin tareas vencidas.")
        else:
            for t in tareas_venc[:10]:
                st.markdown(
                    f"<div class='bz-list-card bz-card-urgente'>"
                    f"<span class='bz-card-icono'>🔴</span>"
                    "<div class='bz-card-texto'>"
                    f"<div class='bz-card-titulo'>{t['descripcion']}</div>"
                    f"<div class='bz-card-sub'>{t['solicitante']} · vencio el {t['fecha']}</div>"
                    "</div></div>",
                    unsafe_allow_html=True,
                )
                if st.button("✓ Hecha", key=f"urg_t_{t['expediente_id']}_{t['indice']}",
                             use_container_width=True):
                    historial.marcar_tarea(t["expediente_id"], t["indice"], True)
                    st.rerun()

        st.divider()
        # Citas de mañana
        st.subheader("🗓️ Citas de manana")
        if not citas_manana:
            st.success("Sin citas para manana.")
        else:
            for c in citas_manana:
                exp_label = c.get("expediente_id", "")[:12] if c.get("expediente_id") else "–"
                st.markdown(
                    f"<div class='bz-list-card bz-card-aviso'>"
                    f"<span class='bz-card-icono'>📅</span>"
                    "<div class='bz-card-texto'>"
                    f"<div class='bz-card-titulo'>{c.get('oficina','–')} — {c.get('tipo','')}</div>"
                    f"<div class='bz-card-sub'>{c.get('hora','') or 'Hora no indicada'} · Exp: {exp_label}</div>"
                    "</div></div>",
                    unsafe_allow_html=True,
                )

    with col_der:
        # Caducidades criticas
        st.subheader("⏰ Caducidades criticas (7 dias)")
        if not cad_criticas:
            st.success("Sin caducidades criticas.")
        else:
            for av in cad_criticas[:10]:
                clase = "bz-card-urgente" if av["vencido"] else "bz-card-aviso"
                ico = "⛔" if av["vencido"] else "🟠"
                txt = "Ya ha caducado" if av["vencido"] else f"Caduca en {av['dias_restantes']}d"
                st.markdown(
                    f"<div class='bz-list-card {clase}'>"
                    f"<span class='bz-card-icono'>{ico}</span>"
                    "<div class='bz-card-texto'>"
                    f"<div class='bz-card-titulo'>{av['documento']} — {av['solicitante']}</div>"
                    f"<div class='bz-card-sub'>{txt} · {av['fecha_caducidad']}</div>"
                    "</div></div>",
                    unsafe_allow_html=True,
                )

        st.divider()
        # Renovaciones proximas
        st.subheader("🔔 Renovaciones proximas (30 dias)")
        if not renovaciones:
            st.success("Sin renovaciones urgentes.")
        else:
            for r in renovaciones[:8]:
                clase = "bz-card-urgente" if r["vencido"] else "bz-card-aviso"
                txt = "Vencido" if r["vencido"] else f"Caduca en {r['dias_restantes']}d"
                st.markdown(
                    f"<div class='bz-list-card {clase}'>"
                    f"<span class='bz-card-icono'>🔔</span>"
                    "<div class='bz-card-texto'>"
                    f"<div class='bz-card-titulo'>{r['documento']} — {r['solicitante']}</div>"
                    f"<div class='bz-card-sub'>{txt} · {r['fecha_caducidad']}</div>"
                    "</div></div>",
                    unsafe_allow_html=True,
                )
                if st.button(
                    "Ver expediente", key=f"urg_ren_{r['expediente_id']}",
                    use_container_width=True,
                ):
                    st.session_state["seguimiento_eid_sugerido"] = r["expediente_id"]
                    st.session_state["_menu_nav"] = "Seguimiento"
                    st.rerun()


# --------------------------------------------------------------------------- #
#  Pagina: Asistente de primera consulta (wizard)
# --------------------------------------------------------------------------- #
def pagina_primera_consulta():
    st.title("🧙 Primera consulta")
    st.markdown(
        '<p class="bz-page-subtitle">Asistente paso a paso para capturar los datos del cliente, '
        "diagnosticar su situacion y sugerir el tramite mas adecuado.</p>",
        unsafe_allow_html=True,
    )

    paso = st.session_state.get("wiz_paso", 1)

    # ── Barra de progreso del wizard ─────────────────────────────────────────
    pasos_total = 4
    pct_wiz = int((paso / pasos_total) * 100)
    st.markdown(
        f"<div style='margin-bottom:1rem;'>"
        f"<div style='font-size:0.82rem;color:#9373B2;margin-bottom:4px;'>"
        f"Paso {paso} de {pasos_total}</div>"
        f"<div class='bz-cad-bar-track'>"
        f"<div class='bz-cad-bar-fill' style='width:{pct_wiz}%;background:#9373B2;'></div>"
        f"</div></div>",
        unsafe_allow_html=True,
    )

    if paso == 1:
        st.subheader("Paso 1: Datos personales del cliente")
        with st.form("wiz_paso1"):
            c1, c2, c3 = st.columns(3)
            nombre = c1.text_input("Nombre completo *")
            nac = c2.text_input("Nacionalidad *")
            fnac = c3.text_input("Fecha de nacimiento (DD/MM/AAAA)")
            c4, c5, c6 = st.columns(3)
            pasaporte = c4.text_input("Nº pasaporte")
            tel = c5.text_input("Telefono")
            email = c6.text_input("Email")
            fecha_entrada = st.text_input("Fecha de entrada en Espana (DD/MM/AAAA o AAAA)")
            if st.form_submit_button("Siguiente →", type="primary"):
                if not nombre.strip() or not nac.strip():
                    st.error("Nombre y nacionalidad son obligatorios.")
                else:
                    st.session_state["wiz_datos"] = {
                        "nombre": nombre.strip(), "nacionalidad": nac.strip(),
                        "fecha_nacimiento": fnac.strip(), "num_pasaporte": pasaporte.strip(),
                        "telefono": tel.strip(), "email_cliente": email.strip(),
                        "fecha_entrada_espana": fecha_entrada.strip(),
                    }
                    st.session_state["wiz_paso"] = 2
                    st.rerun()

    elif paso == 2:
        datos = st.session_state.get("wiz_datos", {})
        st.subheader("Paso 2: Situacion actual")
        with st.form("wiz_paso2"):
            situacion = st.selectbox("Situacion juridica actual", [
                "Estancia irregular (sin papeles)",
                "Con visado de turista / estudiante caducado",
                "Con NIE de larga duracion",
                "Con permiso de residencia temporal",
                "Con permiso en tramite",
                "Familiar de ciudadano UE",
                "Otra / no sabe",
            ])
            tiempo_espana = st.selectbox("Tiempo de residencia en Espana", [
                "Menos de 1 ano", "1 a 2 anos", "2 a 3 anos",
                "3 a 5 anos", "Mas de 5 anos",
            ])
            tiene_contrato = st.checkbox("Tiene oferta de trabajo o contrato laboral")
            tiene_pareja = st.checkbox("Tiene pareja o familiar espanol/a o con residencia legal")
            tiene_arraigo_social = st.checkbox("Lleva 3+ anos en Espana sin antecedentes penales")
            c1w, c2w = st.columns(2)
            if c1w.form_submit_button("← Atras"):
                st.session_state["wiz_paso"] = 1
                st.rerun()
            if c2w.form_submit_button("Siguiente →", type="primary"):
                datos.update({
                    "wiz_situacion": situacion,
                    "wiz_tiempo": tiempo_espana,
                    "wiz_contrato": tiene_contrato,
                    "wiz_pareja": tiene_pareja,
                    "wiz_arraigo": tiene_arraigo_social,
                })
                st.session_state["wiz_datos"] = datos
                st.session_state["wiz_paso"] = 3
                st.rerun()

    elif paso == 3:
        datos = st.session_state.get("wiz_datos", {})
        st.subheader("Paso 3: Diagnostico")

        # Logica simple de sugerencia de tramite
        sugerencias = []
        _t = datos.get("wiz_tiempo", "")
        _c = datos.get("wiz_contrato", False)
        _p = datos.get("wiz_pareja", False)
        _ar = datos.get("wiz_arraigo", False)
        _sit = datos.get("wiz_situacion", "")

        if _ar and not _c:
            sugerencias.append(("arraigo_social", "Arraigo Social",
                                "Lleva 3+ anos y no tiene contrato. Requiere informe de arraigo."))
        if _ar and _c:
            sugerencias.append(("arraigo_sociolaboral", "Arraigo Sociolaboral",
                                "Lleva 3+ anos con oferta de trabajo. Perfil muy favorable."))
        if _c and "1" in _t or "2" in _t:
            sugerencias.append(("arraigo_laboral", "Arraigo Laboral",
                                "Con contrato y tiempo en Espana. Requiere acreditacion de relacion laboral previa."))
        if _p:
            sugerencias.append(("arraigo_familiar", "Arraigo Familiar",
                                "Tiene vinculo familiar con residente legal."))
        if "5" in _t or "Mas" in _t:
            sugerencias.append(("larga_duracion", "Residencia de Larga Duracion",
                                "Con mas de 5 anos podria optar a residencia de larga duracion."))
        if not sugerencias:
            sugerencias.append(("arraigo_social", "Arraigo Social",
                                "Tramite mas habitual para irregulares con tiempo de permanencia."))

        st.markdown("**Tramites recomendados para este perfil:**")
        for tid, tnombre, razon in sugerencias:
            st.markdown(
                f"<div class='bz-list-card bz-card-info'>"
                f"<span class='bz-card-icono'>⚖️</span>"
                "<div class='bz-card-texto'>"
                f"<div class='bz-card-titulo'>{tnombre}</div>"
                f"<div class='bz-card-sub'>{razon}</div>"
                "</div></div>",
                unsafe_allow_html=True,
            )

        t_ids_wiz = list(tramites.TRAMITES.keys())
        tramite_def_wiz = sugerencias[0][0] if sugerencias[0][0] in t_ids_wiz else t_ids_wiz[0]
        idx_def_wiz = t_ids_wiz.index(tramite_def_wiz) if tramite_def_wiz in t_ids_wiz else 0

        with st.form("wiz_paso3"):
            tramite_sel = st.selectbox(
                "Tramite seleccionado para el expediente",
                t_ids_wiz,
                index=idx_def_wiz,
                format_func=lambda tid: tramites.TRAMITES[tid]["nombre"],
            )
            honorarios_wiz = st.number_input("Honorarios estimados (EUR, opcional)", min_value=0.0, step=50.0)
            c1w, c2w = st.columns(2)
            if c1w.form_submit_button("← Atras"):
                st.session_state["wiz_paso"] = 2
                st.rerun()
            if c2w.form_submit_button("Siguiente →", type="primary"):
                datos["wiz_tramite"] = tramite_sel
                datos["wiz_honorarios"] = float(honorarios_wiz)
                st.session_state["wiz_datos"] = datos
                st.session_state["wiz_paso"] = 4
                st.rerun()

    elif paso == 4:
        datos = st.session_state.get("wiz_datos", {})
        tramite_wiz = datos.get("wiz_tramite", "")
        st.subheader("Paso 4: Confirmar y crear expediente")

        tramite_nombre_wiz = tramites.TRAMITES.get(tramite_wiz, {}).get("nombre", tramite_wiz)
        st.markdown(f"**Cliente:** {datos.get('nombre','—')}")
        st.markdown(f"**Tramite:** {tramite_nombre_wiz}")
        if datos.get("honorarios_wiz", 0) or datos.get("wiz_honorarios", 0):
            hon_wiz = datos.get("wiz_honorarios", 0)
            st.markdown(f"**Honorarios estimados:** {hon_wiz:.2f} €")

        st.markdown("**Documentos que necesitara:**")
        docs_wiz = tramites.documentos_de(tramite_wiz)
        for d in docs_wiz:
            oblig_icon = "🔴" if d["obligatorio"] else "⚪"
            st.write(f"{oblig_icon} {d['nombre']}" + (f" — _{d['notas']}_" if d.get("notas") else ""))

        c1w, c2w = st.columns(2)
        if c1w.button("← Atras", key="wiz_atras4"):
            st.session_state["wiz_paso"] = 3
            st.rerun()
        if c2w.button("✅ Crear expediente", type="primary", key="wiz_crear"):
            campos_alta = {k: v for k, v in datos.items() if not k.startswith("wiz_")}
            nuevo_eid = historial.alta_rapida(tramite_wiz, campos_alta)
            hon_wiz = datos.get("wiz_honorarios", 0)
            if hon_wiz:
                historial.guardar_honorarios(nuevo_eid, hon_wiz, 0, tramite_nombre_wiz)
            st.success(f"Expediente creado correctamente. ID: {nuevo_eid[:16]}")
            st.session_state["wiz_paso"] = 1
            st.session_state.pop("wiz_datos", None)
            st.session_state["seguimiento_eid_sugerido"] = nuevo_eid
            st.session_state["_menu_nav"] = "Seguimiento"
            st.rerun()

    if st.button("🔄 Reiniciar wizard", key="wiz_reset"):
        st.session_state["wiz_paso"] = 1
        st.session_state.pop("wiz_datos", None)
        st.rerun()


# --------------------------------------------------------------------------- #
#  Main
# --------------------------------------------------------------------------- #
def main():
    st.markdown(_CSS, unsafe_allow_html=True)
    if st.session_state.get("modo_oscuro"):
        st.markdown(_CSS_DARK, unsafe_allow_html=True)
    pagina, api_key, modelo, dias_aviso = barra_lateral()
    if pagina == "Dashboard":
        pagina_dashboard()
    elif pagina == "Urgente":
        pagina_bandeja_urgente()
    elif pagina == "Revisar expediente":
        pagina_revisar(api_key, modelo, dias_aviso)
    elif pagina == "Primera consulta":
        pagina_primera_consulta()
    elif pagina == "Tablero":
        pagina_tablero()
    elif pagina == "Historial":
        pagina_historial()
    elif pagina == "Seguimiento":
        pagina_seguimiento(api_key, modelo, dias_aviso)
    elif pagina == "Caducidades":
        pagina_caducidades()
    elif pagina == "Citas":
        pagina_citas()
    elif pagina == "Calendario":
        pagina_calendario()
    elif pagina == "Estadisticas":
        pagina_estadisticas()
    elif pagina == "Asistente IA":
        pagina_asistente(api_key, modelo)
    elif pagina == "Tramites":
        pagina_tramites()
    elif pagina == "Plantillas":
        pagina_plantillas()
    elif pagina == "Gestoria":
        pagina_gestoria()
    elif pagina == "Ajustes":
        pagina_ajustes()


if __name__ == "__main__":
    main()
