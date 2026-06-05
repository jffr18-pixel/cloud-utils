"""
Script de compilación de BurocraciaZero.exe

Uso (PowerShell, desde la carpeta raíz del proyecto):
    python build_exe.py

Requisitos previos:
    pip install pyinstaller pillow
"""
import subprocess
import sys
import shutil
from pathlib import Path

ROOT = Path(__file__).parent


def convert_logo_to_ico():
    """Convierte logo_bz.png a logo_bz.ico si no existe."""
    png = ROOT / 'assets' / 'logo_bz.png'
    ico = ROOT / 'assets' / 'logo_bz.ico'
    if ico.exists():
        print(f'[ok] Icono ya existe: {ico.name}')
        return True
    if not png.exists():
        print('[aviso] No se encontró assets/logo_bz.png — se usará icono por defecto')
        return False
    try:
        from PIL import Image
        img = Image.open(png).convert('RGBA')
        # Tamaños estándar de .ico para Windows
        img.save(ico, format='ICO', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
        print(f'[ok] Icono generado: {ico.name}')
        return True
    except ImportError:
        print('[aviso] Pillow no instalado, sin icono personalizado')
        return False
    except Exception as e:
        print(f'[aviso] No se pudo convertir el logo: {e}')
        return False


def find_customtkinter_path():
    """Localiza la carpeta de customtkinter instalada."""
    try:
        import customtkinter
        return str(Path(customtkinter.__file__).parent)
    except ImportError:
        return None


def patch_spec(spec_path: Path, ctk_path: str | None, has_ico: bool):
    """Ajusta el .spec con rutas reales del entorno actual."""
    content = spec_path.read_text(encoding='utf-8')

    # Ruta de customtkinter (varía según venv, Python version, etc.)
    if ctk_path:
        content = content.replace(
            "'venv/Lib/site-packages/customtkinter'",
            repr(ctk_path),
        )

    # Si no hay .ico, quitar la referencia para evitar error
    if not has_ico:
        content = content.replace(
            "    icon='assets/logo_bz.ico',",
            "    # icon sin .ico disponible",
        )

    spec_path.write_text(content, encoding='utf-8')


def build():
    print('=' * 60)
    print('  BurocraciaZero — compilador de ejecutable')
    print('=' * 60)

    # 1. Convertir logo
    has_ico = convert_logo_to_ico()

    # 2. Localizar customtkinter
    ctk_path = find_customtkinter_path()
    if ctk_path:
        print(f'[ok] customtkinter encontrado en: {ctk_path}')
    else:
        print('[aviso] customtkinter no encontrado — instala con: pip install customtkinter')

    # 3. Ajustar .spec
    spec = ROOT / 'BurocraciaZero.spec'
    patch_spec(spec, ctk_path, has_ico)

    # 4. Limpiar compilaciones anteriores
    for d in ['build', 'dist']:
        if (ROOT / d).exists():
            shutil.rmtree(ROOT / d)
            print(f'[ok] Carpeta limpiada: {d}/')

    # 5. Compilar
    print('\nCompilando (puede tardar 1-2 minutos)...\n')
    result = subprocess.run(
        [sys.executable, '-m', 'PyInstaller', str(spec), '--clean'],
        cwd=ROOT,
    )

    if result.returncode != 0:
        print('\n[error] La compilación falló.')
        sys.exit(1)

    exe = ROOT / 'dist' / 'BurocraciaZero.exe'
    if exe.exists():
        size_mb = exe.stat().st_size / 1024 / 1024
        print(f'\n{"=" * 60}')
        print(f'  ✓ Ejecutable listo: dist/BurocraciaZero.exe')
        print(f'  Tamaño: {size_mb:.1f} MB')
        print(f'{"=" * 60}')
        print('\nPuedes copiar dist/BurocraciaZero.exe a cualquier PC Windows.')
        print('No requiere Python ni ninguna instalación adicional.')
    else:
        print('[error] No se generó el ejecutable.')
        sys.exit(1)


if __name__ == '__main__':
    build()
