#!/usr/bin/env python3
"""
Gestor de Certificados Digitales — Interfaz gráfica
"""
import sys
import threading
import warnings
import tkinter.messagebox as messagebox
import tkinter.filedialog as filedialog
from datetime import datetime, timezone
from pathlib import Path

import customtkinter as ctk

from cert_manager import cert_scanner, cert_validator, reporter
from cert_manager import config as cfg_module

# ── Paleta Burocracia Zero ───────────────────────────────────────────────────
PRIMARY     = '#9373B2'   # Violeta
PRIMARY_DK  = '#6e529a'   # Violeta oscuro
PRIMARY_LT  = '#ece8f5'   # Violeta muy claro (fondo activo)
ACCENT      = '#FFEA63'   # Amarillo
ACCENT_DK   = '#e6d246'   # Amarillo oscuro
DANGER      = '#e53935'
WARNING     = '#f57c00'
SUCCESS     = '#2e7d32'
SUCCESS_LT  = '#e8f5e9'
BG          = '#f4f2f8'   # Fondo principal
CARD        = '#ffffff'
BORDER      = '#e0d9ee'
TEXT        = '#1a1a2e'
TEXT_MUTED  = '#7b6f8a'
BLACK       = '#000000'
SIDEBAR_W   = 220

ctk.set_appearance_mode('light')
ctk.set_default_color_theme('blue')


# ── Helpers ──────────────────────────────────────────────────────────────────

def _load_pfx_info(pfx_path: str, password: str) -> dict:
    """Extract readable info from a PFX/P12 certificate file."""
    try:
        from cryptography.hazmat.primitives.serialization.pkcs12 import load_key_and_certificates
        from cryptography.x509.oid import NameOID
        from cryptography.utils import CryptographyDeprecationWarning

        pw = password.encode() if password else None
        data = Path(pfx_path).read_bytes()
        with warnings.catch_warnings():
            warnings.filterwarnings('ignore', category=CryptographyDeprecationWarning)
            _, cert, _ = load_key_and_certificates(data, pw)

        def ga(name_obj, oid):
            try:
                return name_obj.get_attributes_for_oid(oid)[0].value
            except Exception:
                return ''

        try:
            not_after = cert.not_valid_after_utc
        except AttributeError:
            not_after = cert.not_valid_after.replace(tzinfo=timezone.utc)

        now  = datetime.now(timezone.utc)
        days = (not_after - now).days
        status = 'expired' if days < 0 else ('expiring_soon' if days <= 30 else 'valid')

        return {
            'ok':      True,
            'name':    ga(cert.subject, NameOID.COMMON_NAME)  or cert.subject.rfc4514_string(),
            'org':     ga(cert.subject, NameOID.ORGANIZATION_NAME),
            'issuer':  ga(cert.issuer,  NameOID.ORGANIZATION_NAME) or ga(cert.issuer, NameOID.COMMON_NAME),
            'expiry':  not_after.strftime('%d/%m/%Y'),
            'days':    days,
            'status':  status,
        }
    except Exception as e:
        return {'ok': False, 'error': str(e)}


# ── Componentes reutilizables ────────────────────────────────────────────────

def card(parent, **kwargs) -> ctk.CTkFrame:
    kw = dict(fg_color=CARD, corner_radius=12, border_width=1, border_color=BORDER)
    kw.update(kwargs)
    return ctk.CTkFrame(parent, **kw)


def page_header(parent, icon: str, title: str, subtitle: str = '') -> ctk.CTkFrame:
    f = card(parent)
    f.pack(fill='x', padx=20, pady=(20, 10))
    inner = ctk.CTkFrame(f, fg_color='transparent')
    inner.pack(fill='x', padx=20, pady=14)
    ctk.CTkLabel(inner, text=icon, font=ctk.CTkFont(size=28)).pack(side='left', padx=(0, 10))
    txt = ctk.CTkFrame(inner, fg_color='transparent')
    txt.pack(side='left', fill='x')
    ctk.CTkLabel(txt, text=title,
                 font=ctk.CTkFont(size=19, weight='bold'), text_color=PRIMARY,
                 anchor='w').pack(anchor='w')
    if subtitle:
        ctk.CTkLabel(txt, text=subtitle,
                     font=ctk.CTkFont(size=12), text_color=TEXT_MUTED,
                     anchor='w').pack(anchor='w')
    return f


def stat_card(parent, icon: str, title: str, value: str, color: str, text_color: str = '#ffffff'):
    f = ctk.CTkFrame(parent, fg_color=color, corner_radius=12)
    f.pack(side='left', expand=True, fill='both', padx=5, pady=5)
    ctk.CTkLabel(f, text=icon,  font=ctk.CTkFont(size=22), text_color=text_color).pack(pady=(14, 0))
    ctk.CTkLabel(f, text=value, font=ctk.CTkFont(size=30, weight='bold'), text_color=text_color).pack(pady=2)
    ctk.CTkLabel(f, text=title, font=ctk.CTkFont(size=11), text_color=text_color).pack(pady=(0, 14))


def badge(parent, text: str, status: str) -> ctk.CTkLabel:
    colors = {'valid': SUCCESS, 'expiring_soon': WARNING, 'expired': DANGER, 'unknown': TEXT_MUTED}
    icons  = {'valid': '✓', 'expiring_soon': '⚠', 'expired': '✗', 'unknown': '?'}
    color  = colors.get(status, TEXT_MUTED)
    icon   = icons.get(status, '')
    return ctk.CTkLabel(
        parent, text=f'{icon}  {text}',
        fg_color=color, text_color='#ffffff',
        corner_radius=8, font=ctk.CTkFont(size=11), padx=8, pady=3,
    )


def divider(parent):
    ctk.CTkFrame(parent, height=1, fg_color=BORDER).pack(fill='x', padx=0, pady=0)


def section_label(parent, text: str):
    ctk.CTkLabel(parent, text=text.upper(),
                 font=ctk.CTkFont(size=10, weight='bold'), text_color=TEXT_MUTED,
                 ).pack(anchor='w', padx=16, pady=(14, 4))


def tbl_header(parent, cols: list):
    hdr = ctk.CTkFrame(parent, fg_color=PRIMARY, corner_radius=8)
    hdr.pack(fill='x', pady=(0, 4))
    for col, w in cols:
        ctk.CTkLabel(hdr, text=col, width=w, anchor='w',
                     font=ctk.CTkFont(size=11, weight='bold'), text_color='#ffffff',
                     ).pack(side='left', padx=10, pady=9)


def action_btn(parent, text: str, color: str, cmd, width=160, **kw) -> ctk.CTkButton:
    kw.setdefault('hover_color', _darken(color))
    return ctk.CTkButton(parent, text=text, width=width, height=36,
                         fg_color=color, font=ctk.CTkFont(size=12),
                         corner_radius=8, command=cmd, **kw)


def _darken(hex_color: str, factor: float = 0.85) -> str:
    h = hex_color.lstrip('#')
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return '#{:02x}{:02x}{:02x}'.format(int(r * factor), int(g * factor), int(b * factor))


# ── Ventana principal ────────────────────────────────────────────────────────

class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title('Gestor de Certificados Digitales')
        self.geometry('1200x740')
        self.minsize(980, 640)
        self.configure(fg_color=BG)
        self.cfg          = cfg_module.load()
        self._page        = None
        self._page_name   = None
        # Cache de certificados: se carga una vez en background y se reutiliza
        self._cert_cache  = None
        self._cert_loading = False
        self._build()
        self._show('dashboard')
        self._preload_certs()

    def _preload_certs(self):
        """Carga certificados en segundo plano para que las páginas sean instantáneas."""
        if self._cert_loading:
            return
        self._cert_loading = True
        def load():
            stores     = [s.strip() for s in self.cfg['certificates']['stores'].split(',')]
            alert_days = int(self.cfg['general']['alert_days'])
            certs      = cert_scanner.scan(stores)
            if certs:
                certs = cert_validator.validate(certs, alert_days)
            self._cert_cache   = certs
            self._cert_loading = False
            self.after(0, lambda: self.set_status(f'{len(certs)} certificados cargados'))
        threading.Thread(target=load, daemon=True).start()

    def get_certs(self):
        """Devuelve la caché o lista vacía si todavía está cargando."""
        return self._cert_cache or []

    def invalidate_certs(self):
        """Fuerza recarga de la caché de certificados."""
        self._cert_cache = None
        self._preload_certs()

    def _build(self):
        # ── Barra lateral ──────────────────────────────────────────────────
        sb = ctk.CTkFrame(self, width=SIDEBAR_W, fg_color=PRIMARY, corner_radius=0)
        sb.pack(side='left', fill='y')
        sb.pack_propagate(False)
        self._sb = sb

        # Logo
        logo = ctk.CTkFrame(sb, fg_color=PRIMARY_DK, corner_radius=0, height=90)
        logo.pack(fill='x')
        logo.pack_propagate(False)
        ctk.CTkLabel(logo, text='🔐', font=ctk.CTkFont(size=28)).pack(pady=(18, 0))
        ctk.CTkLabel(logo, text='CertManager',
                     font=ctk.CTkFont(size=14, weight='bold'), text_color=ACCENT,
                     ).pack(pady=(2, 14))

        # Nav
        nav = [
            ('🏠', 'Inicio',          'dashboard'),
            ('📋', 'Certificados',    'certificates'),
            ('📬', 'DEHU',            'dehu'),
            ('🏛', 'Servicios',       'servicios'),
            ('🗑', 'Limpiar',          'clean'),
            ('📊', 'Informe',         'report'),
            ('⚙️', 'Configuración',   'settings'),
        ]
        self._nav_btns = {}
        nav_box = ctk.CTkFrame(sb, fg_color='transparent')
        nav_box.pack(fill='x', pady=10)
        for icon, label, page in nav:
            f = ctk.CTkFrame(nav_box, fg_color='transparent', height=46)
            f.pack(fill='x')
            f.pack_propagate(False)
            self._nav_btns[page] = f
            btn = ctk.CTkButton(
                f, text=f'{icon}  {label}', anchor='w',
                font=ctk.CTkFont(size=13), height=46,
                fg_color='transparent', hover_color=PRIMARY_DK,
                text_color='#ffffff', corner_radius=0,
                command=lambda p=page: self._show(p),
            )
            btn.pack(fill='both', expand=True)
            f._btn = btn

        # Pie
        ctk.CTkLabel(sb, text='v1.0 · Windows 11',
                     font=ctk.CTkFont(size=10), text_color='#c8b8e8',
                     ).pack(side='bottom', pady=12)

        # ── Contenido ──────────────────────────────────────────────────────
        self.content = ctk.CTkFrame(self, fg_color=BG, corner_radius=0)
        self.content.pack(side='left', fill='both', expand=True)

        # Barra de estado inferior
        self._statusbar = ctk.CTkFrame(self, height=28, fg_color=PRIMARY_DK, corner_radius=0)
        self._statusbar.pack(side='bottom', fill='x')
        self._status_lbl = ctk.CTkLabel(
            self._statusbar, text='Listo',
            font=ctk.CTkFont(size=11), text_color='#c8b8e8',
        )
        self._status_lbl.pack(side='left', padx=12)
        self._clock_lbl = ctk.CTkLabel(
            self._statusbar, text='',
            font=ctk.CTkFont(size=11), text_color='#c8b8e8',
        )
        self._clock_lbl.pack(side='right', padx=12)
        self._tick()

    def _tick(self):
        self._clock_lbl.configure(text=datetime.now().strftime('%d/%m/%Y  %H:%M:%S'))
        self.after(1000, self._tick)

    def set_status(self, msg: str, color: str = '#c8b8e8'):
        self._status_lbl.configure(text=msg, text_color=color)

    def _show(self, name: str):
        if self._page:
            self._page.pack_forget()
        for pname, f in self._nav_btns.items():
            active = pname == name
            f.configure(fg_color=PRIMARY_LT if active else 'transparent')
            f._btn.configure(
                fg_color=PRIMARY_LT if active else 'transparent',
                text_color=PRIMARY if active else '#ffffff',
                font=ctk.CTkFont(size=13, weight='bold' if active else 'normal'),
            )
        pages = {
            'dashboard':    DashboardPage,
            'certificates': CertificatesPage,
            'dehu':         DehuPage,
            'servicios':    ServiciosPage,
            'clean':        CleanPage,
            'report':       ReportPage,
            'settings':     SettingsPage,
        }
        if name in pages:
            self._page      = pages[name](self.content, self.cfg, app=self)
            self._page_name = name
            self._page.pack(fill='both', expand=True)

    def reload_config(self):
        self.cfg = cfg_module.load()
        if self._page_name:
            self._show(self._page_name)


# ── Páginas ──────────────────────────────────────────────────────────────────

class DashboardPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg = cfg
        self.app = app
        hdr = page_header(self, '🏠', 'Inicio', 'Resumen del estado de tus certificados y DEHU')
        action_btn(hdr, '🔄  Actualizar', PRIMARY_DK, self._refresh, width=130).pack(
            side='right', padx=16, pady=14)
        self._build()

    def _refresh(self):
        if self.app:
            self.app.invalidate_certs()
            self.app._show('dashboard')

    def _build(self):
        certs = self.app.get_certs() if self.app else []

        total    = len(certs)
        valid    = sum(1 for c in certs if c.get('status') == 'valid')
        expiring = sum(1 for c in certs if c.get('status') == 'expiring_soon')
        expired  = sum(1 for c in certs if c.get('status') == 'expired')

        # Tarjetas
        row = ctk.CTkFrame(self, fg_color='transparent')
        row.pack(fill='x', padx=20, pady=(0, 6))
        stat_card(row, '📜', 'Total',          str(total),    PRIMARY)
        stat_card(row, '✅', 'Válidos',         str(valid),    SUCCESS)
        stat_card(row, '⏰', 'Caducan pronto',  str(expiring), WARNING)
        stat_card(row, '❌', 'Caducados',       str(expired),  DANGER)

        # Alertas
        if expired > 0 or expiring > 0:
            a = ctk.CTkFrame(self, fg_color='#fff8e1', corner_radius=10,
                             border_width=1, border_color='#ffe082')
            a.pack(fill='x', padx=20, pady=(0, 8))
            if expired > 0:
                ctk.CTkLabel(a,
                             text=f'❌  {expired} certificado(s) CADUCADO(S) — ve a "🗑 Limpiar" para eliminarlos',
                             font=ctk.CTkFont(size=12), text_color='#7b3f00',
                             ).pack(anchor='w', padx=16, pady=(10, 2))
            if expiring > 0:
                ctk.CTkLabel(a,
                             text=f'⏰  {expiring} certificado(s) caducan en menos de {alert_days} días',
                             font=ctk.CTkFont(size=12), text_color='#7b3f00',
                             ).pack(anchor='w', padx=16, pady=(2, 10))

        # Lista
        scroll = ctk.CTkScrollableFrame(self, fg_color=CARD, corner_radius=12,
                                         border_width=1, border_color=BORDER,
                                         label_text='Certificados instalados',
                                         label_font=ctk.CTkFont(size=12, weight='bold'),
                                         label_text_color=TEXT_MUTED)
        scroll.pack(fill='both', expand=True, padx=20, pady=(0, 16))

        if not certs:
            ctk.CTkLabel(scroll, text='No se encontraron certificados.\n(Disponible solo en Windows)',
                         text_color=TEXT_MUTED, font=ctk.CTkFont(size=13)).pack(pady=40)
            return

        tbl_header(scroll, [('Titular', 330), ('Emisor', 195), ('Caduca', 110), ('Estado', 150)])
        for i, c in enumerate(sorted(certs, key=lambda x: x.get('days_remaining', 9999))):
            bg  = PRIMARY_LT if i % 2 == 0 else CARD
            r   = ctk.CTkFrame(scroll, fg_color=bg, corner_radius=5)
            r.pack(fill='x', pady=1)
            ctk.CTkLabel(r, text=c.get('subject','')[:46], width=330, anchor='w',
                         font=ctk.CTkFont(size=12), text_color=TEXT).pack(side='left', padx=10, pady=7)
            ctk.CTkLabel(r, text=c.get('issuer','')[:27], width=195, anchor='w',
                         font=ctk.CTkFont(size=12), text_color=TEXT_MUTED).pack(side='left', padx=4)
            ctk.CTkLabel(r, text=c.get('not_after','')[:10], width=110, anchor='w',
                         font=ctk.CTkFont(size=12)).pack(side='left', padx=4)
            badge(r, c.get('status_label',''), c.get('status','')).pack(side='left', padx=6)


class CertificatesPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg = cfg
        self.app = app
        page_header(self, '📋', 'Certificados', 'Todos los certificados instalados en Windows')
        self._all = app.get_certs() if app else []
        self._build()

    def _build(self):
        # Filtros
        bar = card(self)
        bar.pack(fill='x', padx=20, pady=(0, 8))
        inner = ctk.CTkFrame(bar, fg_color='transparent')
        inner.pack(fill='x', padx=12, pady=10)
        ctk.CTkLabel(inner, text='Filtrar:', font=ctk.CTkFont(size=12),
                     text_color=TEXT_MUTED).pack(side='left', padx=(0, 8))
        self._fbts = {}
        for lbl in ('Todos', 'Válidos', 'Caducan pronto', 'Caducados'):
            active = lbl == 'Todos'
            b = ctk.CTkButton(
                inner, text=lbl, width=118, height=30,
                fg_color=PRIMARY if active else 'transparent',
                text_color='#ffffff' if active else TEXT,
                border_width=1, border_color=PRIMARY,
                corner_radius=8,
                command=lambda l=lbl: self._filter(l),
            )
            b.pack(side='left', padx=3)
            self._fbts[lbl] = b

        # Contador
        self._count_lbl = ctk.CTkLabel(inner, text=f'{len(self._all)} certificado(s)',
                                        font=ctk.CTkFont(size=12), text_color=TEXT_MUTED)
        self._count_lbl.pack(side='right', padx=8)

        # Tabla
        self._scroll = ctk.CTkScrollableFrame(self, fg_color=CARD, corner_radius=12,
                                               border_width=1, border_color=BORDER)
        self._scroll.pack(fill='both', expand=True, padx=20, pady=(0, 16))
        self._render(self._all)

    def _filter(self, label: str):
        for l, b in self._fbts.items():
            active = l == label
            b.configure(fg_color=PRIMARY if active else 'transparent',
                        text_color='#ffffff' if active else TEXT)
        mapping = {'Válidos': 'valid', 'Caducan pronto': 'expiring_soon', 'Caducados': 'expired'}
        st      = mapping.get(label)
        data    = [c for c in self._all if c.get('status') == st] if st else self._all
        self._count_lbl.configure(text=f'{len(data)} certificado(s)')
        for w in self._scroll.winfo_children():
            w.destroy()
        self._render(data)

    def _render(self, certs: list):
        cols = [('Almacén', 72), ('Titular', 280), ('Emisor', 170),
                ('Caduca', 105), ('Días', 60), ('Estado', 148)]
        tbl_header(self._scroll, cols)
        if not certs:
            ctk.CTkLabel(self._scroll, text='Sin resultados.',
                         text_color=TEXT_MUTED, font=ctk.CTkFont(size=13)).pack(pady=24)
            return
        for i, c in enumerate(certs):
            bg  = PRIMARY_LT if i % 2 == 0 else CARD
            r   = ctk.CTkFrame(self._scroll, fg_color=bg, corner_radius=5)
            r.pack(fill='x', pady=1)
            days = c.get('days_remaining', '')
            ds   = str(days) if isinstance(days, int) and days >= 0 else '—'
            for val, w in [
                (c.get('store',''), 72),
                (c.get('subject','')[:38], 280),
                (c.get('issuer','')[:23], 170),
                (c.get('not_after','')[:10], 105),
                (ds, 60),
            ]:
                ctk.CTkLabel(r, text=val, width=w, anchor='w',
                             font=ctk.CTkFont(size=11)).pack(side='left', padx=8, pady=6)
            badge(r, c.get('status_label',''), c.get('status','')).pack(side='left', padx=6)


class DehuPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg    = cfg
        self.app    = app
        self._result = None
        page_header(self, '📬', 'DEHU', 'Comprueba y descarga notificaciones de dehu.redsara.es')
        self._build()

    def _build(self):
        cert_path = self.cfg['dehu']['cert_pfx_path'].strip().strip('"\'')

        # ── Tarjeta: certificado en uso ─────────────────────────────────────
        cert_card = card(self)
        cert_card.pack(fill='x', padx=20, pady=(0, 10))

        section_label(cert_card, '🔐  Certificado utilizado para conectar con DEHU')
        divider(cert_card)

        info_row = ctk.CTkFrame(cert_card, fg_color='transparent')
        info_row.pack(fill='x', padx=16, pady=12)

        if not cert_path:
            ctk.CTkLabel(info_row,
                         text='⚠  Sin certificado configurado. Ve a ⚙️ Configuración.',
                         text_color=DANGER, font=ctk.CTkFont(size=13)).pack(anchor='w')
            return

        info = _load_pfx_info(cert_path, self.cfg['dehu'].get('cert_password', ''))

        if not info.get('ok'):
            ctk.CTkLabel(info_row,
                         text=f'⚠  No se pudo leer el certificado: {info.get("error","")}',
                         text_color=DANGER, font=ctk.CTkFont(size=12)).pack(anchor='w')
        else:
            # Icono
            ctk.CTkLabel(info_row, text='🪪', font=ctk.CTkFont(size=36)
                         ).pack(side='left', padx=(0, 14))

            # Datos del certificado
            det = ctk.CTkFrame(info_row, fg_color='transparent')
            det.pack(side='left', fill='x', expand=True)

            ctk.CTkLabel(det, text=info['name'],
                         font=ctk.CTkFont(size=15, weight='bold'), text_color=TEXT,
                         anchor='w').pack(anchor='w')
            ctk.CTkLabel(det, text=f"Emisor: {info['issuer']}",
                         font=ctk.CTkFont(size=12), text_color=TEXT_MUTED,
                         anchor='w').pack(anchor='w', pady=(2, 0))

            exp_color = DANGER if info['status'] == 'expired' else (WARNING if info['status'] == 'expiring_soon' else TEXT_MUTED)
            days_txt  = f"Caduca: {info['expiry']}  ({info['days']} días restantes)"
            if info['status'] == 'expired':
                days_txt = f"⚠  CADUCADO el {info['expiry']}"
            elif info['status'] == 'expiring_soon':
                days_txt = f"⏰  Caduca el {info['expiry']}  ({info['days']} días restantes)"
            ctk.CTkLabel(det, text=days_txt,
                         font=ctk.CTkFont(size=12), text_color=exp_color,
                         anchor='w').pack(anchor='w', pady=(2, 0))

            # Badge de estado
            badge(info_row, info.get('status','').replace('_',' ').title(), info.get('status','')
                  ).pack(side='right', padx=12)

        # ── Botones de acción ───────────────────────────────────────────────
        bar = card(self)
        bar.pack(fill='x', padx=20, pady=(0, 10))
        brow = ctk.CTkFrame(bar, fg_color='transparent')
        brow.pack(fill='x', padx=14, pady=12)

        self._check_btn = action_btn(brow, '🔍  Comprobar DEHU', PRIMARY, self._check, width=190)
        self._check_btn.pack(side='left', padx=(0, 8))

        self._dl_btn = action_btn(brow, '⬇  Descargar PDFs', ACCENT, self._download,
                                   width=170, state='disabled',
                                   text_color=TEXT, hover_color=ACCENT_DK)
        self._dl_btn.pack(side='left', padx=(0, 8))

        self._prog = ctk.CTkProgressBar(brow, width=140, height=8, mode='indeterminate',
                                         fg_color=BORDER, progress_color=ACCENT)
        self._prog.pack(side='left', padx=8)
        self._prog.set(0)

        self._status = ctk.CTkLabel(brow, text='', font=ctk.CTkFont(size=12), text_color=TEXT_MUTED)
        self._status.pack(side='left', padx=8)

        # ── Resultados ──────────────────────────────────────────────────────
        self._res = ctk.CTkScrollableFrame(
            self, fg_color=CARD, corner_radius=12,
            border_width=1, border_color=BORDER,
            label_text='Notificaciones en el buzón',
            label_font=ctk.CTkFont(size=12, weight='bold'),
            label_text_color=TEXT_MUTED,
        )
        self._res.pack(fill='both', expand=True, padx=20, pady=(0, 16))
        ctk.CTkLabel(self._res,
                     text='Haz clic en "Comprobar DEHU" para ver las notificaciones.',
                     text_color=TEXT_MUTED, font=ctk.CTkFont(size=13)).pack(pady=40)

    def _check(self):
        self._check_btn.configure(state='disabled', text='⏳  Comprobando...')
        self._prog.start()
        if self.app:
            self.app.set_status('Conectando con DEHU...', ACCENT)
        threading.Thread(target=self._do_check, daemon=True).start()

    def _do_check(self):
        from cert_manager.dehu_session import DEHUSession
        from cert_manager import dehu_checker
        cert_path  = self.cfg['dehu']['cert_pfx_path'].strip().strip('"\'')
        log_folder = Path(self.cfg['general']['log_folder'])
        try:
            with DEHUSession(cert_path, self.cfg['dehu']['cert_password'],
                             self.cfg['dehu']['base_url'],
                             int(self.cfg['dehu']['timeout'])) as session:
                self._result = dehu_checker.check(session, log_folder)
            self.after(0, self._show_results)
        except Exception as e:
            self.after(0, lambda: self._show_error(str(e)))

    def _show_results(self):
        self._check_btn.configure(state='normal', text='🔍  Comprobar DEHU')
        self._prog.stop()
        self._prog.set(0)

        for w in self._res.winfo_children():
            w.destroy()

        if not self._result or 'error' in self._result:
            err = (self._result or {}).get('error', 'Error desconocido')
            self._show_error(err)
            return

        total = self._result['total']
        nuevas = self._result['new']
        n_new  = len(nuevas)

        ahora = datetime.now().strftime('%H:%M:%S')
        self._status.configure(
            text=f'Total: {total}  ·  Nuevas: {n_new}  ·  {ahora}',
            text_color=DANGER if n_new > 0 else SUCCESS,
        )
        if self.app:
            self.app.set_status(f'DEHU: {total} notificaciones, {n_new} nuevas — {ahora}',
                                DANGER if n_new > 0 else '#c8b8e8')

        if n_new > 0:
            self._dl_btn.configure(state='normal')
            banner = ctk.CTkFrame(self._res, fg_color=SUCCESS_LT, corner_radius=8,
                                   border_width=1, border_color='#a5d6a7')
            banner.pack(fill='x', pady=(0, 8))
            ctk.CTkLabel(banner,
                         text=f'🔔  {n_new} notificación(es) nueva(s) desde la última comprobación',
                         text_color=SUCCESS, font=ctk.CTkFont(size=13, weight='bold'),
                         ).pack(padx=14, pady=10)

        if not self._result['all']:
            ctk.CTkLabel(self._res, text='El buzón DEHU está vacío.',
                         text_color=TEXT_MUTED, font=ctk.CTkFont(size=13)).pack(pady=30)
            return

        tbl_header(self._res, [('Fecha', 108), ('Organismo', 215), ('Asunto', 305), ('Estado', 110)])
        for i, n in enumerate(self._result['all']):
            es_nueva = n in nuevas
            bg = '#fff8e1' if es_nueva else (PRIMARY_LT if i % 2 == 0 else CARD)
            r  = ctk.CTkFrame(self._res, fg_color=bg, corner_radius=5)
            r.pack(fill='x', pady=1)
            for val, w in [
                (n.get('fecha',''), 108),
                (n.get('organismo','')[:29], 215),
                (n.get('asunto','')[:43], 305),
            ]:
                ctk.CTkLabel(r, text=val, width=w, anchor='w',
                             font=ctk.CTkFont(size=11)).pack(side='left', padx=8, pady=6)
            estado = '🆕 Nueva' if es_nueva else ('✓ Leída' if n.get('leida') else '● Pendiente')
            color  = WARNING if es_nueva else (TEXT_MUTED if n.get('leida') else DANGER)
            ctk.CTkLabel(r, text=estado, width=110, anchor='w',
                         font=ctk.CTkFont(size=11, weight='bold' if es_nueva else 'normal'),
                         text_color=color).pack(side='left', padx=8)

    def _show_error(self, msg: str):
        self._check_btn.configure(state='normal', text='🔍  Comprobar DEHU')
        self._prog.stop()
        self._prog.set(0)
        self._status.configure(text=f'Error de conexión', text_color=DANGER)
        if self.app:
            self.app.set_status(f'Error DEHU: {msg[:60]}', DANGER)
        for w in self._res.winfo_children():
            w.destroy()
        err_card = ctk.CTkFrame(self._res, fg_color='#fdecea', corner_radius=10,
                                 border_width=1, border_color='#f5c6cb')
        err_card.pack(fill='x', pady=20, padx=10)
        ctk.CTkLabel(err_card, text='❌  Error al conectar con DEHU',
                     font=ctk.CTkFont(size=13, weight='bold'), text_color=DANGER).pack(padx=16, pady=(12, 4))
        ctk.CTkLabel(err_card, text=msg, text_color='#7b1f1f',
                     font=ctk.CTkFont(size=11), wraplength=540).pack(padx=16, pady=(0, 12))

    def _download(self):
        if not self._result:
            return
        from cert_manager.dehu_session import DEHUSession
        from cert_manager import dehu_downloader
        cert_path = self.cfg['dehu']['cert_pfx_path'].strip().strip('"\'')
        dest      = Path(self.cfg['general']['download_folder'])
        self._dl_btn.configure(state='disabled', text='⏳  Descargando...')
        self._prog.start()

        def do():
            try:
                with DEHUSession(cert_path, self.cfg['dehu']['cert_password'],
                                 self.cfg['dehu']['base_url'],
                                 int(self.cfg['dehu']['timeout'])) as session:
                    r = dehu_downloader.download_notifications(
                        session, self._result['all'], dest, safe_mode=False,
                    )
                n = len(r['downloaded'])
                self.after(0, lambda: messagebox.showinfo(
                    'Descarga completada',
                    f'✓  {n} PDF(s) guardados en:\n{dest}\n\nÍndice HTML: {dest / "indice.html"}',
                ))
                if self.app:
                    self.after(0, lambda: self.app.set_status(f'{n} PDFs descargados en {dest}'))
            except Exception as e:
                self.after(0, lambda: messagebox.showerror('Error de descarga', str(e)))
            finally:
                self.after(0, lambda: (
                    self._dl_btn.configure(state='normal', text='⬇  Descargar PDFs'),
                    self._prog.stop(),
                ))

        threading.Thread(target=do, daemon=True).start()


class CleanPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg      = cfg
        self.app      = app
        self._expired = []
        self._checks  = {}
        page_header(self, '🗑', 'Limpiar', 'Elimina certificados caducados del almacén de Windows')
        self._build()

    def _build(self):
        bar = card(self)
        bar.pack(fill='x', padx=20, pady=(0, 10))
        brow = ctk.CTkFrame(bar, fg_color='transparent')
        brow.pack(fill='x', padx=14, pady=12)

        action_btn(brow, '🔍  Buscar caducados', PRIMARY, self._scan, width=185).pack(side='left', padx=(0, 8))
        self._del_btn = action_btn(brow, '🗑  Eliminar seleccionados', DANGER, self._delete,
                                    width=210, state='disabled')
        self._del_btn.pack(side='left', padx=(0, 8))
        self._info = ctk.CTkLabel(brow, text='', font=ctk.CTkFont(size=12), text_color=TEXT_MUTED)
        self._info.pack(side='left', padx=8)

        self._scroll = ctk.CTkScrollableFrame(
            self, fg_color=CARD, corner_radius=12, border_width=1, border_color=BORDER,
            label_text='Certificados caducados encontrados',
            label_font=ctk.CTkFont(size=12, weight='bold'),
            label_text_color=TEXT_MUTED,
        )
        self._scroll.pack(fill='both', expand=True, padx=20, pady=(0, 16))
        ctk.CTkLabel(self._scroll, text='Haz clic en "Buscar caducados" para empezar.',
                     text_color=TEXT_MUTED, font=ctk.CTkFont(size=13)).pack(pady=40)

    def _scan(self):
        # Escanea en background para no bloquear la UI
        self._info.configure(text='Buscando...', text_color=TEXT_MUTED)
        self._del_btn.configure(state='disabled')
        for w in self._scroll.winfo_children():
            w.destroy()
        ctk.CTkLabel(self._scroll, text='⏳  Escaneando almacén de certificados...',
                     text_color=TEXT_MUTED, font=ctk.CTkFont(size=13)).pack(pady=40)

        def do_scan():
            certs = cert_scanner.scan(['MY'])
            if certs:
                certs = cert_validator.validate(certs)
            expired = cert_validator.filter_expired(certs)
            self.after(0, lambda: self._show_expired(expired))

        threading.Thread(target=do_scan, daemon=True).start()

    def _show_expired(self, expired: list):
        self._expired = expired
        self._checks  = {}
        for w in self._scroll.winfo_children():
            w.destroy()

        if not self._expired:
            ok = ctk.CTkFrame(self._scroll, fg_color=SUCCESS_LT, corner_radius=10,
                               border_width=1, border_color='#a5d6a7')
            ok.pack(fill='x', pady=20, padx=10)
            ctk.CTkLabel(ok, text='✅  ¡El almacén está limpio! No hay certificados caducados.',
                         text_color=SUCCESS, font=ctk.CTkFont(size=13, weight='bold')).pack(pady=16)
            self._del_btn.configure(state='disabled')
            self._info.configure(text='')
            return

        self._info.configure(text=f'{len(self._expired)} caducado(s)', text_color=DANGER)
        self._del_btn.configure(state='normal')

        for c in self._expired:
            r = ctk.CTkFrame(self._scroll, fg_color='#fef6f6', corner_radius=10,
                              border_width=1, border_color='#f5c6cb')
            r.pack(fill='x', pady=5, padx=4)
            var = ctk.BooleanVar(value=True)
            self._checks[c.get('thumbprint', '')] = (var, c)

            ctk.CTkCheckBox(r, text='', variable=var, width=24,
                             checkmark_color=PRIMARY, fg_color=PRIMARY,
                             hover_color=PRIMARY_DK).pack(side='left', padx=12, pady=14)
            info = ctk.CTkFrame(r, fg_color='transparent')
            info.pack(side='left', fill='x', expand=True, pady=10)
            ctk.CTkLabel(info, text=c.get('subject',''),
                         font=ctk.CTkFont(size=13, weight='bold'), text_color=TEXT,
                         anchor='w').pack(anchor='w')
            ctk.CTkLabel(info,
                         text=f"Emisor: {c.get('issuer','')}   ·   Caducó: {c.get('not_after','')[:10]}   ·   Almacén: {c.get('store','')}",
                         font=ctk.CTkFont(size=11), text_color=TEXT_MUTED, anchor='w',
                         ).pack(anchor='w', pady=(3, 0))
            ctk.CTkLabel(r, text='✗ CADUCADO', text_color=DANGER,
                         font=ctk.CTkFont(size=11, weight='bold')).pack(side='right', padx=16)

    def _delete(self):
        sel = [(v, c) for v, c in self._checks.values() if v.get()]
        if not sel:
            messagebox.showwarning('Nada seleccionado', 'Marca al menos un certificado.')
            return
        if not messagebox.askyesno(
            'Confirmar eliminación',
            f'¿Eliminar {len(sel)} certificado(s) caducado(s)?\n\nEsta acción no se puede deshacer.',
            icon='warning',
        ):
            return
        ok = err = 0
        for v, c in sel:
            if cert_scanner.delete_by_thumbprint('MY', c.get('thumbprint', '')):
                ok += 1
            else:
                err += 1
        msg = f'✓  Eliminados: {ok}'
        if err:
            msg += f'\n✗  Errores: {err}\n\nSi hay errores, abre PowerShell como Administrador.'
        messagebox.showinfo('Resultado', msg)
        if self.app:
            self.app.set_status(f'Limpiar: {ok} certificados eliminados')
            self.app.invalidate_certs()
        self._scan()


class ServiciosPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg = cfg
        self.app = app
        page_header(
            self, '🏛', 'Servicios Gubernamentales',
            'Descarga documentos oficiales con tu certificado digital',
        )
        self._build()

    def _build(self):
        from cert_manager import servicios

        cert_path = self.cfg['dehu']['cert_pfx_path'].strip().strip('"\'')
        password  = self.cfg['dehu'].get('cert_password', '').strip()
        dest_base = Path(self.cfg['general']['download_folder']) / 'servicios'

        if not cert_path:
            warn = ctk.CTkFrame(self, fg_color='#fff8e1', corner_radius=10,
                                border_width=1, border_color='#ffe082')
            warn.pack(fill='x', padx=20, pady=(0, 10))
            ctk.CTkLabel(warn, text='⚠  Sin certificado configurado. Ve a ⚙️ Configuración.',
                         text_color='#7b3f00', font=ctk.CTkFont(size=12)).pack(padx=16, pady=10)

        scroll = ctk.CTkScrollableFrame(self, fg_color='transparent')
        scroll.pack(fill='both', expand=True, padx=20, pady=(0, 16))

        for svc in servicios.SERVICES:
            self._service_card(scroll, svc, cert_path, password, dest_base)

    def _service_card(self, parent, svc: dict, cert_path: str, password: str, dest_base: Path):
        c = card(parent)
        c.pack(fill='x', pady=8)

        hdr = ctk.CTkFrame(c, fg_color='transparent')
        hdr.pack(fill='x', padx=16, pady=(14, 6))
        ctk.CTkLabel(hdr, text=svc['icon'], font=ctk.CTkFont(size=30)).pack(side='left', padx=(0, 12))

        title_box = ctk.CTkFrame(hdr, fg_color='transparent')
        title_box.pack(side='left', fill='x', expand=True)
        ctk.CTkLabel(title_box, text=svc['name'],
                     font=ctk.CTkFont(size=14, weight='bold'), text_color=TEXT,
                     anchor='w').pack(anchor='w')
        ctk.CTkLabel(title_box, text=svc['organismo'],
                     font=ctk.CTkFont(size=11), text_color=TEXT_MUTED,
                     anchor='w').pack(anchor='w')

        divider(c)

        ctk.CTkLabel(c, text=svc['description'],
                     font=ctk.CTkFont(size=12), text_color=TEXT_MUTED,
                     anchor='w', wraplength=680).pack(anchor='w', padx=16, pady=(8, 6))

        brow = ctk.CTkFrame(c, fg_color='transparent')
        brow.pack(fill='x', padx=16, pady=(0, 14))

        status_lbl = ctk.CTkLabel(brow, text='', font=ctk.CTkFont(size=11),
                                   text_color=TEXT_MUTED)

        def do_auto(s=svc, sl=status_lbl):
            if not cert_path:
                sl.configure(text='⚠  Configura primero tu certificado', text_color=WARNING)
                return
            sl.configure(text='⏳  Descargando...', text_color=TEXT_MUTED)
            threading.Thread(
                target=self._run_download, args=(s, cert_path, password, dest_base, sl),
                daemon=True,
            ).start()

        def do_browser(s=svc):
            from cert_manager import servicios as sv
            sv.open_in_browser(s)
            if self.app:
                self.app.set_status(f'Abriendo {s["name"]} en el navegador...')

        action_btn(brow, '🤖  Descarga automática', PRIMARY, do_auto, width=195).pack(side='left', padx=(0, 8))
        action_btn(brow, '🌐  Abrir en navegador', '#546e7a', do_browser, width=178).pack(side='left', padx=(0, 12))
        status_lbl.pack(side='left', padx=4)

    def _run_download(self, svc: dict, cert_path: str, password: str,
                      dest_base: Path, status_lbl):
        from cert_manager import servicios
        result = servicios.try_download(svc, cert_path, password, dest_base)
        self.after(0, lambda: self._on_result(svc, result, status_lbl))

    def _on_result(self, svc: dict, result: dict, status_lbl):
        if result['ok']:
            p = result['path']
            status_lbl.configure(text=f'✓  {p.name}', text_color=SUCCESS)
            if self.app:
                self.app.set_status(f'{svc["name"]} guardado: {p}')
            messagebox.showinfo('Descarga completada',
                                f'✓  {svc["name"]}\n\nGuardado en:\n{p}')
        else:
            err = result['error']
            status_lbl.configure(text='⚠  No disponible automáticamente', text_color=WARNING)
            if self.app:
                self.app.set_status(f'{svc["name"]}: requiere navegador', WARNING)
            if messagebox.askyesno(
                'Descarga automática no disponible',
                f'{err}\n\n¿Abrir el portal en el navegador?',
            ):
                from cert_manager import servicios
                servicios.open_in_browser(svc)


class ReportPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg  = cfg
        self.app  = app
        page_header(self, '📊', 'Informe', 'Genera informes de tus certificados en distintos formatos')
        self._build()

    def _build(self):
        top = card(self)
        top.pack(fill='x', padx=20, pady=(0, 10))
        folder = Path(self.cfg['general']['report_folder'])
        section_label(top, '📁  Carpeta de salida')
        divider(top)
        frow = ctk.CTkFrame(top, fg_color='transparent')
        frow.pack(fill='x', padx=16, pady=12)
        ctk.CTkLabel(frow, text=str(folder), font=ctk.CTkFont(size=12),
                     text_color=TEXT_MUTED).pack(side='left')
        action_btn(frow, '📂  Abrir', PRIMARY_DK, lambda: self._open(folder),
                    width=110).pack(side='right')

        btns = card(self)
        btns.pack(fill='x', padx=20, pady=(0, 10))
        brow = ctk.CTkFrame(btns, fg_color='transparent')
        brow.pack(fill='x', padx=14, pady=12)
        action_btn(brow, '📄  Generar HTML', PRIMARY,      lambda: self._gen('html'), width=160).pack(side='left', padx=(0, 8))
        action_btn(brow, '📋  Generar CSV',  ACCENT,       lambda: self._gen('csv'),  width=148,
                    text_color=BLACK, hover_color=ACCENT_DK).pack(side='left', padx=(0, 8))
        action_btn(brow, '🗂  Generar JSON', '#546e7a',    lambda: self._gen('json'), width=148).pack(side='left')

        log_card = card(self)
        log_card.pack(fill='both', expand=True, padx=20, pady=(0, 16))
        section_label(log_card, '📋  Registro de acciones')
        divider(log_card)
        self._log = ctk.CTkTextbox(log_card, font=ctk.CTkFont(size=11, family='Courier'),
                                    fg_color='#1e1e2e', text_color='#cdd6f4', corner_radius=0)
        self._log.pack(fill='both', expand=True, padx=0, pady=0)
        self._log_line('Listo. Pulsa un botón para generar el informe.')
        self._log.configure(state='disabled')

    def _gen(self, fmt: str):
        folder = Path(self.cfg['general']['report_folder'])
        certs  = self.app.get_certs() if self.app else []
        try:
            if fmt == 'html':
                path = reporter.generate_html(certs, folder / 'informe_certificados.html')
            elif fmt == 'csv':
                path = reporter.generate_csv(certs, folder / 'certificados.csv')
            else:
                path = reporter.generate_json(certs, folder / 'certificados.json')
            self._log_line(f'[{datetime.now().strftime("%H:%M:%S")}] ✓ {fmt.upper()} → {path}')
            if self.app:
                self.app.set_status(f'Informe {fmt.upper()} generado: {path}')
        except Exception as e:
            self._log_line(f'[ERROR] {e}')

    def _log_line(self, text: str):
        self._log.configure(state='normal')
        self._log.insert('end', text + '\n')
        self._log.see('end')
        self._log.configure(state='disabled')

    def _open(self, path: Path):
        import subprocess
        if sys.platform == 'win32':
            path.mkdir(parents=True, exist_ok=True)
            subprocess.run(['explorer', str(path)])


class SettingsPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg     = cfg
        self.app     = app
        self._fields = {}
        page_header(self, '⚙️', 'Configuración', 'Ajusta los parámetros del gestor')
        self._build()

    def _build(self):
        scroll = ctk.CTkScrollableFrame(self, fg_color='transparent')
        scroll.pack(fill='both', expand=True, padx=20, pady=(0, 10))

        secs = [
            ('🔐  Certificado para DEHU', [
                ('cert_pfx_path', 'Ruta del certificado (.pfx / .p12)', 'dehu',    True),
                ('cert_password', 'Contraseña del certificado',          'dehu',    False),
                ('base_url',      'URL del portal DEHU',                  'dehu',    False),
            ]),
            ('⚙️  General', [
                ('alert_days',      'Días de alerta antes de caducar',  'general', False),
                ('check_time',      'Hora comprobación diaria (HH:MM)', 'general', False),
                ('download_folder', 'Carpeta de descarga de PDFs',       'general', True),
                ('report_folder',   'Carpeta de informes generados',     'general', True),
            ]),
        ]

        for title, fields in secs:
            sec = card(scroll)
            sec.pack(fill='x', pady=8)
            section_label(sec, title)
            divider(sec)
            for key, label, cfg_sec, has_browse in fields:
                r = ctk.CTkFrame(sec, fg_color='transparent')
                r.pack(fill='x', padx=16, pady=7)
                ctk.CTkLabel(r, text=label, width=260, anchor='w',
                             font=ctk.CTkFont(size=12), text_color=TEXT).pack(side='left')
                show  = '*' if 'password' in key else None
                entry = ctk.CTkEntry(r, width=360, show=show, border_color=BORDER,
                                      fg_color='#faf9fe')
                entry.insert(0, self.cfg[cfg_sec].get(key, ''))
                entry.pack(side='left', padx=8)
                if has_browse:
                    action_btn(r, '📂', PRIMARY, lambda e=entry, k=key: self._browse(e, k),
                                width=38).pack(side='left', padx=2)
                self._fields[(cfg_sec, key)] = entry
            ctk.CTkFrame(sec, height=10, fg_color='transparent').pack()

        action_btn(scroll, '💾  Guardar configuración', SUCCESS, self._save, width=240).pack(pady=14)

    def _browse(self, entry: ctk.CTkEntry, key: str):
        if 'folder' in key:
            path = filedialog.askdirectory(title='Selecciona carpeta')
        else:
            path = filedialog.askopenfilename(
                title='Selecciona tu certificado digital',
                filetypes=[('Certificado digital', '*.pfx *.p12'), ('Todos', '*.*')],
            )
        if path:
            entry.delete(0, 'end')
            entry.insert(0, path)

    def _save(self):
        import configparser
        from cert_manager.config import _CONFIG_FILE
        cfg = configparser.ConfigParser()
        for sec in ('general', 'dehu', 'certificates'):
            cfg[sec] = dict(self.cfg[sec])
        for (sec, key), entry in self._fields.items():
            cfg[sec][key] = entry.get()
        with open(_CONFIG_FILE, 'w', encoding='utf-8') as f:
            cfg.write(f)
        if self.app:
            self.app.reload_config()
        messagebox.showinfo('Guardado', '✓  Configuración guardada correctamente.')
        if self.app:
            self.app.set_status('Configuración guardada')


# ── Punto de entrada ─────────────────────────────────────────────────────────

def main():
    app = App()
    app.mainloop()


if __name__ == '__main__':
    main()
