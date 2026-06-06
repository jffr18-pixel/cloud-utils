"""
Generación de resúmenes en lectura fácil usando la API de Claude.

Transforma notificaciones administrativas en lenguaje claro para
ciudadanos con escasas habilidades digitales.
"""
import json
import logging
from datetime import date

logger = logging.getLogger(__name__)


def easy_read_available() -> bool:
    """True si anthropic está instalado y la API key está configurada."""
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    from cert_manager.config import load
    cfg = load()
    return bool(cfg.get('ai', 'anthropic_api_key', fallback='').strip())


def generate_easy_read(
    notification_text: str,
    sender: str = "",
    progress_cb=None,
) -> dict:
    """
    Llama a Claude para generar un resumen en lectura fácil.

    Devuelve:
        {'ok': True, 'text': str, 'what': str, 'deadline': str,
         'action': str, 'consequence': str, 'urgency': str}
    o   {'ok': False, 'error': str}
    """
    def _cb(msg):
        logger.info(msg)
        if progress_cb:
            progress_cb(msg)

    try:
        import anthropic
    except ImportError:
        return {
            'ok': False,
            'error': (
                'Módulo "anthropic" no instalado.\n'
                'Ejecuta: pip install anthropic'
            ),
        }

    from cert_manager.config import load
    cfg = load()
    api_key = cfg.get('ai', 'anthropic_api_key', fallback='').strip()
    model = cfg.get('ai', 'model', fallback='claude-haiku-4-5-20251001').strip()

    if not api_key:
        return {'ok': False, 'error': 'API key de Anthropic no configurada.'}

    today = date.today().strftime('%d de %B de %Y')
    sender_info = f'Remitente: {sender}\n' if sender else ''

    system_prompt = (
        'Eres un asistente que ayuda a personas mayores y con pocas habilidades '
        'digitales a entender notificaciones de la Administración española. '
        'Usa lenguaje muy sencillo, frases cortas, sin tecnicismos. '
        f'Hoy es {today}. '
        'Cuando hay un plazo, exprésalo también en días concretos desde hoy. '
        'Si hay consecuencias de no actuar, explícalas claramente pero sin alarmar. '
        'Responde ÚNICAMENTE con un objeto JSON válido, sin markdown.'
    )

    user_prompt = (
        f'{sender_info}'
        f'Notificación:\n{notification_text[:3000]}\n\n'
        'Devuelve un JSON con exactamente estos campos:\n'
        '{\n'
        '  "what": "¿Qué es esto? (1-2 frases muy simples)",\n'
        '  "deadline": "¿Cuándo hay que actuar? (vacío si no hay plazo)",\n'
        '  "action": "¿Qué hay que hacer? (pasos numerados si hay varios)",\n'
        '  "consequence": "¿Qué pasa si no actúas? (vacío si no hay consecuencias)",\n'
        '  "urgency": "alta|media|baja"\n'
        '}'
    )

    _cb('Generando resumen en lectura fácil...')
    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=model,
            max_tokens=500,
            system=system_prompt,
            messages=[{'role': 'user', 'content': user_prompt}],
        )
        raw = message.content[0].text.strip()

        # Limpiar posible markdown
        if raw.startswith('```'):
            raw = raw.split('```')[1]
            if raw.startswith('json'):
                raw = raw[4:]
        parsed = json.loads(raw)

        text = _build_full_text(parsed)
        return {
            'ok': True,
            'text': text,
            'what': parsed.get('what', ''),
            'deadline': parsed.get('deadline', ''),
            'action': parsed.get('action', ''),
            'consequence': parsed.get('consequence', ''),
            'urgency': parsed.get('urgency', 'media'),
        }
    except json.JSONDecodeError as e:
        logger.warning('JSON inválido de la API: %s', e)
        return {'ok': False, 'error': f'Respuesta inesperada de la IA: {e}'}
    except Exception as e:
        logger.error('Error en easy_read: %s', e)
        return {'ok': False, 'error': str(e)}


def _build_full_text(parsed: dict) -> str:
    parts = []
    if parsed.get('what'):
        parts.append(f'📋 ¿Qué es esto?\n   {parsed["what"]}')
    if parsed.get('deadline'):
        parts.append(f'⏰ ¿Cuándo hay que actuar?\n   {parsed["deadline"]}')
    if parsed.get('action'):
        parts.append(f'✅ ¿Qué hay que hacer?\n   {parsed["action"]}')
    if parsed.get('consequence'):
        parts.append(f'❗ ¿Qué pasa si no actúas?\n   {parsed["consequence"]}')
    return '\n\n'.join(parts)


def format_for_whatsapp(easy_read_dict: dict, gestor_name: str = "") -> str:
    """Formatea el resumen para WhatsApp (sin HTML, máx ~1000 chars)."""
    if not easy_read_dict.get('ok'):
        return ''
    text = easy_read_dict.get('text', '')
    footer = f'\n\n— {gestor_name}' if gestor_name else ''
    result = text + footer
    if len(result) > 1000:
        result = result[:997] + '...'
    return result


def format_for_email_html(easy_read_dict: dict) -> str:
    """Formatea el resumen como HTML para email."""
    if not easy_read_dict.get('ok'):
        return '<p>No se pudo generar el resumen automático.</p>'

    urgency = easy_read_dict.get('urgency', 'media')
    urgency_color = {'alta': '#e53e3e', 'media': '#d69e2e', 'baja': '#38a169'}.get(urgency, '#666')
    urgency_label = {'alta': 'URGENTE', 'media': 'Requiere atención', 'baja': 'Informativo'}.get(urgency, '')

    rows = []
    if easy_read_dict.get('what'):
        rows.append(f'<p><strong>📋 ¿Qué es esto?</strong><br>{easy_read_dict["what"]}</p>')
    if easy_read_dict.get('deadline'):
        rows.append(f'<p><strong>⏰ ¿Cuándo hay que actuar?</strong><br>{easy_read_dict["deadline"]}</p>')
    if easy_read_dict.get('action'):
        rows.append(f'<p><strong>✅ ¿Qué hay que hacer?</strong><br>{easy_read_dict["action"]}</p>')
    if easy_read_dict.get('consequence'):
        rows.append(f'<p style="color:#c53030"><strong>❗ ¿Qué pasa si no actúas?</strong><br>{easy_read_dict["consequence"]}</p>')

    badge = (
        f'<span style="background:{urgency_color};color:white;padding:3px 10px;'
        f'border-radius:12px;font-size:13px;font-weight:bold">{urgency_label}</span>'
    )
    return f'{badge}<br><br>' + '\n'.join(rows)
