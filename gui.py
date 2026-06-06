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


def _request_admin() -> None:
    """Re-launch this script with UAC elevation if not already running as admin (Windows only)."""
    if sys.platform != 'win32':
        return
    import ctypes
    try:
        if ctypes.windll.shell32.IsUserAnAdmin():
            return  # already elevated
    except Exception:
        return
    # Build the re-launch command: python "gui.py" [args...]
    script = str(Path(__file__).resolve())
    args   = ' '.join(f'"{a}"' for a in sys.argv[1:])
    ret    = ctypes.windll.shell32.ShellExecuteW(
        None, 'runas', sys.executable, f'"{script}" {args}', None, 1
    )
    # ret > 32 means ShellExecute succeeded (UAC accepted)
    # ret <= 32 means error or user cancelled — continue without elevation
    if ret > 32:
        sys.exit(0)


_request_admin()

import customtkinter as ctk
try:
    from PIL import Image as _PILImage
except ImportError:
    _PILImage = None

from cert_manager import cert_scanner, cert_validator, reporter
from cert_manager import config as cfg_module

# Carpeta de assets junto al script
_ASSETS = Path(__file__).parent / 'assets'

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


# ── Caché de fuentes ─────────────────────────────────────────────────────────
# CustomTkinter crea un objeto CTkFont nuevo por cada widget y los rastrea todos
# para reescalado DPI. Reutilizar instancias reduce drásticamente ese coste y
# acelera el renderizado y el redimensionado de ventana.
_CTkFont    = ctk.CTkFont
_FONT_CACHE = {}


def F(size: int = 13, weight: str = 'normal', **kw):
    key = (size, weight, tuple(sorted(kw.items())))
    f = _FONT_CACHE.get(key)
    if f is None:
        f = _CTkFont(size=size, weight=weight, **kw)
        _FONT_CACHE[key] = f
    return f


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
    ctk.CTkLabel(inner, text=icon, font=F(size=28)).pack(side='left', padx=(0, 10))
    txt = ctk.CTkFrame(inner, fg_color='transparent')
    txt.pack(side='left', fill='x')
    ctk.CTkLabel(txt, text=title,
                 font=F(size=19, weight='bold'), text_color=PRIMARY,
                 anchor='w').pack(anchor='w')
    if subtitle:
        ctk.CTkLabel(txt, text=subtitle,
                     font=F(size=12), text_color=TEXT_MUTED,
                     anchor='w').pack(anchor='w')
    return f


def stat_card(parent, icon: str, title: str, value: str, color: str, text_color: str = '#ffffff'):
    f = ctk.CTkFrame(parent, fg_color=color, corner_radius=12)
    f.pack(side='left', expand=True, fill='both', padx=5, pady=5)
    ctk.CTkLabel(f, text=icon,  font=F(size=22), text_color=text_color).pack(pady=(14, 0))
    ctk.CTkLabel(f, text=value, font=F(size=30, weight='bold'), text_color=text_color).pack(pady=2)
    ctk.CTkLabel(f, text=title, font=F(size=11), text_color=text_color).pack(pady=(0, 14))


def badge(parent, text: str, status: str) -> ctk.CTkLabel:
    colors = {'valid': SUCCESS, 'expiring_soon': WARNING, 'expired': DANGER, 'unknown': TEXT_MUTED}
    icons  = {'valid': '✓', 'expiring_soon': '⚠', 'expired': '✗', 'unknown': '?'}
    color  = colors.get(status, TEXT_MUTED)
    icon   = icons.get(status, '')
    return ctk.CTkLabel(
        parent, text=f'{icon}  {text}',
        fg_color=color, text_color='#ffffff',
        corner_radius=8, font=F(size=11), padx=8, pady=3,
    )


def _status_row_bg(status: str, i: int) -> str:
    """Return a row background tinted by certificate status."""
    if status == 'expired':
        return '#fef2f2'
    if status == 'expiring_soon':
        return '#fffbeb'
    if status == 'valid':
        return '#f0faf4' if i % 2 == 0 else '#f8fffe'
    return PRIMARY_LT if i % 2 == 0 else CARD


def _days_color(status: str) -> str:
    return {
        'expired': DANGER,
        'expiring_soon': WARNING,
        'valid': SUCCESS,
    }.get(status, TEXT_MUTED)


def divider(parent):
    ctk.CTkFrame(parent, height=1, fg_color=BORDER).pack(fill='x', padx=0, pady=0)


def section_label(parent, text: str):
    ctk.CTkLabel(parent, text=text.upper(),
                 font=F(size=10, weight='bold'), text_color=TEXT_MUTED,
                 ).pack(anchor='w', padx=16, pady=(14, 4))


def _load_logo_image(width: int = 180, height: int = 56) -> 'ctk.CTkImage | None':
    """Returns a CTkImage from assets/logo_bz.png, or None if not found / PIL unavailable."""
    if _PILImage is None:
        print(f"[Logo] PIL no instalado — ejecuta: pip install Pillow")
        return None
    print(f"[Logo] Buscando en: {_ASSETS}")
    for name in ('logo_bz.png', 'logo.png', 'logo_bz.jpg', 'logo.jpg'):
        p = _ASSETS / name
        print(f"[Logo]   {name} → {'ENCONTRADO' if p.exists() else 'no existe'}")
        if p.exists():
            try:
                img = _PILImage.open(p).convert('RGBA')
                # Pillow >=10 usa Resampling.LANCZOS; versiones anteriores Image.LANCZOS
                resample = getattr(_PILImage, 'Resampling', _PILImage).LANCZOS
                img.thumbnail((width, height), resample)
                print(f"[Logo] Cargado OK: {p} ({img.width}x{img.height}px)")
                return ctk.CTkImage(light_image=img, dark_image=img,
                                    size=(img.width, img.height))
            except Exception as e:
                print(f"[Logo] Error cargando {p}: {e}")
    print("[Logo] Ningún archivo encontrado — usando logo de texto")
    return None


def tbl_header(parent, cols: list):
    hdr = ctk.CTkFrame(parent, fg_color=PRIMARY, corner_radius=8)
    hdr.pack(fill='x', pady=(0, 4))
    for col, w in cols:
        ctk.CTkLabel(hdr, text=col, width=w, anchor='w',
                     font=F(size=11, weight='bold'), text_color='#ffffff',
                     ).pack(side='left', padx=10, pady=9)


def action_btn(parent, text: str, color: str, cmd, width=160, **kw) -> ctk.CTkButton:
    kw.setdefault('hover_color', _darken(color))
    return ctk.CTkButton(parent, text=text, width=width, height=36,
                         fg_color=color, font=F(size=12),
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
        # Cache de instancias de página: navegar es instantáneo (no se reconstruye)
        self._page_cache  = {}
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
            # gui_stores: solo MY por defecto (rápido). El usuario puede ampliar
            # a CA/ROOT en Configuración si quiere ver los certificados del sistema.
            stores_str = self.cfg['certificates'].get('gui_stores') \
                or self.cfg['certificates'].get('stores', 'MY')
            stores     = [s.strip() for s in stores_str.split(',')]
            alert_days = int(self.cfg['general']['alert_days'])
            certs      = cert_scanner.scan(stores)
            if certs:
                certs = cert_validator.validate(certs, alert_days)
            self._cert_cache   = certs
            self._cert_loading = False
            def done():
                self.set_status(f'{len(certs)} certificados cargados')
                # Refresca la página visible si depende de los certificados
                if self._page_name in ('dashboard', 'certificates'):
                    self.refresh_page(self._page_name)
            self.after(0, done)
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

        # Logo — carga imagen si existe en assets/, de lo contrario usa texto de marca
        logo = ctk.CTkFrame(sb, fg_color=PRIMARY_DK, corner_radius=0, height=90)
        logo.pack(fill='x')
        logo.pack_propagate(False)
        logo_img = _load_logo_image(width=180, height=60)
        if logo_img:
            ctk.CTkLabel(logo, image=logo_img, text='').pack(expand=True)
        else:
            # Fallback tipográfico con colores de marca
            top = ctk.CTkFrame(logo, fg_color='transparent')
            top.pack(expand=True)
            ctk.CTkLabel(top, text='Burocracia',
                         font=F(size=15, weight='bold'),
                         text_color=ACCENT).pack()
            ctk.CTkLabel(top, text='Zero  🔐',
                         font=F(size=13),
                         text_color='#ffffff').pack()

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
                font=F(size=13), height=46,
                fg_color='transparent', hover_color=PRIMARY_DK,
                text_color='#ffffff', corner_radius=0,
                command=lambda p=page: self._show(p),
            )
            btn.pack(fill='both', expand=True)
            f._btn = btn

        # Pie
        ctk.CTkLabel(sb, text='v1.0 · Windows 11',
                     font=F(size=10), text_color='#c8b8e8',
                     ).pack(side='bottom', pady=12)

        # ── Contenido ──────────────────────────────────────────────────────
        self.content = ctk.CTkFrame(self, fg_color=BG, corner_radius=0)
        self.content.pack(side='left', fill='both', expand=True)

        # Barra de estado inferior
        self._statusbar = ctk.CTkFrame(self, height=28, fg_color=PRIMARY_DK, corner_radius=0)
        self._statusbar.pack(side='bottom', fill='x')
        self._status_lbl = ctk.CTkLabel(
            self._statusbar, text='Listo',
            font=F(size=11), text_color='#c8b8e8',
        )
        self._status_lbl.pack(side='left', padx=12)
        self._clock_lbl = ctk.CTkLabel(
            self._statusbar, text='',
            font=F(size=11), text_color='#c8b8e8',
        )
        self._clock_lbl.pack(side='right', padx=12)
        self._tick()

    def _tick(self):
        self._clock_lbl.configure(text=datetime.now().strftime('%d/%m/%Y  %H:%M:%S'))
        self.after(1000, self._tick)

    def set_status(self, msg: str, color: str = '#c8b8e8'):
        self._status_lbl.configure(text=msg, text_color=color)

    _PAGES = None  # se rellena tras definir las clases (al final del módulo)

    def _show(self, name: str, rebuild: bool = False):
        if name not in self._PAGES:
            return
        # Oculta la página actual sin destruirla
        if self._page is not None:
            try:
                self._page.pack_forget()
            except Exception:
                pass

        # Resalta el botón de navegación
        for pname, f in self._nav_btns.items():
            active = pname == name
            f.configure(fg_color=PRIMARY_LT if active else 'transparent')
            f._btn.configure(
                fg_color=PRIMARY_LT if active else 'transparent',
                text_color=PRIMARY if active else '#ffffff',
                font=F(size=13, weight='bold' if active else 'normal'),
            )

        # Reutiliza la instancia cacheada salvo que se pida reconstruir
        if rebuild and name in self._page_cache:
            self._page_cache[name].destroy()
            del self._page_cache[name]

        page = self._page_cache.get(name)
        if page is None:
            page = self._PAGES[name](self.content, self.cfg, app=self)
            self._page_cache[name] = page

        self._page      = page
        self._page_name = name
        page.pack(fill='both', expand=True)

    def refresh_page(self, name: str = None):
        """Fuerza la reconstrucción de una página (datos frescos)."""
        self._show(name or self._page_name, rebuild=True)

    def reload_config(self):
        self.cfg = cfg_module.load()
        # Invalida todas las páginas para que tomen la nueva configuración
        for p in self._page_cache.values():
            p.destroy()
        self._page_cache.clear()
        self._page = None
        # Reescanea certificados por si cambió la lista de almacenes
        self.invalidate_certs()
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
            self.app.refresh_page('dashboard')

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
                             font=F(size=12), text_color='#7b3f00',
                             ).pack(anchor='w', padx=16, pady=(10, 2))
            if expiring > 0:
                ctk.CTkLabel(a,
                             text=f'⏰  {expiring} certificado(s) caducan en menos de {alert_days} días',
                             font=F(size=12), text_color='#7b3f00',
                             ).pack(anchor='w', padx=16, pady=(2, 10))

        # Lista
        scroll = ctk.CTkScrollableFrame(self, fg_color=CARD, corner_radius=12,
                                         border_width=1, border_color=BORDER,
                                         label_text='Certificados instalados',
                                         label_font=F(size=12, weight='bold'),
                                         label_text_color=TEXT_MUTED)
        scroll.pack(fill='both', expand=True, padx=20, pady=(0, 16))

        if not certs:
            ctk.CTkLabel(scroll, text='No se encontraron certificados.\n(Disponible solo en Windows)',
                         text_color=TEXT_MUTED, font=F(size=13)).pack(pady=40)
            return

        tbl_header(scroll, [('Titular', 330), ('Emisor', 195), ('Caduca', 110), ('Estado', 150)])
        for i, c in enumerate(sorted(certs, key=lambda x: x.get('days_remaining', 9999))):
            st  = c.get('status', 'unknown')
            bg  = _status_row_bg(st, i)
            r   = ctk.CTkFrame(scroll, fg_color=bg, corner_radius=5)
            r.pack(fill='x', pady=1)
            ctk.CTkLabel(r, text=c.get('subject','')[:46], width=330, anchor='w',
                         font=F(size=12), text_color=TEXT).pack(side='left', padx=10, pady=7)
            ctk.CTkLabel(r, text=c.get('issuer','')[:27], width=195, anchor='w',
                         font=F(size=12), text_color=TEXT_MUTED).pack(side='left', padx=4)
            ctk.CTkLabel(r, text=c.get('not_after','')[:10], width=110, anchor='w',
                         font=F(size=12), text_color=_days_color(st)).pack(side='left', padx=4)
            badge(r, c.get('status_label',''), st).pack(side='left', padx=6)


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
        ctk.CTkLabel(inner, text='Filtrar:', font=F(size=12),
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
                                        font=F(size=12), text_color=TEXT_MUTED)
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
                         text_color=TEXT_MUTED, font=F(size=13)).pack(pady=24)
            return
        for i, c in enumerate(certs):
            st  = c.get('status', 'unknown')
            bg  = _status_row_bg(st, i)
            r   = ctk.CTkFrame(self._scroll, fg_color=bg, corner_radius=5)
            r.pack(fill='x', pady=1)
            days = c.get('days_remaining', '')
            ds   = str(days) if isinstance(days, int) and days >= 0 else 'CADUCADO'
            for val, w, col in [
                (c.get('store',''), 72, TEXT_MUTED),
                (c.get('subject','')[:38], 280, TEXT),
                (c.get('issuer','')[:23], 170, TEXT_MUTED),
                (c.get('not_after','')[:10], 105, _days_color(st)),
                (ds, 60, _days_color(st)),
            ]:
                ctk.CTkLabel(r, text=val, width=w, anchor='w',
                             font=F(size=11), text_color=col,
                             ).pack(side='left', padx=8, pady=6)
            badge(r, c.get('status_label',''), st).pack(side='left', padx=6)


class DehuPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg    = cfg
        self.app    = app
        self._result = None
        page_header(self, '📬', 'DEHU', 'Comprueba y descarga notificaciones de dehu.redsara.es')
        self._build()

    def _active_cert(self):
        """Devuelve (path, password) del certificado DEHU activo."""
        from cert_manager import dehu_certs
        c = dehu_certs.get_active()
        if c:
            return c['path'].strip().strip('"\''), c.get('password', '')
        # Fallback a config.ini
        return (self.cfg['dehu']['cert_pfx_path'].strip().strip('"\''),
                self.cfg['dehu'].get('cert_password', ''))

    def _build(self):
        from cert_manager import dehu_certs
        self._certs_data = dehu_certs.migrate_from_config(self.cfg)

        # ── Tarjeta: certificados DEHU ──────────────────────────────────────
        cert_card = card(self)
        cert_card.pack(fill='x', padx=20, pady=(0, 10))

        section_label(cert_card, '🔐  Certificados para conectar con DEHU')
        divider(cert_card)

        # Fila selector + botones
        sel = ctk.CTkFrame(cert_card, fg_color='transparent')
        sel.pack(fill='x', padx=16, pady=(10, 2))

        certs = self._certs_data['certs']
        if certs:
            names   = [c['name'] for c in certs]
            act_idx = self._certs_data.get('active', 0)
            act_idx = act_idx if 0 <= act_idx < len(names) else 0
            ctk.CTkLabel(sel, text='Certificado activo:',
                         font=F(size=12), text_color=TEXT).pack(side='left', padx=(0, 8))
            self._cert_menu = ctk.CTkOptionMenu(
                sel, values=names, command=self._on_cert_changed,
                fg_color=PRIMARY, button_color=PRIMARY_DK, button_hover_color=PRIMARY_DK,
                font=F(size=12), dropdown_font=F(size=12), width=260,
            )
            self._cert_menu.set(names[act_idx])
            self._cert_menu.pack(side='left', padx=4)
            action_btn(sel, '🗑', DANGER, self._remove_cert, width=42).pack(side='right', padx=(4, 0))
            action_btn(sel, '➕  Añadir', SUCCESS, self._add_cert, width=110).pack(side='right', padx=4)
        else:
            ctk.CTkLabel(sel, text='No hay certificados guardados para DEHU.',
                         font=F(size=12), text_color=TEXT_MUTED).pack(side='left')
            action_btn(sel, '➕  Añadir certificado', SUCCESS, self._add_cert, width=180).pack(side='right')

        # Tarjeta con la info del certificado activo
        self._info_holder = ctk.CTkFrame(cert_card, fg_color='transparent')
        self._info_holder.pack(fill='x', padx=16, pady=(4, 12))
        self._render_cert_info()

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

        self._status = ctk.CTkLabel(brow, text='', font=F(size=12), text_color=TEXT_MUTED)
        self._status.pack(side='left', padx=8)

        # ── Resultados ──────────────────────────────────────────────────────
        self._res = ctk.CTkScrollableFrame(
            self, fg_color=CARD, corner_radius=12,
            border_width=1, border_color=BORDER,
            label_text='Notificaciones en el buzón',
            label_font=F(size=12, weight='bold'),
            label_text_color=TEXT_MUTED,
        )
        self._res.pack(fill='both', expand=True, padx=20, pady=(0, 16))
        ctk.CTkLabel(self._res,
                     text='Haz clic en "Comprobar DEHU" para ver las notificaciones.',
                     text_color=TEXT_MUTED, font=F(size=13)).pack(pady=40)

    def _render_cert_info(self):
        """Muestra la tarjeta 🪪 del certificado activo (parseo del PFX en background)."""
        for w in self._info_holder.winfo_children():
            w.destroy()

        cert_path, password = self._active_cert()
        if not cert_path:
            ctk.CTkLabel(self._info_holder,
                         text='⚠  Añade un certificado para poder consultar DEHU.',
                         text_color=WARNING, font=F(size=13)).pack(anchor='w')
            return

        # Placeholder instantáneo mientras se parsea el certificado
        ctk.CTkLabel(self._info_holder, text='🪪  Leyendo certificado…',
                     text_color=TEXT_MUTED, font=F(size=13)).pack(anchor='w')

        def work():
            info = _load_pfx_info(cert_path, password)
            self.after(0, lambda: self._paint_cert_info(info))

        threading.Thread(target=work, daemon=True).start()

    def _paint_cert_info(self, info: dict):
        # El holder pudo destruirse si se cambió de página; comprobamos
        try:
            if not self._info_holder.winfo_exists():
                return
        except Exception:
            return
        for w in self._info_holder.winfo_children():
            w.destroy()

        if not info.get('ok'):
            ctk.CTkLabel(self._info_holder,
                         text=f'⚠  No se pudo leer el certificado: {info.get("error","")}',
                         text_color=DANGER, font=F(size=12)).pack(anchor='w')
            return

        ctk.CTkLabel(self._info_holder, text='🪪', font=F(size=36)
                     ).pack(side='left', padx=(0, 14))
        det = ctk.CTkFrame(self._info_holder, fg_color='transparent')
        det.pack(side='left', fill='x', expand=True)
        ctk.CTkLabel(det, text=info['name'],
                     font=F(size=15, weight='bold'), text_color=TEXT,
                     anchor='w').pack(anchor='w')
        ctk.CTkLabel(det, text=f"Emisor: {info['issuer']}",
                     font=F(size=12), text_color=TEXT_MUTED,
                     anchor='w').pack(anchor='w', pady=(2, 0))
        exp_color = DANGER if info['status'] == 'expired' else (WARNING if info['status'] == 'expiring_soon' else TEXT_MUTED)
        days_txt  = f"Caduca: {info['expiry']}  ({info['days']} días restantes)"
        if info['status'] == 'expired':
            days_txt = f"⚠  CADUCADO el {info['expiry']}"
        elif info['status'] == 'expiring_soon':
            days_txt = f"⏰  Caduca el {info['expiry']}  ({info['days']} días restantes)"
        ctk.CTkLabel(det, text=days_txt,
                     font=F(size=12), text_color=exp_color,
                     anchor='w').pack(anchor='w', pady=(2, 0))
        badge(self._info_holder, info.get('status','').replace('_',' ').title(),
              info.get('status','')).pack(side='right', padx=12)

    def _on_cert_changed(self, name: str):
        from cert_manager import dehu_certs
        for i, c in enumerate(self._certs_data['certs']):
            if c['name'] == name:
                dehu_certs.set_active(i)
                self._certs_data['active'] = i
                break
        self._render_cert_info()
        if self.app:
            self.app.set_status(f'Certificado DEHU activo: {name}')

    def _add_cert(self):
        path = filedialog.askopenfilename(
            title='Selecciona tu certificado digital',
            filetypes=[('Certificado digital', '*.pfx *.p12'), ('Todos', '*.*')],
        )
        if not path:
            return
        password = self._ask_password(Path(path).name)
        if password is None:  # cancelado
            return
        name = self._ask_name(Path(path).stem)
        if not name:
            return
        from cert_manager import dehu_certs
        self._certs_data = dehu_certs.add(name, path, password)
        if self.app:
            self.app.refresh_page('dehu')

    def _remove_cert(self):
        idx = self._certs_data.get('active', 0)
        certs = self._certs_data['certs']
        if not (0 <= idx < len(certs)):
            return
        name = certs[idx]['name']
        if not messagebox.askyesno('Quitar certificado',
                                   f'¿Quitar "{name}" de la lista de DEHU?\n\n'
                                   '(No se borra el archivo, solo se quita de la app.)'):
            return
        from cert_manager import dehu_certs
        self._certs_data = dehu_certs.remove(idx)
        if self.app:
            self.app.refresh_page('dehu')

    def _ask_password(self, filename: str) -> 'str | None':
        dlg = ctk.CTkInputDialog(
            title='Contraseña del certificado',
            text=f'Contraseña de {filename}\n(déjala vacía si no tiene):',
        )
        # CTkInputDialog devuelve None si se cancela, '' si se acepta vacío
        return dlg.get_input()

    def _ask_name(self, default: str) -> 'str | None':
        dlg = ctk.CTkInputDialog(
            title='Nombre del certificado',
            text=f'Nombre para mostrar (ej. "Mi DNI", "Empresa"):',
        )
        val = dlg.get_input()
        if val is None:
            return None
        return val.strip() or default

    def _check(self):
        self._check_btn.configure(state='disabled', text='⏳  Comprobando...')
        self._prog.start()
        if self.app:
            self.app.set_status('Conectando con DEHU...', ACCENT)
        threading.Thread(target=self._do_check, daemon=True).start()

    def _do_check(self):
        from cert_manager.dehu_session import DEHUSession
        from cert_manager import dehu_checker
        cert_path, password = self._active_cert()
        log_folder = Path(self.cfg['general']['log_folder'])
        try:
            with DEHUSession(cert_path, password,
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
                         text_color=SUCCESS, font=F(size=13, weight='bold'),
                         ).pack(padx=14, pady=10)

        if not self._result['all']:
            diag = self._result.get('diag', {})
            debug_html = self._result.get('debug_html', '')

            f_empty = ctk.CTkFrame(self._res, fg_color='transparent')
            f_empty.pack(fill='x', padx=10, pady=16)

            ctk.CTkLabel(f_empty,
                         text='No se encontraron notificaciones en el buzón DEHU.',
                         text_color=TEXT_MUTED, font=F(size=13)).pack()

            if diag:
                # Mostrar información de diagnóstico
                diag_card = ctk.CTkFrame(f_empty, fg_color='#f5f5f5', corner_radius=8,
                                         border_width=1, border_color='#ddd')
                diag_card.pack(fill='x', pady=(10, 0))
                ctk.CTkLabel(diag_card, text='🔍 Diagnóstico de la respuesta de DEHU',
                             font=F(size=12, weight='bold'),
                             text_color='#555').pack(anchor='w', padx=12, pady=(8, 2))

                title = diag.get('page_title', '')
                num_t = diag.get('num_tables', 0)
                scripts = diag.get('has_many_scripts', False)
                preview = diag.get('body_preview', '')[:200]
                html_kb = diag.get('html_size', 0) // 1024

                lines = [
                    f'Título de página: {title or "(sin título)"}',
                    f'Tablas encontradas: {num_t}  ·  HTML: {html_kb} KB  ·  JavaScript pesado: {"Sí" if scripts else "No"}',
                ]
                if scripts and num_t == 0:
                    lines.append('⚠ DEHU usa JavaScript para cargar los datos. '
                                 'requests no ejecuta JS — las notificaciones no son visibles por API.')
                if preview:
                    lines.append(f'Texto de la página: {preview}')

                for line in lines:
                    ctk.CTkLabel(diag_card, text=line, font=F(size=11),
                                 text_color='#444', wraplength=560,
                                 anchor='w').pack(anchor='w', padx=12, pady=1)

                if debug_html and Path(debug_html).exists():
                    def _open_html(p=debug_html):
                        import webbrowser
                        webbrowser.open(Path(p).as_uri())
                    action_btn(diag_card, '🌐 Abrir HTML completo en navegador',
                               PRIMARY, _open_html, width=260).pack(pady=(6, 8))
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
                             font=F(size=11)).pack(side='left', padx=8, pady=6)
            estado = '🆕 Nueva' if es_nueva else ('✓ Leída' if n.get('leida') else '● Pendiente')
            color  = WARNING if es_nueva else (TEXT_MUTED if n.get('leida') else DANGER)
            ctk.CTkLabel(r, text=estado, width=110, anchor='w',
                         font=F(size=11, weight='bold' if es_nueva else 'normal'),
                         text_color=color).pack(side='left', padx=8)

    def _show_error(self, msg: str):
        self._check_btn.configure(state='normal', text='🔍  Comprobar DEHU')
        self._prog.stop()
        self._prog.set(0)
        self._status.configure(text='Error de conexión', text_color=DANGER)
        if self.app:
            self.app.set_status(f'Error DEHU: {msg[:60]}', DANGER)
        for w in self._res.winfo_children():
            w.destroy()
        err_card = ctk.CTkFrame(self._res, fg_color='#fdecea', corner_radius=10,
                                border_width=1, border_color='#f5c6cb')
        err_card.pack(fill='x', pady=20, padx=10)
        ctk.CTkLabel(err_card, text='❌  Error al conectar con DEHU',
                     font=F(size=13, weight='bold'), text_color=DANGER).pack(padx=16, pady=(12, 4))
        ctk.CTkLabel(err_card, text=msg, text_color='#7b1f1f',
                     font=F(size=11), wraplength=540).pack(padx=16, pady=(0, 8))
        # Botón para abrir el HTML de diagnóstico
        log_folder = Path(self.cfg['general']['log_folder'])
        debug_html = log_folder / 'dehu_last_response.html'
        if debug_html.exists():
            def _open_debug():
                import webbrowser
                webbrowser.open(debug_html.as_uri())
            action_btn(err_card, '🔍 Ver respuesta de DEHU', '#7b1f1f', _open_debug,
                       width=200).pack(pady=(0, 12))
        else:
            ctk.CTkLabel(err_card,
                         text='Comprueba que el archivo .pfx y su contraseña son correctos.',
                         text_color='#7b1f1f', font=F(size=11)).pack(padx=16, pady=(0, 12))

    def _download(self):
        if not self._result:
            return
        from cert_manager.dehu_session import DEHUSession
        from cert_manager import dehu_downloader
        cert_path, password = self._active_cert()
        dest      = Path(self.cfg['general']['download_folder'])
        self._dl_btn.configure(state='disabled', text='⏳  Descargando...')
        self._prog.start()

        def do():
            try:
                with DEHUSession(cert_path, password,
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
        self._checks  = []
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
        self._info = ctk.CTkLabel(brow, text='', font=F(size=12), text_color=TEXT_MUTED)
        self._info.pack(side='left', padx=8)

        self._scroll = ctk.CTkScrollableFrame(
            self, fg_color=CARD, corner_radius=12, border_width=1, border_color=BORDER,
            label_text='Certificados caducados encontrados',
            label_font=F(size=12, weight='bold'),
            label_text_color=TEXT_MUTED,
        )
        self._scroll.pack(fill='both', expand=True, padx=20, pady=(0, 16))
        ctk.CTkLabel(self._scroll, text='Haz clic en "Buscar caducados" para empezar.',
                     text_color=TEXT_MUTED, font=F(size=13)).pack(pady=40)

    def _scan(self):
        # Escanea en background para no bloquear la UI
        self._info.configure(text='Buscando...', text_color=TEXT_MUTED)
        self._del_btn.configure(state='disabled')
        for w in self._scroll.winfo_children():
            w.destroy()
        ctk.CTkLabel(self._scroll, text='⏳  Escaneando almacén de certificados...',
                     text_color=TEXT_MUTED, font=F(size=13)).pack(pady=40)

        def do_scan():
            certs = cert_scanner.scan(['MY'])
            if certs:
                certs = cert_validator.validate(certs)
            expired = cert_validator.filter_expired(certs)
            self.after(0, lambda: self._show_expired(expired))

        threading.Thread(target=do_scan, daemon=True).start()

    def _show_expired(self, expired: list):
        self._expired = expired
        self._checks  = []
        for w in self._scroll.winfo_children():
            w.destroy()

        if not self._expired:
            ok = ctk.CTkFrame(self._scroll, fg_color=SUCCESS_LT, corner_radius=10,
                               border_width=1, border_color='#a5d6a7')
            ok.pack(fill='x', pady=20, padx=10)
            ctk.CTkLabel(ok, text='✅  ¡El almacén está limpio! No hay certificados caducados.',
                         text_color=SUCCESS, font=F(size=13, weight='bold')).pack(pady=16)
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
            self._checks.append((var, c))

            ctk.CTkCheckBox(r, text='', variable=var, width=24,
                             checkmark_color=PRIMARY, fg_color=PRIMARY,
                             hover_color=PRIMARY_DK).pack(side='left', padx=12, pady=14)
            info = ctk.CTkFrame(r, fg_color='transparent')
            info.pack(side='left', fill='x', expand=True, pady=10)
            ctk.CTkLabel(info, text=c.get('subject',''),
                         font=F(size=13, weight='bold'), text_color=TEXT,
                         anchor='w').pack(anchor='w')
            ctk.CTkLabel(info,
                         text=f"Emisor: {c.get('issuer','')}   ·   Caducó: {c.get('not_after','')[:10]}   ·   Almacén: {c.get('store','')}",
                         font=F(size=11), text_color=TEXT_MUTED, anchor='w',
                         ).pack(anchor='w', pady=(3, 0))
            ctk.CTkLabel(r, text='✗ CADUCADO', text_color=DANGER,
                         font=F(size=11, weight='bold')).pack(side='right', padx=16)

    def _delete(self):
        sel = [(v, c) for v, c in self._checks if v.get()]
        if not sel:
            messagebox.showwarning('Nada seleccionado', 'Marca al menos un certificado.')
            return

        # Aviso temprano si no hay permisos de administrador
        if not cert_scanner.is_admin():
            if not messagebox.askyesno(
                'Sin permisos de administrador',
                'La app no se está ejecutando como administrador, así que es '
                'posible que Windows no permita borrar los certificados.\n\n'
                'Recomendado: cierra la app y vuelve a abrirla aceptando el aviso '
                'de Windows (UAC).\n\n¿Intentarlo de todos modos?',
                icon='warning',
            ):
                return

        if not messagebox.askyesno(
            'Confirmar eliminación',
            f'¿Eliminar {len(sel)} certificado(s) caducado(s)?\n\nEsta acción no se puede deshacer.',
            icon='warning',
        ):
            return

        ok = 0
        errors = []
        for v, c in sel:
            store = c.get('store', 'MY') or 'MY'
            success, err = cert_scanner.delete_by_thumbprint_ex(store, c.get('thumbprint', ''))
            if success:
                ok += 1
            else:
                errors.append(f"• {c.get('subject','(sin nombre)')[:40]}: {err}")

        msg = f'✓  Eliminados: {ok} de {len(sel)}'
        if errors:
            msg += '\n\n✗  No se pudieron eliminar:\n' + '\n'.join(errors[:6])
            if len(errors) > 6:
                msg += f'\n… y {len(errors) - 6} más.'
            messagebox.showwarning('Resultado', msg)
        else:
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
        from cert_manager import servicios, edge_policy

        dest_base = Path(self.cfg['general']['download_folder']) / 'servicios'
        history   = servicios.load_history()
        # Estado de la selección automática (se calcula una sola vez)
        self._autoselect_on = edge_policy.is_enabled()

        # Aviso sobre el modo semi-automático
        info = ctk.CTkFrame(self, fg_color=PRIMARY_LT, corner_radius=10,
                            border_width=1, border_color=BORDER)
        info.pack(fill='x', padx=20, pady=(0, 10))
        ctk.CTkLabel(info,
                     text='🤖  Asistente de descarga: la app abre Edge en el portal correcto y '
                          'detecta el PDF automáticamente cuando se descarga. Por seguridad, los '
                          'portales de la Seguridad Social y Hacienda exigen que selecciones tu '
                          'certificado en el cuadro de Windows (no se puede automatizar ese paso). '
                          'Cuando aparezca, elige tu certificado y pulsa "Obtener informe".',
                     font=F(size=11), text_color=PRIMARY_DK,
                     wraplength=820, anchor='w').pack(padx=14, pady=10)

        # Tarjeta: selección automática de certificado (saltar diálogo de Windows)
        self._autoselect_card()

        scroll = ctk.CTkScrollableFrame(self, fg_color='transparent')
        scroll.pack(fill='both', expand=True, padx=20, pady=(0, 16))

        for svc in servicios.SERVICES:
            self._service_card(scroll, svc, dest_base, history.get(svc['id'], []))

    def _autoselect_card(self):
        from cert_manager import edge_policy
        c = card(self)
        c.pack(fill='x', padx=20, pady=(0, 10))
        section_label(c, '⚡  Selección automática de certificado (sin cuadro de Windows)')
        divider(c)

        row = ctk.CTkFrame(c, fg_color='transparent')
        row.pack(fill='x', padx=16, pady=12)

        if not edge_policy.is_supported():
            ctk.CTkLabel(row, text='Solo disponible en Windows.',
                         font=F(size=12), text_color=TEXT_MUTED).pack(anchor='w')
            return

        enabled = edge_policy.is_enabled()
        estado  = ('✓  ACTIVADA — Edge/Chrome no pedirá el certificado en los portales del Estado'
                   if enabled else
                   '○  Desactivada — el navegador mostrará el cuadro de selección de Windows')
        ctk.CTkLabel(row, text=estado,
                     font=F(size=12),
                     text_color=SUCCESS if enabled else TEXT_MUTED).pack(side='left')

        if enabled:
            action_btn(row, '✖  Desactivar', DANGER, self._disable_autoselect, width=130).pack(side='right')
        else:
            action_btn(row, '⚡  Activar', SUCCESS, self._enable_autoselect, width=120).pack(side='right')

        ctk.CTkLabel(c,
                     text='Al activarla, se filtra por el titular de tu certificado activo de DEHU '
                          'para no afectar a otros certificados. Reversible en un clic. '
                          'Cierra y reabre el navegador para que surta efecto.',
                     font=F(size=10), text_color=TEXT_MUTED,
                     wraplength=820, anchor='w').pack(anchor='w', padx=16, pady=(0, 10))

    def _enable_autoselect(self):
        from cert_manager import edge_policy, dehu_certs
        # Intenta acotar la política al titular del certificado activo de DEHU
        subject_cn = ''
        active = dehu_certs.get_active()
        if active and active.get('path'):
            info = _load_pfx_info(active['path'].strip().strip('"\''), active.get('password', ''))
            if info.get('ok'):
                subject_cn = info.get('name', '')
        result = edge_policy.enable(subject_cn=subject_cn)
        if result.get('ok'):
            navs = ', '.join(result.get('browsers', [])) or 'navegador'
            scope = f'para el titular "{subject_cn}"' if subject_cn else '(sin filtro de titular)'
            messagebox.showinfo(
                'Selección automática activada',
                f'✓  Configurado en: {navs} {scope}.\n\n'
                'Cierra completamente Edge/Chrome y vuelve a abrirlo para que surta efecto.\n'
                'A partir de ahora, en los portales del Estado no aparecerá el cuadro de '
                'selección de certificado.',
            )
            if self.app:
                self.app.set_status('Selección automática de certificado activada')
        else:
            messagebox.showerror('Error', result.get('error', 'No se pudo activar.'))
        if self.app:
            self.app.refresh_page('servicios')

    def _disable_autoselect(self):
        from cert_manager import edge_policy
        result = edge_policy.disable()
        if result.get('ok'):
            messagebox.showinfo(
                'Selección automática desactivada',
                f'✓  Eliminadas {result.get("removed", 0)} entradas.\n\n'
                'El navegador volverá a pedir el certificado normalmente.',
            )
            if self.app:
                self.app.set_status('Selección automática de certificado desactivada')
        else:
            messagebox.showerror('Error', result.get('error', 'No se pudo desactivar.'))
        if self.app:
            self.app.refresh_page('servicios')

    def _service_card(self, parent, svc: dict, dest_base: Path, history: list):
        c = card(parent)
        c.pack(fill='x', pady=8)

        # ── Cabecera ───────────────────────────────────────────────────────────
        hdr = ctk.CTkFrame(c, fg_color='transparent')
        hdr.pack(fill='x', padx=16, pady=(14, 0))
        ctk.CTkLabel(hdr, text=svc['icon'], font=F(size=30)).pack(side='left', padx=(0, 12))

        title_box = ctk.CTkFrame(hdr, fg_color='transparent')
        title_box.pack(side='left', fill='x', expand=True)
        ctk.CTkLabel(title_box, text=svc['name'],
                     font=F(size=14, weight='bold'), text_color=TEXT,
                     anchor='w').pack(anchor='w')
        ctk.CTkLabel(title_box, text=svc['organismo'],
                     font=F(size=11), text_color=TEXT_MUTED,
                     anchor='w').pack(anchor='w')

        if history:
            badge_f = ctk.CTkFrame(hdr, fg_color=SUCCESS_LT, corner_radius=8)
            badge_f.pack(side='right', padx=4)
            ctk.CTkLabel(badge_f, text=f'✓  Última: {history[0]["date"]}',
                         font=F(size=10), text_color=SUCCESS,
                         padx=8, pady=4).pack()

        divider(c)

        ctk.CTkLabel(c, text=svc['description'],
                     font=F(size=12), text_color=TEXT_MUTED,
                     anchor='w', wraplength=680).pack(anchor='w', padx=16, pady=(8, 4))

        # ── Indicador de selección automática ───────────────────────────────────
        if getattr(self, '_autoselect_on', False):
            pill = ctk.CTkFrame(c, fg_color=SUCCESS_LT, corner_radius=8)
            pill.pack(anchor='w', padx=16, pady=(0, 4))
            ctk.CTkLabel(pill,
                         text='⚡  Descarga sin cuadro de certificado — totalmente automática',
                         font=F(size=10, weight='bold'), text_color=SUCCESS,
                         padx=10, pady=4).pack()
        else:
            pill = ctk.CTkFrame(c, fg_color='#fff8e1', corner_radius=8)
            pill.pack(anchor='w', padx=16, pady=(0, 4))
            ctk.CTkLabel(pill,
                         text='🔐  Windows pedirá elegir el certificado · actívala arriba en "⚡"',
                         font=F(size=10), text_color='#7b3f00',
                         padx=10, pady=4).pack()

        # ── Barra de estado ────────────────────────────────────────────────────
        status_lbl = ctk.CTkLabel(c, text='', font=F(size=11),
                                   text_color=TEXT_MUTED, anchor='w')
        status_lbl.pack(anchor='w', padx=16, pady=(0, 4))

        # ── Botones ────────────────────────────────────────────────────────────
        brow = ctk.CTkFrame(c, fg_color='transparent')
        brow.pack(fill='x', padx=16, pady=(0, 14))

        auto_btn_ref = [None]

        def _set_status(msg, color=TEXT_MUTED):
            self.after(0, lambda: status_lbl.configure(text=msg, text_color=color))
            if self.app:
                self.after(0, lambda: self.app.set_status(msg))

        def do_auto(s=svc, sl=status_lbl):
            if auto_btn_ref[0]:
                auto_btn_ref[0].configure(state='disabled', text='⏳  Descargando...')
            _set_status('⏳  Iniciando navegador automático...', TEXT_MUTED)

            def run():
                from cert_manager import servicios_auto, servicios as sv
                tmp_dir = dest_base / '_tmp'
                result  = servicios_auto.download_service(
                    s['id'], tmp_dir, progress_cb=lambda m: _set_status(m, TEXT_MUTED)
                )
                if result['ok']:
                    # Organise using servicios.organize_pdf (rename + history)
                    svc_def = next((x for x in sv.SERVICES if x['id'] == s['id']), s)
                    final   = sv.organize_pdf(svc_def, result['path'], dest_base)
                    # Remove tmp file if copy succeeded
                    try:
                        result['path'].unlink(missing_ok=True)
                        tmp_dir.rmdir()
                    except Exception:
                        pass
                    if final['ok']:
                        p = final['path']
                        _set_status(f'✓  Guardado: {p.name}', SUCCESS)
                        self.after(0, lambda: messagebox.showinfo(
                            'Descarga completada',
                            f'✓  {s["name"]}\n\nGuardado en:\n{p}'
                        ))
                        self.after(500, lambda: self.app.refresh_page('servicios') if self.app else None)
                    else:
                        _set_status(f'✗  {final["error"][:80]}', DANGER)
                elif result.get('reason') == 'no_selenium':
                    # Falta selenium: explica cómo instalar y ofrece el navegador
                    _set_status('⚠  Falta "selenium" — usa "🌐 Abrir portal"', WARNING)
                    def offer():
                        if messagebox.askyesno(
                            'Descarga automática no disponible',
                            result['error'] + '\n\n¿Abrir el portal en el navegador ahora?',
                        ):
                            sv.open_in_browser(s)
                    self.after(0, offer)
                else:
                    _set_status(f'⚠  {result["error"][:100]}', WARNING)

                self.after(0, lambda: (
                    auto_btn_ref[0].configure(state='normal', text='🤖  Descargar automático')
                    if auto_btn_ref[0] else None
                ))

            threading.Thread(target=run, daemon=True).start()

        def do_browser(s=svc):
            from cert_manager import servicios as sv
            sv.open_in_browser(s)
            _set_status('🌐  Portal abierto en el navegador. Descarga el PDF y pulsa "Guardar PDF".', SUCCESS)

        def do_save(s=svc):
            path = filedialog.askopenfilename(
                title=f'Selecciona el PDF de {s["name"]}',
                filetypes=[('PDF', '*.pdf'), ('Todos', '*.*')],
            )
            if not path:
                return
            from cert_manager import servicios as sv
            svc_def = next((x for x in sv.SERVICES if x['id'] == s['id']), s)
            result  = sv.organize_pdf(svc_def, Path(path), dest_base)
            if result['ok']:
                p = result['path']
                _set_status(f'✓  Guardado: {p.name}', SUCCESS)
                messagebox.showinfo('PDF organizado',
                                    f'✓  {s["name"]}\n\nGuardado como:\n{p}')
                if self.app:
                    self.app.refresh_page('servicios')
            else:
                _set_status(f'✗  {result["error"][:80]}', DANGER)

        auto_b = action_btn(brow, '🤖  Descargar automático', PRIMARY, do_auto, width=200)
        auto_b.pack(side='left', padx=(0, 6))
        auto_btn_ref[0] = auto_b

        action_btn(brow, '🌐  Abrir portal', '#546e7a', do_browser, width=145).pack(side='left', padx=(0, 6))
        action_btn(brow, '📂  Guardar PDF',  SUCCESS,   do_save,    width=140).pack(side='left')

        # ── Historial ──────────────────────────────────────────────────────────
        if history:
            hist_f = ctk.CTkFrame(c, fg_color='transparent')
            hist_f.pack(fill='x', padx=16, pady=(0, 10))
            ctk.CTkLabel(hist_f, text='Descargas registradas:',
                         font=F(size=10, weight='bold'),
                         text_color=TEXT_MUTED).pack(anchor='w')
            for entry in history[:3]:
                ctk.CTkLabel(hist_f,
                             text=f'  {entry["date"]}  →  {Path(entry["path"]).name}',
                             font=F(size=10), text_color=TEXT_MUTED,
                             anchor='w').pack(anchor='w')


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
        ctk.CTkLabel(frow, text=str(folder), font=F(size=12),
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
        self._log = ctk.CTkTextbox(log_card, font=F(size=11, family='Courier'),
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
                             font=F(size=12), text_color=TEXT).pack(side='left')
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

        # ── Rendimiento ─────────────────────────────────────────────────────
        perf = card(scroll)
        perf.pack(fill='x', pady=8)
        section_label(perf, '⚡  Rendimiento')
        divider(perf)
        prow = ctk.CTkFrame(perf, fg_color='transparent')
        prow.pack(fill='x', padx=16, pady=10)
        txt = ctk.CTkFrame(prow, fg_color='transparent')
        txt.pack(side='left', fill='x', expand=True)
        ctk.CTkLabel(txt, text='Mostrar también certificados del sistema (CA y RAÍZ)',
                     font=F(size=12), text_color=TEXT, anchor='w').pack(anchor='w')
        ctk.CTkLabel(txt, text='Desactivado = más rápido (solo tus certificados personales). '
                              'Activado = escanea cientos de CAs del sistema, más lento.',
                     font=F(size=10), text_color=TEXT_MUTED, anchor='w',
                     wraplength=560).pack(anchor='w')
        cur = (self.cfg['certificates'].get('gui_stores') or 'MY')
        self._sys_stores = ctk.CTkSwitch(prow, text='', progress_color=PRIMARY,
                                         onvalue='on', offvalue='off', width=48)
        if cur.upper() != 'MY':
            self._sys_stores.select()
        else:
            self._sys_stores.deselect()
        self._sys_stores.pack(side='right', padx=8)
        ctk.CTkFrame(perf, height=6, fg_color='transparent').pack()

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
        # Interruptor de rendimiento → almacenes que escanea la interfaz
        if hasattr(self, '_sys_stores'):
            cfg['certificates']['gui_stores'] = (
                'MY,CA,ROOT' if self._sys_stores.get() == 'on' else 'MY'
            )
        with open(_CONFIG_FILE, 'w', encoding='utf-8') as f:
            cfg.write(f)
        if self.app:
            self.app.reload_config()
        messagebox.showinfo('Guardado', '✓  Configuración guardada correctamente.')
        if self.app:
            self.app.set_status('Configuración guardada')


# ── Punto de entrada ─────────────────────────────────────────────────────────

# Registro de páginas (tras definir las clases) para el cacheo de App._show
App._PAGES = {
    'dashboard':    DashboardPage,
    'certificates': CertificatesPage,
    'dehu':         DehuPage,
    'servicios':    ServiciosPage,
    'clean':        CleanPage,
    'report':       ReportPage,
    'settings':     SettingsPage,
}


def main():
    app = App()
    app.mainloop()


if __name__ == '__main__':
    main()
