#!/usr/bin/env python3
"""
Gestor de Certificados Digitales para Windows 11
Comprueba certificados instalados y notificaciones de DEHU diariamente.
"""
import argparse
import logging
import sys
from pathlib import Path


def _request_admin() -> None:
    """Re-launch with UAC elevation if not already admin (Windows only)."""
    if sys.platform != 'win32':
        return
    import ctypes
    try:
        if ctypes.windll.shell32.IsUserAnAdmin():
            return
    except Exception:
        return
    script = str(Path(__file__).resolve())
    args   = ' '.join(f'"{a}"' for a in sys.argv[1:])
    ret    = ctypes.windll.shell32.ShellExecuteW(
        None, 'runas', sys.executable, f'"{script}" {args}', None, 1
    )
    if ret > 32:
        sys.exit(0)


_request_admin()

from cert_manager import config as cfg_module
from cert_manager import cert_scanner, cert_validator, reporter, scheduler_setup
from cert_manager.notifier import notify

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


def _print_cert_table(certs):
    symbols = {'valid': '✓', 'expiring_soon': '⚠', 'expired': '✗', 'unknown': '?'}
    print(f"\n{'#':<4} {'Estado':<18} {'Titular':<35} {'Emisor':<25} {'Caduca':<12} {'Días'}")
    print("-" * 100)
    for i, c in enumerate(certs, 1):
        symbol = symbols.get(c.get('status', 'unknown'), '?')
        label = c.get('status_label', '?')
        subject = c.get('subject', '')[:34]
        issuer = c.get('issuer', '')[:24]
        not_after = c.get('not_after', '')[:10]
        days = c.get('days_remaining', '')
        days_str = str(days) if isinstance(days, int) and days >= 0 else 'CADUCADO'
        print(f"{i:<4} {symbol} {label:<16} {subject:<35} {issuer:<25} {not_after:<12} {days_str}")
    print()


def cmd_scan(cfg, args):
    stores = [s.strip() for s in cfg['certificates']['stores'].split(',')]
    alert_days = int(cfg['general']['alert_days'])

    print(f"\nEscaneando almacenes: {', '.join(stores)} ...")
    certs = cert_scanner.scan(stores)

    if not certs:
        print("No se encontraron certificados (¿estás en Windows?).")
        return

    certs = cert_validator.validate(certs, alert_days)
    _print_cert_table(certs)


def cmd_check_dehu(cfg, args):
    cert_path = cfg['dehu']['cert_pfx_path']
    if not cert_path:
        print("ERROR: Configura 'cert_pfx_path' en config.ini con la ruta a tu certificado .pfx")
        sys.exit(1)

    from cert_manager.dehu_session import DEHUSession
    from cert_manager import dehu_checker

    log_folder = Path(cfg['general']['log_folder'])
    print("Consultando DEHU ...")

    with DEHUSession(cert_path, cfg['dehu']['cert_password'],
                     cfg['dehu']['base_url'], int(cfg['dehu']['timeout'])) as session:
        result = dehu_checker.check(session, log_folder)

    if 'error' in result:
        print(f"Error: {result['error']}")
        sys.exit(1)

    n_new = len(result['new'])
    print(f"\nTotal notificaciones: {result['total']}")
    print(f"Nuevas desde última comprobación: {n_new}")

    if n_new > 0:
        print("\nNOTIFICACIONES NUEVAS:")
        for n in result['new']:
            print(f"  [{n['fecha']}] {n['organismo']} — {n['asunto']}")
        notify("DEHU — Nuevas notificaciones",
               f"Tienes {n_new} notificación(es) nueva(s) en DEHU.")


def cmd_download(cfg, args):
    cert_path = cfg['dehu']['cert_pfx_path']
    if not cert_path:
        print("ERROR: Configura 'cert_pfx_path' en config.ini con la ruta a tu certificado .pfx")
        sys.exit(1)

    from cert_manager.dehu_session import DEHUSession
    from cert_manager import dehu_checker, dehu_downloader

    log_folder = Path(cfg['general']['log_folder'])
    download_folder = Path(args.folder or cfg['general']['download_folder'])
    safe_mode = not args.no_safe_mode

    print(f"Carpeta de descarga: {download_folder}")
    if safe_mode:
        print("Modo seguro ACTIVADO — se pedirá confirmación antes de cada notificación no leída.")

    with DEHUSession(cert_path, cfg['dehu']['cert_password'],
                     cfg['dehu']['base_url'], int(cfg['dehu']['timeout'])) as session:
        result = dehu_checker.check(session, log_folder)

        if 'error' in result:
            print(f"Error al consultar DEHU: {result['error']}")
            sys.exit(1)

        notifications = result['all']
        if args.only_pending:
            notifications = [n for n in notifications if not n.get('leida')]
            print(f"Descargando solo pendientes: {len(notifications)} notificación(es).")
        else:
            print(f"Descargando {len(notifications)} notificación(es).")

        def confirm(notif):
            resp = input(
                f"\n  ⚠  Notificación NO leída:\n"
                f"     [{notif['fecha']}] {notif['organismo']} — {notif['asunto']}\n"
                f"  Descargarla MARCARÁ su recepción oficial. ¿Continuar? [s/N]: "
            )
            return resp.strip().lower() in ('s', 'si', 'sí', 'yes', 'y')

        dl_result = dehu_downloader.download_notifications(
            session,
            notifications,
            download_folder,
            safe_mode=safe_mode,
            confirm_fn=confirm if safe_mode else None,
            only_pending=args.only_pending,
        )

    print(f"\nDescargadas: {len(dl_result['downloaded'])}")
    print(f"Omitidas:    {len(dl_result['skipped'])}")
    if dl_result['errors']:
        print(f"Errores:     {len(dl_result['errors'])}")
    print(f"\nÍndice HTML: {download_folder / 'indice.html'}")


def cmd_report(cfg, args):
    stores = [s.strip() for s in cfg['certificates']['stores'].split(',')]
    alert_days = int(cfg['general']['alert_days'])
    report_folder = Path(cfg['general']['report_folder'])

    certs = cert_scanner.scan(stores)
    if certs:
        certs = cert_validator.validate(certs, alert_days)

    html_path = reporter.generate_html(certs, report_folder / 'informe_certificados.html')
    reporter.generate_json(certs, report_folder / 'certificados.json')
    reporter.generate_csv(certs, report_folder / 'certificados.csv')

    print(f"\nInforme generado en: {html_path}")


def cmd_clean(cfg, args):
    print("\nBuscando certificados caducados en el almacén personal (MY) ...")
    certs = cert_scanner.scan(['MY'])

    if not certs:
        print("No se encontraron certificados (¿estás en Windows?).")
        return

    certs = cert_validator.validate(certs)
    expired = cert_validator.filter_expired(certs)

    if not expired:
        print("✓ No hay certificados caducados. El almacén está limpio.")
        return

    print(f"\nCertificados caducados encontrados: {len(expired)}\n")
    for i, c in enumerate(expired, 1):
        print(f"  {i}. {c.get('subject','')}")
        print(f"     Emisor:  {c.get('issuer','')}")
        print(f"     Caducó:  {c.get('not_after','')[:10]}")
        print(f"     Huella:  {c.get('thumbprint','')}")
        print()

    if not args.yes:
        print("⚠  ATENCIÓN: Esta acción eliminará permanentemente estos certificados de Windows.")
        resp = input(f"¿Eliminar los {len(expired)} certificados caducados? [s/N]: ")
        if resp.strip().lower() not in ('s', 'si', 'sí', 'yes', 'y'):
            print("Cancelado. No se ha eliminado nada.")
            return

    print()
    deleted = 0
    errors = 0
    for c in expired:
        thumbprint = c.get('thumbprint', '')
        subject = c.get('subject', '')
        if not thumbprint:
            print(f"  ✗ Sin huella digital, no se puede eliminar: {subject}")
            errors += 1
            continue
        if cert_scanner.delete_by_thumbprint('MY', thumbprint):
            print(f"  ✓ Eliminado: {subject}")
            deleted += 1
        else:
            print(f"  ✗ Error eliminando: {subject}")
            errors += 1

    print(f"\nEliminados: {deleted}/{len(expired)}")
    if errors:
        print("⚠  Si hubo errores, abre PowerShell como Administrador y vuelve a ejecutar.")
        print("   Clic derecho en PowerShell → 'Ejecutar como administrador'")


def cmd_schedule(cfg, args):
    run_time = args.time or cfg['general']['check_time']
    scheduler_setup.install(Path(__file__), run_time=run_time)


def cmd_status(cfg, args):
    stores = [s.strip() for s in cfg['certificates']['stores'].split(',')]
    alert_days = int(cfg['general']['alert_days'])
    certs = cert_scanner.scan(stores)

    if certs:
        certs = cert_validator.validate(certs, alert_days)

    expired = cert_validator.filter_expired(certs)
    expiring = cert_validator.filter_expiring(certs, alert_days)

    print("\n" + "=" * 62)
    print("  GESTOR DE CERTIFICADOS DIGITALES — Windows 11")
    print("=" * 62)
    print(f"\nCERTIFICADOS ENCONTRADOS: {len(certs)}")
    for c in certs:
        symbol = {'valid': '✓', 'expiring_soon': '⚠', 'expired': '✗'}.get(c.get('status', ''), '?')
        days = c.get('days_remaining', '')
        days_str = f"(caduca en {days} días)" if isinstance(days, int) and days >= 0 else "(CADUCADO)"
        print(f"  {symbol} {c.get('issuer','')} — {c.get('subject','')}  {days_str}")

    if expired:
        print(f"\n⚠  ALERTA: {len(expired)} certificado(s) CADUCADO(S)")
    if expiring:
        print(f"⚠  ALERTA: {len(expiring)} certificado(s) caducan en menos de {alert_days} días")

    scheduler_setup.status()
    print("=" * 62 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description='Gestor de Certificados Digitales para Windows 11 con integración DEHU'
    )
    sub = parser.add_subparsers(dest='command', required=True)

    sub.add_parser('scan', help='Escanear certificados instalados en Windows')

    sub.add_parser('check-dehu', help='Comprobar notificaciones en DEHU ahora mismo')

    dl = sub.add_parser('download', help='Descargar notificaciones de DEHU a carpeta local')
    dl.add_argument('--folder', help='Carpeta de destino (sobreescribe config.ini)')
    dl.add_argument('--only-pending', action='store_true', help='Solo descargar notificaciones no leídas')
    dl.add_argument('--no-safe-mode', action='store_true', help='Descargar sin pedir confirmación')

    sub.add_parser('report', help='Generar informe HTML/JSON/CSV de certificados')

    sched = sub.add_parser('schedule', help='Instalar tarea programada diaria en Windows')
    sched.add_argument('--time', help='Hora de ejecución HH:MM (por defecto 09:00)')

    sub.add_parser('status', help='Ver estado general: certificados + tarea programada')

    clean = sub.add_parser('clean', help='Eliminar certificados caducados del almacén de Windows')
    clean.add_argument('--yes', '-y', action='store_true', help='Eliminar sin pedir confirmación')

    sub.add_parser('init-config', help='Crear config.ini con valores por defecto')

    args = parser.parse_args()

    if args.command == 'init-config':
        cfg_module.create_default()
        print("config.ini creado. Edítalo con la ruta a tu certificado .pfx.")
        return

    cfg = cfg_module.load()
    dispatch = {
        'scan': cmd_scan,
        'check-dehu': cmd_check_dehu,
        'download': cmd_download,
        'report': cmd_report,
        'schedule': cmd_schedule,
        'status': cmd_status,
        'clean': cmd_clean,
    }
    dispatch[args.command](cfg, args)


if __name__ == '__main__':
    main()
