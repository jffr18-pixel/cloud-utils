# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec para BurocraciaZero
# Ejecutar desde la raíz del proyecto:
#   pyinstaller BurocraciaZero.spec

import sys
from pathlib import Path

block_cipher = None

# Datos adicionales (carpetas/ficheros que no son código Python)
added_files = [
    # Logo y recursos gráficos
    ('assets/logo_bz.png', 'assets'),
    # Plantillas de CustomTkinter (temas, widgets)
    ('venv/Lib/site-packages/customtkinter', 'customtkinter'),
]

a = Analysis(
    ['gui.py'],
    pathex=[],
    binaries=[],
    datas=added_files,
    hiddenimports=[
        # cert_manager sub-módulos
        'cert_manager',
        'cert_manager.cert_scanner',
        'cert_manager.cert_validator',
        'cert_manager.config',
        'cert_manager.dehu_certs',
        'cert_manager.dehu_checker',
        'cert_manager.dehu_downloader',
        'cert_manager.dehu_session',
        'cert_manager.edge_policy',
        'cert_manager.notifier',
        'cert_manager.reporter',
        'cert_manager.scheduler_setup',
        'cert_manager.servicios',
        'cert_manager.servicios_auto',
        # Backends de cryptography
        'cryptography.hazmat.backends.openssl',
        'cryptography.hazmat.primitives.asymmetric.rsa',
        'cryptography.hazmat.primitives.asymmetric.ec',
        # Parsers de lxml
        'lxml._elementpath',
        'lxml.etree',
        # Pillow formatos
        'PIL._tkinter_finder',
        'PIL.ImageTk',
        # Selenium (carga dinámica de drivers)
        'selenium.webdriver.edge.webdriver',
        'selenium.webdriver.chrome.webdriver',
        'selenium.webdriver.common.by',
        'selenium.webdriver.support.ui',
        'selenium.webdriver.support.expected_conditions',
        # Notificaciones Windows
        'win10toast',
        # wincertstore (solo Windows)
        'wincertstore',
        # tkinter
        'tkinter',
        'tkinter.ttk',
        'tkinter.messagebox',
        'tkinter.filedialog',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'pytest',
        'test',
        'tests',
        'matplotlib',
        'numpy',
        'pandas',
        'scipy',
        'IPython',
        'jupyter',
        'notebook',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='BurocraciaZero',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    # Ventana sin consola (app gráfica)
    console=False,
    # Solicitar permisos de administrador al lanzar
    uac_admin=True,
    # Icono de la app (requiere .ico en Windows)
    icon='assets/logo_bz.ico',
    # Metadatos del ejecutable (visibles en Propiedades)
    version_file=None,
)
