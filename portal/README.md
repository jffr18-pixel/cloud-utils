# Portal de clientes — Burocracia Zero

Portal web donde los clientes de la gestoría pueden **subir documentación** y
**consultar el estado de sus trámites** en tiempo real. Incluye un **panel para el
gestor** (administrador) para crear clientes y trámites, actualizar estados y
gestionar documentos.

Backend propio en **Node.js + Express** con base de datos **SQLite** (integrada en
Node, sin servidor de base de datos aparte ni dependencias nativas que compilar).

## Características

**Cliente**
- Acceso con email y contraseña.
- Ve sus trámites con estado actual e historial de actualizaciones.
- Sube uno o varios documentos (arrastrar y soltar), opcionalmente asociados a un trámite.
- Descarga sus documentos y los que le envía la gestoría.

**Gestor / administrador**
- Da de alta clientes y crea sus trámites.
- Actualiza el estado de cada trámite y añade notas que el cliente ve al instante.
- Sube documentos para el cliente (p. ej. resoluciones) y descarga los que sube el cliente.

**Estados de trámite:** Recibido · En proceso · Pendiente de documentación ·
Presentado ante la administración · Resuelto.

## Seguridad

- Contraseñas cifradas con **bcrypt**.
- Sesión mediante **JWT en cookie `httpOnly`** (`sameSite=lax`, `secure` en producción).
- Autorización por rol: cada cliente solo accede a **sus** trámites y documentos.
- Descargas resueltas por ID en base de datos (defensa frente a *path traversal*).
- Subidas validadas por **tipo MIME** y **tamaño** (máx. 15 MB), con límite de archivos.
- Cabeceras de seguridad y limitador básico de intentos de login.

## Puesta en marcha

Requiere **Node.js 22.5 o superior**.

```bash
cd portal
npm install
cp .env.example .env        # edita .env y define JWT_SECRET y ADMIN_PASSWORD

# Crea el administrador inicial (y, con --demo, un cliente de ejemplo):
npm run seed -- --demo

# Arranca el servidor:
npm start
# Portal disponible en http://localhost:3000
```

- Acceso de **gestor**: el email/clave definidos en `.env` (por defecto
  `admin@burocraciazero.es`). Tras iniciar sesión irás al panel de gestión.
- Acceso de **cliente de ejemplo** (si usaste `--demo`): `cliente@ejemplo.es` / `Cliente123`.

> Genera un `JWT_SECRET` seguro:
> `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## Estructura

```
portal/
├── server.js              # App Express, middleware y rutas
├── src/
│   ├── db.js              # Esquema SQLite (node:sqlite) y etiquetas de estado
│   ├── auth.js            # Hash de contraseñas, JWT y middlewares de rol
│   ├── upload.js          # Configuración de subida (multer)
│   ├── seed.js            # Crea admin y datos de ejemplo
│   └── routes/
│       ├── auth.js        # login, logout, sesión, cambio de contraseña
│       ├── client.js      # trámites y documentos del cliente
│       └── admin.js       # gestión de clientes, trámites y documentos
├── public/                # Frontend (login, portal cliente, panel gestor)
└── data/                  # (gitignored) base de datos y archivos subidos
```

## Datos y copias de seguridad

Todo se guarda en la carpeta `portal/data/` (excluida de git):
- `portal.db` — la base de datos.
- `uploads/` — los archivos subidos.

Para una copia de seguridad, basta con copiar la carpeta `data/`.

## Despliegue en producción

1. Define `NODE_ENV=production` y un `JWT_SECRET` robusto en el servidor.
2. Sirve detrás de un proxy inverso con **HTTPS** (nginx, Caddy…). Las cookies
   `secure` requieren HTTPS.
3. Usa un gestor de procesos (`pm2`, `systemd`) para mantenerlo en marcha.
4. Programa copias de seguridad de la carpeta `data/`.

### Integración con la web pública

Añade un enlace **“Acceso clientes”** en la web (carpeta `web/`) apuntando al dominio
o subdominio donde despliegues el portal, por ejemplo `https://portal.burocraciazero.es`
o `https://www.burocraciazero.es/portal`.
