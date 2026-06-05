from flask import Flask, render_template, request, redirect, url_for, session, flash, jsonify
import json, hashlib, os

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'eapnclm-formacion-2024')

# ── Mock data ─────────────────────────────────────────────────────────────────

CATEGORIAS = [
    {"id": "inclusion", "nombre": "Inclusión Social", "icono": "🤝", "total": 8},
    {"id": "empleo",    "nombre": "Empleo y Orientación", "icono": "💼", "total": 6},
    {"id": "genero",    "nombre": "Igualdad y Género", "icono": "⚖️", "total": 5},
    {"id": "digital",   "nombre": "Competencias Digitales", "icono": "💻", "total": 4},
    {"id": "gestion",   "nombre": "Gestión de Entidades", "icono": "🏛️", "total": 7},
    {"id": "voluntariado", "nombre": "Voluntariado", "icono": "🌱", "total": 3},
]

CURSOS = [
    {
        "id": 1, "slug": "inclusion-social-empleo",
        "titulo": "Inclusión Social y Acceso al Empleo",
        "categoria": "inclusion", "nivel": "Básico",
        "modalidad": "Online", "duracion": "40 horas",
        "precio": "Gratuito", "inscritos": 248,
        "valoracion": 4.8, "valoraciones": 96,
        "descripcion": "Aprende las herramientas y metodologías para facilitar la inserción laboral de colectivos en situación de vulnerabilidad social.",
        "imagen": "curso1",
        "objetivos": [
            "Conocer el marco normativo de la inclusión social en España",
            "Identificar barreras de acceso al empleo en colectivos vulnerables",
            "Aplicar itinerarios personalizados de inserción sociolaboral",
            "Manejar recursos y entidades del ecosistema de inclusión",
        ],
        "modulos": [
            {"num": 1, "titulo": "Marco de la exclusión social en España", "duracion": "6h"},
            {"num": 2, "titulo": "Colectivos prioritarios y perfiles de vulnerabilidad", "duracion": "8h"},
            {"num": 3, "titulo": "Itinerarios de inclusión sociolaboral", "duracion": "10h"},
            {"num": 4, "titulo": "Recursos y redes de apoyo", "duracion": "8h"},
            {"num": 5, "titulo": "Evaluación y seguimiento de casos", "duracion": "8h"},
        ],
        "instructor": "María González Ruiz",
        "instructor_cargo": "Trabajadora Social — EAPN CLM",
        "destacado": True, "nuevo": False,
    },
    {
        "id": 2, "slug": "gestion-tercer-sector",
        "titulo": "Gestión de Entidades del Tercer Sector",
        "categoria": "gestion", "nivel": "Intermedio",
        "modalidad": "Semipresencial", "duracion": "60 horas",
        "precio": "Gratuito", "inscritos": 183,
        "valoracion": 4.6, "valoraciones": 74,
        "descripcion": "Formación integral en planificación estratégica, captación de fondos y gestión de proyectos sociales para organizaciones sin ánimo de lucro.",
        "imagen": "curso2",
        "objetivos": [
            "Diseñar planes estratégicos para entidades sociales",
            "Gestionar subvenciones y financiación pública",
            "Coordinar equipos de trabajo social",
            "Elaborar memorias e informes de impacto",
        ],
        "modulos": [
            {"num": 1, "titulo": "Planificación estratégica en ONG", "duracion": "10h"},
            {"num": 2, "titulo": "Captación de fondos y subvenciones", "duracion": "15h"},
            {"num": 3, "titulo": "Gestión de proyectos sociales", "duracion": "15h"},
            {"num": 4, "titulo": "Rendición de cuentas y transparencia", "duracion": "10h"},
            {"num": 5, "titulo": "Comunicación y marketing social", "duracion": "10h"},
        ],
        "instructor": "Carlos Moreno Díaz",
        "instructor_cargo": "Director — Red EAPN España",
        "destacado": True, "nuevo": False,
    },
    {
        "id": 3, "slug": "perspectiva-genero-intervencion",
        "titulo": "Perspectiva de Género en la Intervención Social",
        "categoria": "genero", "nivel": "Básico",
        "modalidad": "Online", "duracion": "30 horas",
        "precio": "Gratuito", "inscritos": 312,
        "valoracion": 4.9, "valoraciones": 128,
        "descripcion": "Integra la perspectiva de género en todos los ámbitos de la intervención social, desde el diagnóstico hasta la evaluación de proyectos.",
        "imagen": "curso3",
        "objetivos": [
            "Comprender el enfoque de género en los servicios sociales",
            "Identificar desigualdades estructurales de género",
            "Aplicar herramientas de análisis con perspectiva feminista",
            "Diseñar intervenciones que promuevan la igualdad real",
        ],
        "modulos": [
            {"num": 1, "titulo": "Marco conceptual del género", "duracion": "6h"},
            {"num": 2, "titulo": "Género y exclusión social", "duracion": "8h"},
            {"num": 3, "titulo": "Herramientas de análisis de género", "duracion": "8h"},
            {"num": 4, "titulo": "Diseño de proyectos con perspectiva de género", "duracion": "8h"},
        ],
        "instructor": "Ana Fernández López",
        "instructor_cargo": "Experta en Igualdad — Junta de C-LM",
        "destacado": True, "nuevo": True,
    },
    {
        "id": 4, "slug": "habilidades-digitales-empleo",
        "titulo": "Habilidades Digitales para la Empleabilidad",
        "categoria": "digital", "nivel": "Básico",
        "modalidad": "Online", "duracion": "25 horas",
        "precio": "Gratuito", "inscritos": 421,
        "valoracion": 4.7, "valoraciones": 185,
        "descripcion": "Adquiere las competencias digitales esenciales que demanda el mercado laboral actual: ofimática, internet, seguridad online y herramientas de búsqueda de empleo.",
        "imagen": "curso4",
        "objetivos": [
            "Manejar herramientas ofimáticas a nivel básico/intermedio",
            "Utilizar plataformas de búsqueda de empleo online",
            "Crear un perfil profesional digital atractivo",
            "Navegar con seguridad en internet",
        ],
        "modulos": [
            {"num": 1, "titulo": "Ofimática y productividad digital", "duracion": "8h"},
            {"num": 2, "titulo": "Internet y comunicación online", "duracion": "5h"},
            {"num": 3, "titulo": "Búsqueda de empleo 2.0", "duracion": "7h"},
            {"num": 4, "titulo": "Seguridad y privacidad digital", "duracion": "5h"},
        ],
        "instructor": "Pedro Sánchez Martín",
        "instructor_cargo": "Formador TIC — Cruz Roja CLM",
        "destacado": False, "nuevo": True,
    },
    {
        "id": 5, "slug": "orientacion-laboral-avanzada",
        "titulo": "Orientación Laboral Avanzada",
        "categoria": "empleo", "nivel": "Avanzado",
        "modalidad": "Presencial", "duracion": "50 horas",
        "precio": "Gratuito", "inscritos": 97,
        "valoracion": 4.5, "valoraciones": 42,
        "descripcion": "Formación especializada para orientadores laborales que trabajan con colectivos de difícil inserción, con metodologías innovadoras y enfoque motivacional.",
        "imagen": "curso5",
        "objetivos": [
            "Aplicar técnicas de coaching y motivación laboral",
            "Diseñar planes de empleo individualizados complejos",
            "Trabajar con colectivos de muy baja empleabilidad",
            "Gestionar situaciones de crisis y desmotivación",
        ],
        "modulos": [
            {"num": 1, "titulo": "Técnicas avanzadas de orientación", "duracion": "12h"},
            {"num": 2, "titulo": "Coaching para la inserción laboral", "duracion": "13h"},
            {"num": 3, "titulo": "Colectivos de alta vulnerabilidad", "duracion": "13h"},
            {"num": 4, "titulo": "Intervención en crisis y seguimiento", "duracion": "12h"},
        ],
        "instructor": "Lucía Ramírez Torres",
        "instructor_cargo": "Orientadora Laboral — SEPE",
        "destacado": False, "nuevo": False,
    },
    {
        "id": 6, "slug": "voluntariado-transformacion-social",
        "titulo": "Voluntariado y Transformación Social",
        "categoria": "voluntariado", "nivel": "Básico",
        "modalidad": "Online", "duracion": "20 horas",
        "precio": "Gratuito", "inscritos": 534,
        "valoracion": 4.8, "valoraciones": 213,
        "descripcion": "Descubre el poder del voluntariado organizado como herramienta de cambio social. Aprende a coordinar y motivar equipos de voluntarios en entidades sociales.",
        "imagen": "curso6",
        "objetivos": [
            "Comprender el voluntariado como agente de cambio",
            "Gestionar equipos de voluntariado eficazmente",
            "Diseñar programas de captación y fidelización",
            "Evaluar el impacto del voluntariado en la comunidad",
        ],
        "modulos": [
            {"num": 1, "titulo": "El voluntariado en el siglo XXI", "duracion": "5h"},
            {"num": 2, "titulo": "Gestión y coordinación de voluntarios", "duracion": "7h"},
            {"num": 3, "titulo": "Captación y fidelización", "duracion": "4h"},
            {"num": 4, "titulo": "Medición del impacto", "duracion": "4h"},
        ],
        "instructor": "Javier Muñoz Cano",
        "instructor_cargo": "Coordinador de Voluntariado — EAPN CLM",
        "destacado": True, "nuevo": False,
    },
]

USUARIOS = {
    "demo@eapnclm.es": {
        "nombre": "Usuario Demo",
        "password": hashlib.sha256(b"demo1234").hexdigest(),
        "cursos_inscritos": [1, 3, 6],
        "progreso": {1: 75, 3: 40, 6: 100},
    }
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def get_usuario():
    email = session.get('usuario')
    return USUARIOS.get(email) if email else None

def curso_por_slug(slug):
    return next((c for c in CURSOS if c['slug'] == slug), None)

def cursos_destacados():
    return [c for c in CURSOS if c['destacado']]

# ── Rutas ─────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html',
                           usuario=get_usuario(),
                           cursos=cursos_destacados(),
                           categorias=CATEGORIAS,
                           total_cursos=len(CURSOS),
                           total_inscritos=sum(c['inscritos'] for c in CURSOS))

@app.route('/cursos')
def cursos():
    categoria = request.args.get('categoria', '')
    nivel     = request.args.get('nivel', '')
    modalidad = request.args.get('modalidad', '')
    busqueda  = request.args.get('q', '').lower()

    resultado = CURSOS
    if categoria:
        resultado = [c for c in resultado if c['categoria'] == categoria]
    if nivel:
        resultado = [c for c in resultado if c['nivel'] == nivel]
    if modalidad:
        resultado = [c for c in resultado if c['modalidad'] == modalidad]
    if busqueda:
        resultado = [c for c in resultado if busqueda in c['titulo'].lower()
                     or busqueda in c['descripcion'].lower()]

    return render_template('cursos.html',
                           usuario=get_usuario(),
                           cursos=resultado,
                           categorias=CATEGORIAS,
                           filtros={'categoria': categoria, 'nivel': nivel,
                                    'modalidad': modalidad, 'q': busqueda})

@app.route('/curso/<slug>')
def curso_detalle(slug):
    curso = curso_por_slug(slug)
    if not curso:
        return redirect(url_for('cursos'))
    usuario = get_usuario()
    inscrito = False
    progreso = 0
    if usuario:
        inscrito = curso['id'] in usuario['cursos_inscritos']
        progreso = usuario['progreso'].get(curso['id'], 0)
    relacionados = [c for c in CURSOS if c['categoria'] == curso['categoria'] and c['id'] != curso['id']][:3]
    return render_template('curso_detalle.html',
                           curso=curso, usuario=usuario,
                           inscrito=inscrito, progreso=progreso,
                           relacionados=relacionados)

@app.route('/inscribirse/<int:curso_id>', methods=['POST'])
def inscribirse(curso_id):
    if not session.get('usuario'):
        flash('Debes iniciar sesión para inscribirte.', 'warning')
        return redirect(url_for('login'))
    email = session['usuario']
    if curso_id not in USUARIOS[email]['cursos_inscritos']:
        USUARIOS[email]['cursos_inscritos'].append(curso_id)
        USUARIOS[email]['progreso'][curso_id] = 0
        flash('¡Te has inscrito correctamente!', 'success')
    curso = next((c for c in CURSOS if c['id'] == curso_id), None)
    return redirect(url_for('curso_detalle', slug=curso['slug']) if curso else url_for('cursos'))

@app.route('/mi-area')
def dashboard():
    usuario = get_usuario()
    if not usuario:
        return redirect(url_for('login'))
    mis_cursos = [c for c in CURSOS if c['id'] in usuario['cursos_inscritos']]
    return render_template('dashboard.html', usuario=usuario, mis_cursos=mis_cursos)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('usuario'):
        return redirect(url_for('dashboard'))
    if request.method == 'POST':
        email    = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        hashed   = hashlib.sha256(password.encode()).hexdigest()
        user = USUARIOS.get(email)
        if user and user['password'] == hashed:
            session['usuario'] = email
            flash(f'¡Bienvenido/a, {user["nombre"]}!', 'success')
            return redirect(request.args.get('next') or url_for('dashboard'))
        flash('Email o contraseña incorrectos.', 'danger')
    return render_template('login.html', usuario=None)

@app.route('/registro', methods=['GET', 'POST'])
def registro():
    if session.get('usuario'):
        return redirect(url_for('dashboard'))
    if request.method == 'POST':
        nombre   = request.form.get('nombre', '').strip()
        email    = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        if email in USUARIOS:
            flash('Ese email ya está registrado.', 'danger')
        elif len(password) < 6:
            flash('La contraseña debe tener al menos 6 caracteres.', 'danger')
        else:
            USUARIOS[email] = {
                'nombre': nombre,
                'password': hashlib.sha256(password.encode()).hexdigest(),
                'cursos_inscritos': [],
                'progreso': {},
            }
            session['usuario'] = email
            flash('¡Cuenta creada con éxito! Bienvenido/a.', 'success')
            return redirect(url_for('dashboard'))
    return render_template('registro.html', usuario=None)

@app.route('/logout')
def logout():
    session.clear()
    flash('Sesión cerrada correctamente.', 'info')
    return redirect(url_for('index'))

@app.route('/api/buscar')
def api_buscar():
    q = request.args.get('q', '').lower()
    if len(q) < 2:
        return jsonify([])
    resultados = [
        {'titulo': c['titulo'], 'slug': c['slug'], 'categoria': c['categoria']}
        for c in CURSOS if q in c['titulo'].lower()
    ][:6]
    return jsonify(resultados)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
