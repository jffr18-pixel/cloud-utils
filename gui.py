#!/usr/bin/env python3
"""
Gestor de Certificados Digitales — Interfaz gráfica
"""
import sys
import threading
import tkinter.messagebox as messagebox
import tkinter.filedialog as filedialog
from pathlib import Path

import customtkinter as ctk

from cert_manager import cert_scanner, cert_validator, reporter
from cert_manager import config as cfg_module

# ── Paleta de colores — Burocracia Zero ─────────────────────────────────────
PRIMARY      = '#9373B2'   # Violeta principal
PRIMARY_DK   = '#6e529a'   # Violeta oscuro (hover)
ACCENT       = '#FFEA63'   # Amarillo
ACCENT_TEXT  = '#000000'   # Texto sobre amarillo
DANGER       = '#dc3545'   # Rojo (errores)
WARNING      = '#e67e22'   # Naranja (advertencias)
SUCCESS      = '#28a745'   # Verde (éxito)
BG           = '#f5f3f9'   # Fondo muy claro violáceo
WHITE        = '#ffffff'
BLACK        = '#000000'
TEXT         = '#000000'
TEXT_MUTED   = '#6c7a89'
SIDEBAR_W    = 210

ctk.set_appearance_mode('light')
ctk.set_default_color_theme('blue')


# ── Ventana principal ────────────────────────────────────────────────────────

class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title('Gestor de Certificados Digitales')
        self.geometry('1150x720')
        self.minsize(950, 620)
        self.configure(fg_color=BG)
        self.cfg = cfg_module.load()
        self._current_page = None
        self._build_layout()
        self._show_page('dashboard')

    def _build_layout(self):
        # ── Barra lateral ──────────────────────────────────────────────────
        self.sidebar = ctk.CTkFrame(self, width=SIDEBAR_W, fg_color=PRIMARY, corner_radius=0)
        self.sidebar.pack(side='left', fill='y')
        self.sidebar.pack_propagate(False)

        # Logo
        logo = ctk.CTkFrame(self.sidebar, fg_color=PRIMARY_DK, corner_radius=0, height=80)
        logo.pack(fill='x')
        logo.pack_propagate(False)
        ctk.CTkLabel(
            logo, text='🔐  CertManager',
            font=ctk.CTkFont(size=16, weight='bold'), text_color=ACCENT,
        ).pack(expand=True)

        # Navegación
        nav_items = [
            ('🏠   Inicio',          'dashboard'),
            ('📋   Certificados',    'certificates'),
            ('📬   DEHU',            'dehu'),
            ('🗑    Limpiar',         'clean'),
            ('📊   Informe',         'report'),
            ('⚙️   Configuración',   'settings'),
        ]
        self._nav_btns = {}
        nav_box = ctk.CTkFrame(self.sidebar, fg_color='transparent')
        nav_box.pack(fill='x', pady=8)
        for label, page in nav_items:
            btn = ctk.CTkButton(
                nav_box, text=label, anchor='w',
                font=ctk.CTkFont(size=13), height=44,
                fg_color='transparent', hover_color=PRIMARY_DK,
                text_color=WHITE, corner_radius=0,
                command=lambda p=page: self._show_page(p),
            )
            btn.pack(fill='x')
            self._nav_btns[page] = btn

        # Versión al pie
        ctk.CTkLabel(
            self.sidebar, text='v1.0 — Windows 11',
            font=ctk.CTkFont(size=10), text_color='#aac4e0',
        ).pack(side='bottom', pady=10)

        # ── Área de contenido ──────────────────────────────────────────────
        self.content = ctk.CTkFrame(self, fg_color=BG, corner_radius=0)
        self.content.pack(side='left', fill='both', expand=True)

    def _show_page(self, name: str):
        if self._current_page:
            self._current_page.pack_forget()
        for n, b in self._nav_btns.items():
            b.configure(fg_color=PRIMARY_DK if n == name else 'transparent')
        pages = {
            'dashboard':    DashboardPage,
            'certificates': CertificatesPage,
            'dehu':         DehuPage,
            'clean':        CleanPage,
            'report':       ReportPage,
            'settings':     SettingsPage,
        }
        if name in pages:
            page = pages[name](self.content, self.cfg, app=self)
            page.pack(fill='both', expand=True)
            self._current_page = page

    def reload_config(self):
        self.cfg = cfg_module.load()


# ── Componentes reutilizables ────────────────────────────────────────────────

def page_header(parent, title: str, subtitle: str = ''):
    frame = ctk.CTkFrame(parent, fg_color=WHITE, corner_radius=10)
    frame.pack(fill='x', padx=20, pady=(20, 10))
    ctk.CTkLabel(
        frame, text=title,
        font=ctk.CTkFont(size=20, weight='bold'), text_color=PRIMARY,
    ).pack(anchor='w', padx=20, pady=(14, 2 if subtitle else 14))
    if subtitle:
        ctk.CTkLabel(
            frame, text=subtitle,
            font=ctk.CTkFont(size=12), text_color=TEXT_MUTED,
        ).pack(anchor='w', padx=20, pady=(0, 14))
    return frame


def stat_card(parent, title: str, value: str, color: str):
    card = ctk.CTkFrame(parent, fg_color=color, corner_radius=10)
    card.pack(side='left', expand=True, fill='both', padx=6, pady=6)
    ctk.CTkLabel(card, text=value,
                 font=ctk.CTkFont(size=34, weight='bold'), text_color=WHITE).pack(pady=(18, 4))
    ctk.CTkLabel(card, text=title,
                 font=ctk.CTkFont(size=12), text_color=WHITE).pack(pady=(0, 18))


def status_badge(parent, label: str, status: str) -> ctk.CTkLabel:
    colors = {
        'valid':        SUCCESS,
        'expiring_soon': WARNING,
        'expired':      DANGER,
        'unknown':      TEXT_MUTED,
    }
    return ctk.CTkLabel(
        parent, text=label,
        fg_color=colors.get(status, TEXT_MUTED), text_color=WHITE,
        corner_radius=6, font=ctk.CTkFont(size=11), padx=6,
    )


def table_header(parent, columns: list):
    hdr = ctk.CTkFrame(parent, fg_color=PRIMARY, corner_radius=6)
    hdr.pack(fill='x', pady=(0, 4))
    for col, w in columns:
        ctk.CTkLabel(
            hdr, text=col, width=w, anchor='w',
            font=ctk.CTkFont(size=12, weight='bold'), text_color=WHITE,
        ).pack(side='left', padx=8, pady=8)
    return hdr


# ── Páginas ──────────────────────────────────────────────────────────────────

class DashboardPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg = cfg
        page_header(self, '🏠 Inicio', 'Resumen del estado de tus certificados y DEHU')
        self._build()

    def _build(self):
        stores     = [s.strip() for s in self.cfg['certificates']['stores'].split(',')]
        alert_days = int(self.cfg['general']['alert_days'])
        certs      = cert_scanner.scan(stores)
        if certs:
            certs = cert_validator.validate(certs, alert_days)

        total    = len(certs)
        valid    = sum(1 for c in certs if c.get('status') == 'valid')
        expiring = sum(1 for c in certs if c.get('status') == 'expiring_soon')
        expired  = sum(1 for c in certs if c.get('status') == 'expired')

        # Tarjetas resumen
        cards = ctk.CTkFrame(self, fg_color='transparent')
        cards.pack(fill='x', padx=20, pady=4)
        stat_card(cards, 'Total',          str(total),    PRIMARY)
        stat_card(cards, 'Válidos',         str(valid),    SUCCESS)
        stat_card(cards, 'Caducan pronto',  str(expiring), WARNING)
        stat_card(cards, 'Caducados',       str(expired),  DANGER)

        # Alertas
        if expired > 0 or expiring > 0:
            alert = ctk.CTkFrame(self, fg_color='#fff3cd', corner_radius=8)
            alert.pack(fill='x', padx=20, pady=6)
            if expired > 0:
                ctk.CTkLabel(
                    alert,
                    text=f'⚠  {expired} certificado(s) CADUCADO(S) — ve a "Limpiar" para eliminarlos',
                    text_color='#856404', font=ctk.CTkFont(size=12),
                ).pack(anchor='w', padx=16, pady=(8, 2))
            if expiring > 0:
                ctk.CTkLabel(
                    alert,
                    text=f'⏰  {expiring} certificado(s) caducan en menos de {alert_days} días',
                    text_color='#856404', font=ctk.CTkFont(size=12),
                ).pack(anchor='w', padx=16, pady=(2, 8))

        # Lista de certificados
        scroll = ctk.CTkScrollableFrame(self, fg_color=WHITE, corner_radius=10,
                                         label_text='Tus certificados')
        scroll.pack(fill='both', expand=True, padx=20, pady=(0, 20))

        if not certs:
            ctk.CTkLabel(scroll, text='No se encontraron certificados (solo disponible en Windows).',
                         text_color=TEXT_MUTED).pack(pady=30)
            return

        table_header(scroll, [('Titular', 340), ('Emisor', 200), ('Caduca', 110), ('Estado', 140)])
        for i, c in enumerate(sorted(certs, key=lambda x: x.get('days_remaining', 9999))):
            bg  = '#f5f8ff' if i % 2 == 0 else WHITE
            row = ctk.CTkFrame(scroll, fg_color=bg, corner_radius=4)
            row.pack(fill='x', pady=1)
            ctk.CTkLabel(row, text=c.get('subject', '')[:46], width=340, anchor='w',
                         font=ctk.CTkFont(size=12)).pack(side='left', padx=8, pady=6)
            ctk.CTkLabel(row, text=c.get('issuer', '')[:28], width=200, anchor='w',
                         font=ctk.CTkFont(size=12), text_color=TEXT_MUTED).pack(side='left', padx=8)
            ctk.CTkLabel(row, text=c.get('not_after', '')[:10], width=110, anchor='w',
                         font=ctk.CTkFont(size=12)).pack(side='left', padx=8)
            status_badge(row, c.get('status_label', ''), c.get('status', '')).pack(side='left', padx=8)


class CertificatesPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg = cfg
        page_header(self, '📋 Certificados', 'Todos los certificados instalados en Windows')
        stores     = [s.strip() for s in cfg['certificates']['stores'].split(',')]
        alert_days = int(cfg['general']['alert_days'])
        self._certs = cert_scanner.scan(stores)
        if self._certs:
            self._certs = cert_validator.validate(self._certs, alert_days)
        self._build()

    def _build(self):
        # Barra de filtros
        bar = ctk.CTkFrame(self, fg_color=WHITE, corner_radius=8)
        bar.pack(fill='x', padx=20, pady=(0, 8))
        ctk.CTkLabel(bar, text='Filtrar:', font=ctk.CTkFont(size=12),
                     text_color=TEXT_MUTED).pack(side='left', padx=12, pady=10)
        self._active_filter = 'Todos'
        self._filter_btns = {}
        for label in ('Todos', 'Válidos', 'Caducan pronto', 'Caducados'):
            btn = ctk.CTkButton(
                bar, text=label, width=120, height=30,
                fg_color=PRIMARY if label == 'Todos' else 'transparent',
                text_color=WHITE if label == 'Todos' else TEXT,
                border_width=1, border_color=PRIMARY,
                command=lambda l=label: self._filter(l),
            )
            btn.pack(side='left', padx=4, pady=10)
            self._filter_btns[label] = btn

        # Tabla
        self._scroll = ctk.CTkScrollableFrame(self, fg_color=WHITE, corner_radius=10)
        self._scroll.pack(fill='both', expand=True, padx=20, pady=(0, 20))
        self._render(self._certs)

    def _filter(self, label: str):
        for lbl, btn in self._filter_btns.items():
            btn.configure(
                fg_color=PRIMARY if lbl == label else 'transparent',
                text_color=WHITE if lbl == label else TEXT,
            )
        mapping = {'Válidos': 'valid', 'Caducan pronto': 'expiring_soon', 'Caducados': 'expired'}
        status  = mapping.get(label)
        filtered = [c for c in self._certs if c.get('status') == status] if status else self._certs
        for w in self._scroll.winfo_children():
            w.destroy()
        self._render(filtered)

    def _render(self, certs: list):
        cols = [('Almacén', 75), ('Titular', 290), ('Emisor', 175),
                ('Caduca', 105), ('Días', 65), ('Estado', 140)]
        table_header(self._scroll, cols)
        if not certs:
            ctk.CTkLabel(self._scroll, text='Sin resultados para este filtro.',
                         text_color=TEXT_MUTED).pack(pady=20)
            return
        for i, c in enumerate(certs):
            bg  = '#f5f8ff' if i % 2 == 0 else WHITE
            row = ctk.CTkFrame(self._scroll, fg_color=bg, corner_radius=4)
            row.pack(fill='x', pady=1)
            days     = c.get('days_remaining', '')
            days_str = str(days) if isinstance(days, int) and days >= 0 else '—'
            for val, w in [
                (c.get('store', ''), 75),
                (c.get('subject', '')[:40], 290),
                (c.get('issuer', '')[:24], 175),
                (c.get('not_after', '')[:10], 105),
                (days_str, 65),
            ]:
                ctk.CTkLabel(row, text=val, width=w, anchor='w',
                             font=ctk.CTkFont(size=11)).pack(side='left', padx=6, pady=5)
            status_badge(row, c.get('status_label', ''), c.get('status', '')).pack(side='left', padx=6)


class DehuPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg  = cfg
        self._result = None
        page_header(self, '📬 DEHU', 'Comprueba y descarga notificaciones de dehu.redsara.es')
        self._build()

    def _build(self):
        cert_path = self.cfg['dehu']['cert_pfx_path'].strip().strip('"\'')
        if not cert_path:
            warn = ctk.CTkFrame(self, fg_color='#f8d7da', corner_radius=8)
            warn.pack(fill='x', padx=20, pady=10)
            ctk.CTkLabel(
                warn,
                text='⚠  Sin certificado configurado. Ve a ⚙️ Configuración y añade la ruta de tu .pfx / .p12',
                text_color='#721c24', font=ctk.CTkFont(size=13),
            ).pack(padx=16, pady=14)
            return

        # Botones de acción
        bar = ctk.CTkFrame(self, fg_color=WHITE, corner_radius=8)
        bar.pack(fill='x', padx=20, pady=(0, 10))

        self._check_btn = ctk.CTkButton(
            bar, text='🔍  Comprobar DEHU', width=200, height=38,
            fg_color=PRIMARY, command=self._check,
        )
        self._check_btn.pack(side='left', padx=12, pady=12)

        self._dl_btn = ctk.CTkButton(
            bar, text='⬇  Descargar PDFs', width=180, height=38,
            fg_color=ACCENT, state='disabled', command=self._download,
        )
        self._dl_btn.pack(side='left', padx=4, pady=12)

        self._status = ctk.CTkLabel(bar, text='', font=ctk.CTkFont(size=12), text_color=TEXT_MUTED)
        self._status.pack(side='left', padx=12)

        # Área de resultados
        self._results = ctk.CTkScrollableFrame(self, fg_color=WHITE, corner_radius=10,
                                                label_text='Notificaciones')
        self._results.pack(fill='both', expand=True, padx=20, pady=(0, 20))
        ctk.CTkLabel(self._results,
                     text='Haz clic en "Comprobar DEHU" para ver las notificaciones.',
                     text_color=TEXT_MUTED).pack(pady=30)

    def _check(self):
        self._check_btn.configure(state='disabled', text='⏳  Comprobando...')
        self._status.configure(text='Conectando con DEHU...', text_color=TEXT_MUTED)
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
        for w in self._results.winfo_children():
            w.destroy()

        if not self._result or 'error' in self._result:
            self._show_error((self._result or {}).get('error', 'Error desconocido'))
            return

        total  = self._result['total']
        nuevas = self._result['new']
        n_new  = len(nuevas)
        self._status.configure(
            text=f'Total: {total}  |  Nuevas: {n_new}',
            text_color=DANGER if n_new > 0 else SUCCESS,
        )
        if n_new > 0:
            self._dl_btn.configure(state='normal')
            banner = ctk.CTkFrame(self._results, fg_color='#d4edda', corner_radius=6)
            banner.pack(fill='x', pady=(0, 8))
            ctk.CTkLabel(banner, text=f'🔔  {n_new} notificación(es) nueva(s)',
                         text_color='#155724', font=ctk.CTkFont(size=13, weight='bold')).pack(padx=12, pady=8)

        if not self._result['all']:
            ctk.CTkLabel(self._results, text='El buzón DEHU está vacío.',
                         text_color=TEXT_MUTED).pack(pady=20)
            return

        table_header(self._results, [('Fecha', 105), ('Organismo', 220), ('Asunto', 310), ('Estado', 100)])
        for i, n in enumerate(self._result['all']):
            es_nueva = n in nuevas
            bg  = '#fff8e1' if es_nueva else ('#f5f8ff' if i % 2 == 0 else WHITE)
            row = ctk.CTkFrame(self._results, fg_color=bg, corner_radius=4)
            row.pack(fill='x', pady=1)
            for val, w in [
                (n.get('fecha', ''), 105),
                (n.get('organismo', '')[:30], 220),
                (n.get('asunto', '')[:44], 310),
            ]:
                ctk.CTkLabel(row, text=val, width=w, anchor='w',
                             font=ctk.CTkFont(size=11)).pack(side='left', padx=8, pady=5)
            estado = '🆕 Nueva' if es_nueva else ('✓ Leída' if n.get('leida') else '● Pendiente')
            color  = WARNING if es_nueva else (TEXT_MUTED if n.get('leida') else DANGER)
            ctk.CTkLabel(row, text=estado, width=100, anchor='w',
                         font=ctk.CTkFont(size=11), text_color=color).pack(side='left', padx=8)

    def _show_error(self, msg: str):
        self._check_btn.configure(state='normal', text='🔍  Comprobar DEHU')
        self._status.configure(text=f'Error: {msg[:55]}', text_color=DANGER)
        for w in self._results.winfo_children():
            w.destroy()
        ctk.CTkLabel(self._results, text=f'❌  {msg}',
                     text_color=DANGER, wraplength=520).pack(pady=30)

    def _download(self):
        if not self._result:
            return
        from cert_manager.dehu_session import DEHUSession
        from cert_manager import dehu_downloader
        cert_path = self.cfg['dehu']['cert_pfx_path'].strip().strip('"\'')
        dest      = Path(self.cfg['general']['download_folder'])
        self._dl_btn.configure(state='disabled', text='⏳  Descargando...')

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
                    f'✓  {n} PDF(s) guardados en:\n{dest}\n\nÍndice: {dest / "indice.html"}',
                ))
            except Exception as e:
                self.after(0, lambda: messagebox.showerror('Error', str(e)))
            finally:
                self.after(0, lambda: self._dl_btn.configure(state='normal', text='⬇  Descargar PDFs'))

        threading.Thread(target=do, daemon=True).start()


class CleanPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg      = cfg
        self._expired = []
        self._checks  = {}
        page_header(self, '🗑 Limpiar', 'Elimina certificados caducados del almacén de Windows')
        self._build()

    def _build(self):
        bar = ctk.CTkFrame(self, fg_color=WHITE, corner_radius=8)
        bar.pack(fill='x', padx=20, pady=(0, 10))

        ctk.CTkButton(bar, text='🔍  Buscar caducados', width=190, height=38,
                      fg_color=PRIMARY, command=self._scan).pack(side='left', padx=12, pady=12)

        self._del_btn = ctk.CTkButton(bar, text='🗑  Eliminar seleccionados', width=210, height=38,
                                       fg_color=DANGER, state='disabled', command=self._delete)
        self._del_btn.pack(side='left', padx=4, pady=12)

        self._info = ctk.CTkLabel(bar, text='', font=ctk.CTkFont(size=12), text_color=TEXT_MUTED)
        self._info.pack(side='left', padx=12)

        self._scroll = ctk.CTkScrollableFrame(self, fg_color=WHITE, corner_radius=10,
                                               label_text='Certificados caducados')
        self._scroll.pack(fill='both', expand=True, padx=20, pady=(0, 20))
        ctk.CTkLabel(self._scroll, text='Haz clic en "Buscar caducados" para empezar.',
                     text_color=TEXT_MUTED).pack(pady=30)

    def _scan(self):
        certs = cert_scanner.scan(['MY'])
        if certs:
            certs = cert_validator.validate(certs)
        self._expired = cert_validator.filter_expired(certs)
        self._checks  = {}
        for w in self._scroll.winfo_children():
            w.destroy()

        if not self._expired:
            ctk.CTkLabel(self._scroll,
                         text='✓  No hay certificados caducados. ¡El almacén está limpio!',
                         text_color=SUCCESS, font=ctk.CTkFont(size=13)).pack(pady=30)
            self._del_btn.configure(state='disabled')
            self._info.configure(text='')
            return

        self._info.configure(text=f'{len(self._expired)} caducado(s)', text_color=DANGER)
        self._del_btn.configure(state='normal')

        for c in self._expired:
            row = ctk.CTkFrame(self._scroll, fg_color='#fff0f0', corner_radius=7)
            row.pack(fill='x', pady=5, padx=4)
            var = ctk.BooleanVar(value=True)
            self._checks[c.get('thumbprint', '')] = (var, c)

            ctk.CTkCheckBox(row, text='', variable=var, width=24).pack(side='left', padx=10, pady=12)
            info = ctk.CTkFrame(row, fg_color='transparent')
            info.pack(side='left', fill='x', expand=True)
            ctk.CTkLabel(info, text=c.get('subject', ''),
                         font=ctk.CTkFont(size=12, weight='bold'), anchor='w').pack(anchor='w', pady=(8, 2))
            ctk.CTkLabel(
                info,
                text=f"Emisor: {c.get('issuer','')}   |   Caducó: {c.get('not_after','')[:10]}",
                font=ctk.CTkFont(size=11), text_color=TEXT_MUTED, anchor='w',
            ).pack(anchor='w', pady=(0, 8))
            ctk.CTkLabel(row, text='✗ CADUCADO', text_color=DANGER,
                         font=ctk.CTkFont(size=11, weight='bold')).pack(side='right', padx=14)

    def _delete(self):
        selected = [(var, c) for var, c in self._checks.values() if var.get()]
        if not selected:
            messagebox.showwarning('Nada seleccionado', 'Marca al menos un certificado.')
            return
        if not messagebox.askyesno(
            'Confirmar eliminación',
            f'¿Eliminar {len(selected)} certificado(s) caducado(s)?\n\nEsta acción no se puede deshacer.',
            icon='warning',
        ):
            return
        deleted = errors = 0
        for var, c in selected:
            if cert_scanner.delete_by_thumbprint('MY', c.get('thumbprint', '')):
                deleted += 1
            else:
                errors += 1
        msg = f'Eliminados: {deleted}'
        if errors:
            msg += f'\nErrores: {errors}\n\nEjecuta como Administrador si hay problemas.'
        messagebox.showinfo('Resultado', msg)
        self._scan()


class ReportPage(ctk.CTkFrame):
    def __init__(self, parent, cfg, app=None):
        super().__init__(parent, fg_color=BG, corner_radius=0)
        self.cfg = cfg
        page_header(self, '📊 Informe', 'Genera informes de tus certificados en distintos formatos')
        self._build()

    def _build(self):
        card = ctk.CTkFrame(self, fg_color=WHITE, corner_radius=10)
        card.pack(fill='x', padx=20, pady=(0, 10))
        report_folder = Path(self.cfg['general']['report_folder'])
        ctk.CTkLabel(card, text=f'Carpeta: {report_folder}',
                     text_color=TEXT_MUTED, font=ctk.CTkFont(size=12)).pack(anchor='w', padx=16, pady=(12, 6))

        row = ctk.CTkFrame(card, fg_color='transparent')
        row.pack(fill='x', padx=12, pady=(0, 12))
        ctk.CTkButton(row, text='📄  HTML', width=130, height=38,
                      fg_color=PRIMARY, command=lambda: self._gen('html')).pack(side='left', padx=4)
        ctk.CTkButton(row, text='📋  CSV', width=120, height=38,
                      fg_color=ACCENT, text_color=BLACK,
                      command=lambda: self._gen('csv')).pack(side='left', padx=4)
        ctk.CTkButton(row, text='🗂  JSON', width=120, height=38,
                      fg_color='#6c757d', command=lambda: self._gen('json')).pack(side='left', padx=4)
        ctk.CTkButton(row, text='📂  Abrir carpeta', width=150, height=38,
                      fg_color='transparent', border_width=1, border_color=PRIMARY, text_color=PRIMARY,
                      command=lambda: self._open(report_folder)).pack(side='left', padx=8)

        self._log = ctk.CTkTextbox(self, height=220, font=ctk.CTkFont(size=11, family='Courier'))
        self._log.pack(fill='x', padx=20, pady=(0, 20))
        self._log.insert('end', 'Listo. Pulsa un botón para generar el informe.\n')
        self._log.configure(state='disabled')

    def _gen(self, fmt: str):
        stores     = [s.strip() for s in self.cfg['certificates']['stores'].split(',')]
        alert_days = int(self.cfg['general']['alert_days'])
        folder     = Path(self.cfg['general']['report_folder'])
        certs      = cert_scanner.scan(stores)
        if certs:
            certs = cert_validator.validate(certs, alert_days)
        try:
            if fmt == 'html':
                path = reporter.generate_html(certs, folder / 'informe_certificados.html')
            elif fmt == 'csv':
                path = reporter.generate_csv(certs, folder / 'certificados.csv')
            else:
                path = reporter.generate_json(certs, folder / 'certificados.json')
            self._log_line(f'✓ {fmt.upper()} generado: {path}')
        except Exception as e:
            self._log_line(f'✗ Error: {e}')

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
        self.cfg    = cfg
        self.app    = app
        self._fields = {}
        page_header(self, '⚙️ Configuración', 'Ajusta los parámetros del gestor')
        self._build()

    def _build(self):
        scroll = ctk.CTkScrollableFrame(self, fg_color='transparent')
        scroll.pack(fill='both', expand=True, padx=20, pady=(0, 10))

        sections = [
            ('🔐 Certificado DEHU', [
                ('cert_pfx_path', 'Ruta del certificado (.pfx / .p12)', 'dehu', True),
                ('cert_password', 'Contraseña del certificado',          'dehu', False),
                ('base_url',      'URL de DEHU',                         'dehu', False),
            ]),
            ('⚙️ General', [
                ('alert_days',       'Días de alerta antes de caducar', 'general', False),
                ('check_time',       'Hora comprobación diaria (HH:MM)', 'general', False),
                ('download_folder',  'Carpeta de descarga de PDFs',      'general', True),
                ('report_folder',    'Carpeta de informes',              'general', True),
            ]),
        ]

        for sec_title, fields in sections:
            sec = ctk.CTkFrame(scroll, fg_color=WHITE, corner_radius=10)
            sec.pack(fill='x', pady=8)
            ctk.CTkLabel(sec, text=sec_title,
                         font=ctk.CTkFont(size=14, weight='bold'), text_color=PRIMARY,
                         ).pack(anchor='w', padx=16, pady=(14, 6))

            for key, label, cfg_section, has_browse in fields:
                row = ctk.CTkFrame(sec, fg_color='transparent')
                row.pack(fill='x', padx=16, pady=5)
                ctk.CTkLabel(row, text=label, width=270, anchor='w',
                             font=ctk.CTkFont(size=12)).pack(side='left')
                show  = '*' if 'password' in key else None
                entry = ctk.CTkEntry(row, width=370, show=show)
                entry.insert(0, self.cfg[cfg_section].get(key, ''))
                entry.pack(side='left', padx=8)
                if has_browse:
                    ctk.CTkButton(row, text='📂', width=36, height=30,
                                  fg_color=PRIMARY,
                                  command=lambda e=entry, k=key: self._browse(e, k),
                                  ).pack(side='left', padx=2)
                self._fields[(cfg_section, key)] = entry

            ctk.CTkFrame(sec, height=10, fg_color='transparent').pack()

        ctk.CTkButton(scroll, text='💾  Guardar configuración', width=230, height=42,
                      fg_color=SUCCESS, command=self._save).pack(pady=14)

    def _browse(self, entry: ctk.CTkEntry, key: str):
        if 'folder' in key:
            path = filedialog.askdirectory()
        else:
            path = filedialog.askopenfilename(
                filetypes=[('Certificado digital', '*.pfx *.p12'), ('Todos los archivos', '*.*')]
            )
        if path:
            entry.delete(0, 'end')
            entry.insert(0, path)

    def _save(self):
        import configparser
        from cert_manager.config import _CONFIG_FILE
        cfg = configparser.ConfigParser()
        for section in ('general', 'dehu', 'certificates'):
            cfg[section] = dict(self.cfg[section])
        for (section, key), entry in self._fields.items():
            cfg[section][key] = entry.get()
        with open(_CONFIG_FILE, 'w', encoding='utf-8') as f:
            cfg.write(f)
        if self.app:
            self.app.reload_config()
            self.cfg = self.app.cfg
        messagebox.showinfo('Guardado', '✓  Configuración guardada correctamente.')


# ── Punto de entrada ─────────────────────────────────────────────────────────

def main():
    app = App()
    app.mainloop()


if __name__ == '__main__':
    main()
