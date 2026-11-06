# Seguridad del backend — auditoría PCRM-138

**Fecha:** 26 de octubre de 2026 · **Rama:** `security/pcrm-138-check-security` · **Responsables:** Bryan, Jimmy

Revisión previa a la integración y el despliegue. Cubre guards por endpoint, validación de entrada, RLS, secretos y mensajes de error. Se verificó contra el código y contra los dos proyectos remotos de Supabase (`[PROD] Pragma CRM` y `[TEST] PragmaCRM`), cuyas políticas y grants eran idénticos.

## Resumen

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| 1 | Un Vendedor podía escribir `visit` y leer toda `customer` por la Data API de Supabase | **Crítica** | Corregido |
| 2 | Sin rate limit en ningún endpoint, incluida la auth pública | Alta | Corregido |
| 3 | `multer` 2.0–2.4 con DoS conocido (GHSA-q7qp-rjg7-q26m), en la ruta de subida | Alta | Corregido (2.5.0) |
| 4 | Sin cabeceras defensivas; `X-Powered-By: Express` | Baja | Corregido |
| 5 | Funciones `SECURITY DEFINER` con `EXECUTE` para `anon` | Baja | Corregido |
| 6 | `POST /auth/otp` permite enumerar cuentas | Media | **Postergado** |
| 7 | Protección contra contraseñas filtradas apagada en Supabase Auth | Baja | **Postergado** |
| 8 | `public.normalize_name` con `search_path` mutable | Baja | **Postergado** |
| 9 | Refresh token sin `timebox` en GoTrue | Baja | **Postergado** |
| 10 | Mensajes y comentarios en español en `src/` | Convención | **Postergado** |
| 11 | `/api/health` sin rate limit y sin protección DDoS en el borde | Baja | **Postergado** ([PCRM-207](https://catolica-team-zgozl0ds.atlassian.net/browse/PCRM-207)) |

## 1. Escritura directa de `visit` y lectura de `customer` (crítica)

**Qué pasaba.** La Data API (PostgREST) está habilitada y expone `public`. `anon` no tenía privilegios, pero `authenticated` tenía `INSERT/SELECT/UPDATE` sobre `visit`, `prospect` y `customer`, y `SELECT` sobre `sale`, `goal`, `route*` y `app_user`. Con el JWT de su sesión y la publishable key que viaja en el APK, un Vendedor podía:

- `POST /rest/v1/visit` con `user_id` propio y cualquier `distance_meters` / `checkin_location`. La política `visit_insert` solo exige `user_id = current_app_user_id()`. La validación de 80 m (RF-06) solo corre en `confirmVisit`, dentro de la API, así que se podía saltar por completo.
- `PATCH /rest/v1/visit?id=eq.…` para corregir una visita marcada fuera de rango.
- `GET /rest/v1/customer?select=*`: crédito, límite, personalidad y NRC/NIT/correo de toda la cartera (`customer_select USING (true)`), datos que la API reserva al Administrador.

**Por qué se cierra en vez de corregir las políticas.** Ningún cliente usa ese camino. La web (`PragmaCRM-Web`, ramas `dev`, `staging` y la de reportes) y la app (`PragmaCRM-Mobile`, `prod`, `staging` y `dev` al 24/10) usan `supabase-js` solo para Auth. Todo dato va por la API, que corre como `postgres`.

**Corrección.** Migración `20261026173955_revoke_data_api_table_access.sql`:
- Revoca todo privilegio de `anon` y `authenticated` sobre tablas y secuencias de `public`, también en los default privileges de `postgres`.
- Elimina las 16 políticas de `20260912042029_rls_policies_and_grants.sql` (`app_user`, `visit`, `prospect`, `sale`, `goal`, `route_user`, `customer`, `route`, `route_customer`).
- RLS sigue habilitado en las 17 tablas; `FORCE RLS` sigue apagado. `app_auth.*` se conserva, sin uso, como base de una política futura.

**Por qué las dos cosas.** Una tabla con RLS habilitado y sin políticas ya es deny-all: ese era el caso de `scheduled_visit`, `upload`, `sale_staging`, etc., que estaban bien. Sin políticas, las 17 quedan así, y un GRANT agregado por error en una migración futura no abre nada. Sin GRANT, el error es `42501 permission denied` en lugar de cero filas, que es más fácil de diagnosticar.

**Reabrir el camino directo** para una tabla exige un GRANT y una política nueva, revisada contra las validaciones de la API. Es decisión de equipo (CLAUDE.md 5.9).

## 2. Rate limit

`src/presentation/middleware/rateLimit.ts` usa `express-rate-limit` (MIT) con store en memoria, porque la API corre como una sola instancia; con dos haría falta un store compartido. La IP del cliente sale de `trust proxy 1` (Traefik). Al excederse responde **429** con el envelope `ApiResponse` y `RateLimit-*` / `Retry-After`.

| Limitador | Alcance | Clave | Límite | Dónde se monta |
|---|---|---|---|---|
| `api.global` | Todo `/api/v1/*` (no `/api/health`) | IP | 1200 / 1 min | `presentation/routes.ts`, antes de `requireApiKey` |
| `api.reports` | `/api/v1/reports/*` | Usuario | 30 / 5 min | `presentation/routes.ts`, tras `requireRole` |
| `api.uploads` | `POST /api/v1/uploads/sales` | Usuario | 10 / 15 min | `uploads/routes.ts`, antes de multer |
| `auth.otp` | `POST /api/v1/auth/otp` | IP | 5 / 15 min | `auth/routes.ts` |
| `auth.login` | `POST /api/v1/auth/login` | IP | 10 / 15 min | `auth/routes.ts` |
| `auth.refresh` | `POST /api/v1/auth/refresh` | IP | 60 / 15 min | `auth/routes.ts` |

**Auth.** Todo login llega a GoTrue desde la IP del servidor, así que los límites por IP de Supabase no distinguen a un atacante del resto del equipo: alguien probando contraseñas agotaba la cuota de todos. `/otp` además envía un correo por llamada.

**Cómo se dimensionó el resto.** Con el uso real de los clientes, medido el 26/10 en `PragmaCRM-Web` (`feat/pcrm-159-frontend-for-reports`) y `PragmaCRM-Mobile` (`origin/prod`). **Ninguno cachea**: cada recarga, pestaña o filtro repite todas las llamadas de la pantalla.

- **Web, peor ráfaga.** El planificador `/rutas` hace 9 + N llamadas (N = rutas activas, una por ruta en `useRoutePlanner.ts`) al cargar y en **cada** arrastre de asignación. También al refrescar el token, más o menos cada hora, porque `useCurrentAppUser` desmonta la página. Con N = 50 y un arrastre cada 3 s son unas 1200 por minuto: es el techo del `global`.
- **Web, resto.** `/metricas` con comparación son 7 llamadas por cambio de periodo, y `/clientes` unas 4. El único polling es `GET /uploads/sales/in-progress` cada 15 s durante una importación, y por eso `api.uploads` solo cubre el POST. No hay reintentos automáticos y la web no llama a `/auth/refresh`.
- **Móvil.** Sin polling ni cola offline, y el GPS no llega a la API. Login y refresh van directo a Supabase. Uso intenso: 30–60 llamadas cada 15 min, con picos de unas 6 por segundo.
- **Por IP vs. por usuario.** El `global` va por IP porque corre antes de autenticar y toda la oficina puede compartir una IP; por eso es holgado. `reports` y `uploads` van por usuario (`req.authUser.id`): son los endpoints que consumen CPU y memoria, y dos personas detrás del mismo wifi no comparten cupo.

**Ajuste.** Cada 429 deja un `logger.warn('Rate limit exceeded')` con `limiter`, ruta y `user_id`. Si aparece con usuarios reales, se sube el número en `API_RATE_LIMITS`; si nunca aparece, el número está bien.

**Recomendaciones al frontend web** (fuera de este ticket):
- El planificador debería pedir las asignaciones en una sola llamada, no una por ruta.
- `useCurrentAppUser` no debería desmontar la página en cada refresh de token.

## 3–5. Dependencias, cabeceras, funciones

- `npm audit fix`: multer 2.5.0, y se cerraron también las alertas transitivas de `prisma` (mysql2, deepmerge-ts, fast-uri). `npm audit` queda en 0.
- `server.ts`: `app.disable('x-powered-by')` y `helmet()` (nosniff, HSTS, frame-ancestors, CORP…).
- `rls_auto_enable()` y `sync_password_set_at()`: sin `EXECUTE` para `PUBLIC`/`anon`/`authenticated`. Son funciones de trigger y no se podían invocar por `/rpc`; esto es higiene, y es lo que pide el advisor.

## Lo que se revisó y está bien

- **Guards.** Todo `/api/v1/*` exige `x-api-key`. Cada grupo monta `requireAuth` + `requireRole` en `presentation/routes.ts`. Excepciones deliberadas: `/api/health` (pública), `/api/v1/auth/*` (login) y `/api/v1/me` (sin rol: es como el cliente descubre el suyo). `prospects` aplica el rol por verbo. Los services del Vendedor verifican que la parada sea suya (`stop.route_user.user_id !== sellerId` → 403).
- **Validación.** Zod en body, query y params. La carga de Efactsoft es multipart, solo para Admin, autenticada antes de multer, con límite de tamaño y extensión, y validada venta por venta. El SQL crudo usa parámetros. `Prisma.raw` solo recibe constantes o enums de Zod.
- **Errores.** `handleError` traduce errores conocidos y todo lo demás es `500 Internal server error`, sin detalles. Los 500 se loguean del lado del servidor.
- **Secretos.** `.env` y `.env.test` nunca se commitearon. La `service_role` solo vive en el servidor. La imagen corre sin root y no copia `.env`. El signup público de Supabase está cerrado (`enable_signup = false`).
- **`x-api-key` no es un secreto.** Viaja en el bundle web y en el APK. No autentica a nadie, pero cumple una función: al ser un header custom, fuerza el preflight de CORS, y eso es lo que impide CSRF con las cookies `SameSite=None` del dashboard. **No quitarlo sin poner otra defensa CSRF.**

## Postergados

6. **Enumeración en `POST /api/v1/auth/otp`.** Responde 404 (sin cuenta activa), 409 (sin acceso configurado) o 200. Unificar a un 200 genérico no rompe ni la web ni la app (la app ni siquiera usa esta ruta), solo pierde el aviso de "correo no registrado". El rate limit frena la enumeración masiva. Decisión del equipo: postergado.
7. **Contraseñas filtradas.** Activar *Leaked password protection* en Supabase Auth (dashboard, sin costo).
8. **`normalize_name`.** Fijar `search_path`; usa `unaccent`, así que hay que calificarlo con su schema.
9. **Sesiones.** GoTrue no expira refresh tokens sin `[auth.sessions].timebox`. Hoy el único límite es la cookie de 30 días del navegador.
10. **Idioma.** `middleware/auth.ts`, `request-login-otp.use-case.ts` y `presentation/routes.ts` conservan mensajes o comentarios en español (CLAUDE.md 11). Cambiar los mensajes afecta lo que muestra la web.
11. **`/api/health` y DDoS** ([PCRM-207](https://catolica-team-zgozl0ds.atlassian.net/browse/PCRM-207)). Health se monta antes del límite global, así que no tiene límite ni suma en el cupo de la IP. No toca la base, y un 429 cuesta lo mismo que un 200, pero limitarlo mal tumba la API: el `HEALTHCHECK` del `Dockerfile` lo consulta cada 30 s por loopback y, si falla, el contenedor queda `unhealthy`. Propuesta: 60/min por IP que también cuente en el global, excluyendo el loopback por `req.socket.remoteAddress`. Contra un DDoS no sirve ningún límite en la app, y esto va en el despliegue:
    - Cloudflare Free delante del dominio.
    - `rateLimit` por IP en Traefik.
    - Rotación de logs de Docker (`max-size` / `max-file`): `requestMetadata` loguea cada petición y un flood puede llenar el disco del VPS.

Opcional, como segunda capa: apagar la Data API en el dashboard (Settings → API). No afecta a Supabase Auth.
