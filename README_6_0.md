# Mi Filmoteca 6.0 — perfiles, estadísticas y comparaciones temporales

Esta actualización **no borra las películas ni cambia la configuración de Google, TMDB o Supabase**. Mantiene el sistema anterior y añade funciones nuevas.

## Qué incluye

- **Perfiles**: nombre visible, `@usuario` único, avatar emoji (no ocupa almacenamiento de imágenes), y un interruptor voluntario para que otros te encuentren.
- **Comparar con**: busca a una persona por su `@usuario` *exacto*, envíale una solicitud, y espera que la acepte. Cada comparación exige una solicitud nueva. La solicitud pendiente caduca a las 24 horas. Si se acepta, ambos participantes podrán consultar la **unión de sus películas vistas** durante **60 minutos como máximo**. La coincidencia se muestra en **verde**. Las películas vistas solo por uno aparecen sin destacar. Las películas «Por ver» nunca se revelan. Cualquiera puede finalizar la comparación y revocar el acceso de inmediato.
- **Estadísticas**: años en los que viste películas, géneros principales, casa/cine y vistas/pendientes.
- **Respaldos**: exporta a JSON o CSV las películas de **tu propia cuenta**; no exporta las de tus amigos ni las comparaciones.
- **PWA**: iconos optimizados y navegación móvil, con instrucciones de instalación para Android e iPhone.

## Orden de instalación — MUY IMPORTANTE

1. **Primero la BD:** abre Supabase → SQL Editor → New query y ejecuta **`supabase/upgrade_6_0.sql`**. Este archivo es una migración *aditiva* y conserva `filmoteca_movies`. No vuelvas a ejecutar `schema.sql` para esta actualización.
2. **Después publica el frontend:** actualiza los archivos `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `assets/` (incluidos 192, 180, 512 y maskable) en GitHub Pages. Si tienes un PR preparado, fusiona ese PR **solo después del SQL**. Conservar el `config.js` que ya contiene las claves públicas de tu Supabase; NO lo sobrescribas con el archivo de ejemplo de este ZIP.
3. Actualiza la página, preferentemente con `Ctrl + Shift + R`. Los archivos `sw.js` utilizan una versión nueva de caché para sustituir la app anterior.
4. Desde **Mi perfil**, crea un `@usuario` de 3–24 caracteres. Para recibir invitaciones activa «Permitir que me encuentren…». Cada amigo debe crear su propio perfil.
5. Desde **Comparar con amigos**, busca el `@usuario` exacto, envía la solicitud; el otro usuario la acepta en su cuenta (botón **Actualizar** o revisión automática cada ~30 segundos). Solo entonces pueden ver los resultados. Cerrar revoca el acceso.

## Privacidad y límites

- **RLS existente** en `filmoteca_movies` sigue haciendo que cada usuario lea y escriba sus propias películas; no lo cambies.
- `filmoteca_profiles` se consulta directamente solo por su propietario. La búsqueda exacta por `@usuario` expone exclusivamente nombre visible, avatar y username si `discoverable = true`.
- `filmoteca_comparisons` solo permite lectura de solicitudes propias. Ningún usuario puede insertar, aceptar, modificar o cerrar solicitudes alterando la tabla directamente: todas esas acciones pasan por funciones con validación del usuario autenticado.
- La única función de lectura entre cuentas comprueba en Postgres que quien la invoca sea participante, que el destinatario haya aceptado y que la autorización siga vigente. Las funciones privilegiadas viven en un esquema **no expuesto** al Data API. Las funciones públicas son invoker wrappers.
- La autorización temporal NO prohíbe que alguien guarde una captura de pantalla de lo que la otra persona consintió compartir. Es recomendable comparar solo con personas de confianza.
- Las solicitudes pendientes caducan en 24 h y los permisos aceptados duran como máximo 60 min. No hay permisos permanentes ni vínculos de amistad automáticos.
- El servidor incluye fechas y el indicador casa/cine en la comparación: **ambas personas deben saberlo antes de aceptar**.
- Las imágenes de las películas siguen viniendo de TMDB (resolución `w185`, `lazy loading`), no se guardan en la BD. Los avatares son emoji, no archivos.

## Pruebas que hay que realizar con dos cuentas reales

1. Inicia sesión con dos cuentas A y B. Ambas crean perfiles únicos y marcan «Permitir que me encuentren».
2. A registra una película vista en común y otra diferente; B hace lo mismo.
3. A busca a B por `@usuario`, envía una solicitud. Antes de que B acepte, A **no debe poder consultar** la historia de B.
4. B acepta. Ambos ven la unión de películas; la compartida aparece en verde y las demás neutras. Las pendientes NO aparecen.
5. B pulsa «Finalizar y revocar acceso». A ya no debe poder consultar el historial de B. Para comparar nuevamente A debe mandar **otra solicitud**.
6. Una cuenta C no involucrada jamás debe poder abrir un ID de solicitud ajeno ni consultar historiales ajenos.
7. Confirma que JSON y CSV solo incluyen la colección propia, y que Android/iPhone ofrecen «Añadir a pantalla de inicio».

**Estado:** el HTML/JS se ha probado con datos simulados en navegador de escritorio y vista móvil. El SQL y la seguridad entre dos cuentas todavía deben probarse en tu Supabase real, después de ejecutarlo. Por eso conviene instalarlo en SQL antes de activar la nueva interfaz en producción.