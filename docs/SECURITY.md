# Seguridad del backend — auditoría PCRM-138

**Fecha:** 26 de octubre de 2026 · **Rama:** `security/pcrm-138-check-security` · **Responsables:** Bryan, Jimmy

Revisión previa a la integración y el despliegue. Cubre guards por endpoint, validación de entrada, RLS, secretos y mensajes de error. Se verificó contra el código y contra los dos proyectos remotos de Supabase (`[PROD] Pragma CRM` y `[TEST] PragmaCRM`), cuyas políticas y grants eran idénticos.

## Resumen

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| 1 | Un Vendedor podía escribir `visit` y leer toda `customer` por la Data API de Supabase | **Crítica** | Corregido |
| 2 | Sin rate limit en `/api/v1/auth/{otp,login,refresh}` | Alta | Corregido |
| 3 | `multer` 2.0–2.4 con DoS conocido (GHSA-q7qp-rjg7-q26m), en la ruta de subida | Alta | Corregido (2.5.0) |
| 4 | Sin cabeceras defensivas; `X-Powered-By: Express` | Baja | Corregido |
| 5 | Funciones `SECURITY DEFINER` con `EXECUTE` para `anon` | Baja | Corregido |
| 6 | `POST /auth/otp` permite enumerar cuentas | Media | **Postergado** |
| 7 | Protección contra contraseñas filtradas apagada en Supabase Auth | Baja | **Postergado** |
| 8 | `public.normalize_name` con `search_path` mutable | Baja | **Postergado** |
| 9 | Refresh token sin `timebox` en GoTrue | Baja | **Postergado** |
| 10 | Mensajes y comentarios en español en `src/` | Convención | **Postergado** |

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

## 2. Rate limit en la auth pública

Todo login llega a GoTrue desde la IP del servidor, así que los límites por IP de Supabase no distinguen a un atacante del resto del equipo: alguien probando contraseñas agotaba la cuota de todos. `/otp` además envía un correo por llamada.

`src/presentation/middleware/rateLimit.ts` (`express-rate-limit`, store en memoria) aplica, por IP del cliente (`trust proxy 1`, Traefik):

| Ruta | Límite |
|---|---|
| `POST /api/v1/auth/otp` | 5 / 15 min |
| `POST /api/v1/auth/login` | 10 / 15 min |
| `POST /api/v1/auth/refresh` | 60 / 15 min |

Al excederse responde **429** con el envelope `ApiResponse` y `RateLimit-*` / `Retry-After`. Si algún día hay más de una instancia, se necesita un store compartido.

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

Opcional, como segunda capa: apagar la Data API en el dashboard (Settings → API). No afecta a Supabase Auth.
