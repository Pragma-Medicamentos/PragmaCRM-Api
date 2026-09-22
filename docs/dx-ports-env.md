# Mapa de puertos y variables — desarrollo local

Org: `Pragma-Medicamentos` · Repos: `PragmaCRM-Api` / `PragmaCRM-Web` / `PragmaCRM-Mobile`

Identidad: **Supabase Auth** (OTP por correo). Ver CLAUDE.md 5.9 — no hay Clerk ni variables de Clerk en este stack.
Gate de transporte: header **`x-api-key`** (mismo valor en Api/Web/Mobile). Exento: `/api/health`.

## Proceso ↔ puerto

| Proceso               | Puerto    | Notas                                              |
| ---------------------- | --------- | --------------------------------------------------- |
| Api HTTP               | **3000**  | env `PORT`                                           |
| Supabase API            | **54321** | `SUPABASE_URL` / `VITE_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_URL` |
| Postgres (Supabase)     | **54322** | `DATABASE_URL`                                       |
| Supabase Studio         | **54323** | UI local                                             |
| Supabase Mail (Inbucket)| **54324** | OTP dry-run / correo de prueba                       |
| Web (Vite)              | **5173**  | default; `CORS_ORIGIN` suele apuntar aca             |
| Mobile (Metro/Expo)     | **8081**  | default, sin pin fijo                                |

Arranque tipico: `npx supabase start` (en este repo, Api) → Api en 3000 → Web `vite` en 5173 → Mobile `expo start`.

Con un solo comando: `npm run dev-up` (ver README, seccion "Puesta en marcha").

## Api — variables (`.env`, ver `.env.template`)

| Variable                     | Rol                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `STAGE`                       | `dev` \| `staging` \| `prod` — logica de aplicacion                  |
| `NODE_ENV`                    | ecosistema Node/Express (`development` local; `production` en todo remoto — nunca `staging`) |
| `PORT`                        | puerto de escucha HTTP                                                |
| `DATABASE_URL`                | conexion a Postgres (Supabase)                                        |
| `LOG_LEVEL`                   | nivel de pino                                                         |
| `UPLOAD_MAX_FILE_SIZE_MB`     | techo del JSON de ventas subido manualmente (RF-03)                   |
| `SUPABASE_URL`                | issuer / JWKS de Supabase Auth                                        |
| `SUPABASE_SERVICE_ROLE_KEY`   | bypassea RLS — **solo servidor**, nunca en Web ni APK                 |
| `CORS_ORIGIN`                 | origenes permitidos para el dashboard web (separados por coma)        |
| `API_KEY`                     | valor esperado en el header `x-api-key` de toda ruta salvo `/api/health` |

No hay variables `OTP_*` propias: el largo y la expiracion del codigo los define `supabase/config.toml`.

## Web — `VITE_*`

| Variable                       | Rol                          |
| -------------------------------- | ------------------------------ |
| `VITE_SUPABASE_URL`              | Supabase Auth desde el navegador |
| `VITE_SUPABASE_ANON_KEY`         | anon key                       |
| `VITE_API_URL`                   | base de esta Api (sin `/` final) |
| `VITE_API_KEY`                   | valor enviado en `x-api-key`    |
| `VITE_UPLOAD_MAX_FILE_SIZE_MB`   | espejo del limite de subida (opcional) |

## Mobile — `EXPO_PUBLIC_*`

| Variable                              | Rol                        |
| --------------------------------------- | ---------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`              | Supabase Auth                |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`  | publishable key (nunca service_role) |
| `EXPO_PUBLIC_API_URL`                   | base de esta Api             |
| `EXPO_PUBLIC_API_KEY`                   | valor enviado en `x-api-key` |

## Claves y convenciones

| Clave                                                    | Donde vive                                    |
| ----------------------------------------------------------- | ------------------------------------------------ |
| Header `x-api-key`                                          | middleware de esta Api + cliente HTTP de Web/Mobile |
| `API_KEY` = `VITE_API_KEY` = `EXPO_PUBLIC_API_KEY`           | mismo valor en local                              |
| `SUPABASE_SERVICE_ROLE_KEY`                                  | **solo en esta Api**                              |
| Anon key (Web) / publishable key (Mobile)                    | nunca en el backend, nunca es `SERVICE_ROLE_KEY`  |

Fuente de verdad de las variables de este repo: `.env.template` y `src/config/envs.ts`. Web y Mobile
mantienen su propio `.env.example` en sus repos respectivos — ante cualquier duda, ese archivo manda
sobre este doc.
