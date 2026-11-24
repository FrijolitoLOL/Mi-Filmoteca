# Mi Filmoteca 5.1 — web multiusuario + Google

Esta versión empieza vacía. Cada persona se registra con Google o con su propio correo y contraseña; sus películas quedan guardadas en **Supabase Postgres** y protegidas mediante **Row Level Security** (RLS). Incluye búsqueda automática en TMDB, pósters, género principal editable, año de estreno, fecha en que vio la película, filtros y dos casillas:

- **Por ver**: marcada = pendiente; desmarcada = vista.
- **Vista en casa**: marcada = vista en casa; desmarcada = vista en cine. Solo aplica a películas vistas.

**Los pósters NO se guardan en Supabase Storage ni en Postgres.** Solo se guarda `poster_path`, por ejemplo `/ejemplo123.jpg`, y el navegador carga el tamaño `w185` desde `image.tmdb.org`. Los títulos que no aparecen en TMDB también pueden añadirse manualmente, sin póster.

## Paso 1 — Crear el proyecto Supabase

1. Ve a <https://supabase.com/dashboard> e inicia sesión.
2. Crea un proyecto nuevo, con una contraseña robusta para la base de datos y la región que prefieras.
3. Abre **SQL Editor** y ejecuta **todo** el archivo `supabase/schema.sql`. Esto crea la tabla y sus políticas de privacidad. **No omitas este paso.**
4. En **Authentication → Providers → Email**, mantén habilitado el inicio de sesión por correo. Se recomienda **Confirm email** activado para que cada amigo verifique su dirección.
5. En **Project Settings → API Keys** (o **Connect**), ubica la **Project URL** y la **Publishable key** (`sb_publishable_...`). Si el proyecto sigue usando claves antiguas, también puede utilizarse la clave pública `anon`, nunca la `service_role`.

## Paso 2 — Configurar el frontend

Abre `config.js` con un editor de texto, y reemplaza:

```js
supabaseUrl: 'https://TU-PROYECTO.supabase.co',
supabasePublishableKey: 'sb_publishable_REEMPLAZAR',
```

por los datos **públicos** de tu proyecto. La clave `sb_publishable_...` puede estar en una web pública, siempre que RLS esté configurado correctamente. **Nunca incluyas** claves `sb_secret`, `service_role`, la contraseña de la base de datos, ni las claves privadas de TMDB en el código visible.

## Paso 3 — Configurar búsqueda de películas (TMDB)

Esta versión **NO** necesita que los amigos ingresen su propia clave TMDB. Una **Supabase Edge Function** consulta TMDB en nombre de los usuarios autenticados.

1. En TMDB, utiliza tu **API Read Access Token** (preferible) o tu **API Key (v3 auth)**.
2. En **Supabase → Edge Functions → Secrets**, añade **uno** de estos secretos:
   - `TMDB_READ_TOKEN` = el token de lectura de TMDB (habitualmente una cadena JWT larga), **o**
   - `TMDB_API_KEY` = tu clave v3 de TMDB.
3. Para desplegar la función de este paquete, instala Node.js e inicia una terminal dentro de esta carpeta. Ejecuta:

```bash
npx supabase@latest login
npx supabase@latest link --project-ref TU_PROJECT_REF
npx supabase@latest functions deploy tmdb-search --no-verify-jwt
```

**Nota de seguridad:** `--no-verify-jwt` deshabilita solo la validación automática de la puerta de enlace. Nuestra función **sí valida el token de cada petición** con `supabase.auth.getUser(token)` antes de llamar a TMDB. No la conviertas en una función que acepte consultas anónimas. Esta opción también es compatible con las claves públicas modernas `sb_publishable_...`.

`TU_PROJECT_REF` es el identificador que aparece en la URL de tu proyecto, por ejemplo `abcdefghijklmnop` en `https://abcdefghijklmnop.supabase.co`.

Para proyectos recientes, la función detecta la clave pública del entorno automáticamente; para instalaciones antiguas usa `SUPABASE_ANON_KEY`. Si ves un mensaje de configuración del servidor, revisa las variables en **Edge Functions → Secrets**.

## Paso 4 — Publicar gratis en GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo `mi-filmoteca`. Para usar GitHub Pages en una cuenta GitHub Free, lo más sencillo es que sea **público**. **El código público NO hace públicas las películas**, porque están en Supabase con RLS.
2. Sube el **contenido de esta carpeta** a la raíz del repositorio, especialmente `index.html`, `app.js`, `styles.css`, `config.js`, `manifest.webmanifest`, `sw.js` y `assets/`. Puedes subir también `supabase/`, `README.md` y el SQL porque **no contienen secretos**.
3. En el repositorio: **Settings → Pages → Build and deployment → Deploy from a branch**. Selecciona `main` y `/(root)` y guarda.
4. Tu web tendrá una dirección parecida a `https://USUARIO.github.io/mi-filmoteca/` (varía según tu repositorio).
5. En Supabase → **Authentication → URL Configuration**:
   - **Site URL**: la dirección exacta de GitHub Pages.
   - **Redirect URLs**: agrega esa misma dirección, por ejemplo `https://USUARIO.github.io/mi-filmoteca/**`, para confirmar correos y recuperar contraseñas.
6. Abre la URL, crea una cuenta, confirma el correo y empieza a registrar películas. Comparte la misma URL con tus amigos; cada uno crea su cuenta.

> GitHub Pages solo aloja los archivos estáticos. Supabase se encarga de las cuentas y los datos. Asegúrate de configurar RLS antes de compartir el sitio.

## Paso 5 — Tenerla como aplicación en el celular

Abre el sitio en tu teléfono. En Android/Chrome, usa el menú → **Instalar aplicación** o **Añadir a pantalla de inicio**. En iPhone/Safari, usa **Compartir → Añadir a pantalla de inicio**. La app incluye manifiesto e iconos, así que puede instalarse como acceso directo. Requiere internet para consultar/guardar datos y cargar pósters.

## Datos, espacio y privacidad

- Una película = una fila con texto, valores booleanos, fecha e identificador de usuario.
- Se almacena una **ruta corta de imagen**, no el archivo. `poster_path` ocupa típicamente decenas de bytes, frente a decenas o cientos de kilobytes de la imagen.
- La imagen se solicita desde TMDB en resolución reducida (ancho nominal **185 px**) y con `loading="lazy"`.
- La función de TMDB devuelve metadatos y rutas, no archivos de imagen.
- Cada usuario solo lee, inserta, edita y borra sus filas por las cuatro políticas RLS del SQL.
- Las credenciales de TMDB viven únicamente en Edge Function Secrets. Nunca deben copiarse a `config.js` o a un repositorio.
- La caché PWA solo guarda archivos **públicos** de la aplicación, nunca consultas de usuarios ni imágenes privadas.
- Un proyecto Supabase Free puede sufrir pausas por inactividad o límites del plan. Consulta los límites actuales en su panel.

## Comprobaciones recomendadas

1. Usuario A guarda una película. Se ve en su computadora y en su teléfono al entrar con el mismo correo.
2. Usuario B crea otra cuenta: no debe ver las películas de A.
3. Con usuario B intenta acceder a una película de A por su UUID usando la API: las políticas RLS deben devolver cero filas / rechazar la modificación.
4. Verifica que la respuesta de la tabla guarda `poster_path` y **no** datos base64.
5. Si falla la búsqueda, comprueba que `tmdb-search` está desplegada y que `TMDB_READ_TOKEN` o `TMDB_API_KEY` existe en Secrets.

### Limitaciones de esta primera versión

- No se ha conectado todavía a **tu** proyecto Supabase ni a tu repositorio. Debes realizar los pasos anteriores usando tus cuentas; el paquete está listo para configurar, no está publicado.
- Requiere conexión para guardar cambios. No implementa edición sin internet ni sincronización offline.
- Un título de TMDB se guarda una vez por usuario; editarlo cambia su estado o fecha.
- Las películas se pueden agregar manualmente, pero no admiten carga de pósters propios en esta versión (para evitar almacenamiento de imágenes).
- La aplicación no permite que un usuario vea la colección de otro: es privada por diseño. Compartir la URL permite que cada quien cree su propia cuenta.

**Atribución TMDB:** El pie de página muestra un logotipo aprobado de TMDB desde su sitio oficial. Si el servicio bloquea esa imagen, descarga un logotipo aprobado desde <https://www.themoviedb.org/about/logos-attribution> y úsalo sin modificar en el pie de página.  This product uses the TMDB API but is not endorsed or certified by TMDB. Consulta las reglas y logos en <https://www.themoviedb.org/about/logos-attribution>.

## Iniciar sesión con Google (incluido en esta versión 5.1)

En **Supabase → Authentication → Sign In / Providers → Google**, activa Google y configura **Client ID**, **Client Secret** y el callback `https://TU-PROYECTO.supabase.co/auth/v1/callback` en los **Authorized redirect URIs** del cliente OAuth web de Google. **No copies el Client Secret a `config.js` ni a GitHub.**

En **Supabase → Authentication → URL Configuration**, configura como **Site URL** la URL exacta pública de tu sitio de GitHub Pages (`https://USUARIO.github.io/mi-filmoteca/`) y añádela también a **Redirect URLs** (preferible URL exacta para producción). La URL del sitio web *no* sustituye el callback de Google; son dos URLs diferentes.

El botón «Continuar con Google» incluido en `index.html` inicia el flujo con `signInWithOAuth({provider:'google', options:{redirectTo:location.origin+location.pathname}})`. Supabase devuelve al usuario a la misma web después de iniciar sesión. Si Google OAuth sigue en estado **Testing**, añade cuentas en Google Auth Platform → Audience → Test users; para compartirlo con otros usuarios, revisa la publicación de la aplicación en Google.

Primero configura `config.js` con **Project URL** y **Publishable key** de Supabase. Nunca publiques `sb_secret`, `service_role`, `TMDB_READ_TOKEN` ni `Client Secret`.
