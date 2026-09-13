# PragmaCRM API

API REST del CRM de Pragma Medicamentos. Node.js + TypeScript + Express, con PostgreSQL vía
Supabase y Prisma como cliente de acceso a datos.

## Requisitos

- Node.js 20+ (desarrollado con 24)
- **Docker Desktop corriendo** — la base de datos local vive en contenedores
- Supabase CLI — no hace falta instalarla globalmente, se usa vía `npx`

## Puesta en marcha

```bash
# 1. Variables de entorno
cp .env.template .env

# 2. Dependencias
npm install

# 3. Base de datos local (Postgres en el puerto 54322)
npx supabase start

# 4. Cliente de Prisma
npx prisma generate

# 5. Servidor de desarrollo
npm run dev
```

Comprobación rápida:

```bash
curl http://localhost:3000/api/health
# {"success":true,"message":"API is healthy","data":{"uptime":1.2,"version":"1.0.0"}}
```

> La primera vez, `npx supabase start` descarga varias imágenes de Docker y puede tardar unos
> minutos. Si falla con `failed to connect to the docker API`, Docker Desktop no está arriba.

## Scripts

| Script                     | Qué hace                                    |
| -------------------------- | ------------------------------------------- |
| `npm run dev`              | Servidor con hot-reload                     |

| `npm run build`            | Compila a `dist/`                           |
| `npm run start`            | Build + ejecuta el compilado                |
| `npm run lint`             | ESLint sobre `src/`                         |
| `npm run tsc`              | Type-check sin emitir                       |
| `npm run test`             | Tests unitarios                             |
| `npm run test:integration` | Tests de integración (requiere `.env.test`) |

## Base de datos

Todo el desarrollo se hace contra una **base de datos local en Docker**, nunca contra la nube. La
CLI de Supabase la levanta y le aplica las migraciones del repo; Prisma solo la consulta.

Nada de lo que hagas en local toca staging ni producción: esos entornos los actualiza únicamente
GitHub Actions al mergear (ver [docs/CI_CD.md](./docs/CI_CD.md)).

### Dos grupos de comandos

Toda la CLI de Supabase se divide en dos: lo que corre contra tu Docker y lo que necesita un
proyecto remoto vinculado con `supabase link`.

| Grupo                                  | Qué toca                     | Quién lo usa                                          |
| -------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| **Local** (todo lo de esta sección)     | Solo tu Postgres en Docker   | Cualquier dev, sin permisos ni credenciales, cuando quiera |
| **Vinculado** (`--linked`, `db push`…) | Testing o Producción en la nube | Nadie a mano — lo hace GitHub Actions. Ver [más abajo](#comandos-que-requieren-supabase-link) |

Los comandos locales son **libres y sin riesgo**: lo peor que puede pasar es que borres tus propios
datos de prueba. Ninguno pide login ni token.

Regla práctica: si un comando lleva `--local`, o si no lleva ninguna bandera de destino, es del
primer grupo. Si lleva `--linked`, `--project-ref` o `--db-url`, es del segundo.

### Levantar y apagar la base de datos

```bash
npx supabase start    # Levanta Postgres + Studio y aplica todas las migraciones
npx supabase stop     # Apaga los contenedores (los datos se conservan)
npx supabase status   # Muestra URLs, puertos y llaves del stack local
```

`start` aplica automáticamente todo lo que haya en `supabase/migrations/`, así que al terminar ya
tienes el esquema completo del CRM.

### Conectarse

| Cómo                    | Dónde                                                        |
| ----------------------- | ------------------------------------------------------------ |
| Desde la API (Prisma)   | `DATABASE_URL` del `.env` — ya viene configurada              |
| Studio (UI web)         | <http://127.0.0.1:54323>                                      |
| Cliente SQL (DBeaver…)  | host `127.0.0.1`, puerto `54322`, db `postgres`, user/pass `postgres` |

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Consulta rápida sin salir de la terminal:

```bash
npx supabase db query "select count(*) from app_user;" --local
```

### Crear una migración nueva

El esquema es propiedad del SQL versionado, **no de Prisma**: no se edita `schema.prisma` a mano ni
existe `prisma migrate` en este proyecto. El ciclo completo es:

```bash
# 1. Crear el archivo (queda en supabase/migrations/<timestamp>_agregar_tabla_x.sql)
npx supabase migration new agregar_tabla_x

# 2. Escribir el SQL en ese archivo (CREATE TABLE, ALTER, índices, políticas RLS…)

# 3. Aplicarlo reconstruyendo la DB desde cero
npx supabase db reset --no-seed

# 4. Reflejar el nuevo esquema en Prisma
npx prisma db pull
npx prisma generate
```

Los pasos 3 y 4 son los que hacen que el cambio exista para el código: sin ellos, el cliente de
Prisma sigue tipado contra el esquema anterior y TypeScript no verá las tablas o columnas nuevas.

> **`db reset` borra los datos locales.** Reconstruye la base desde cero y reaplica todas las
> migraciones en orden — que es justo lo que valida que tu migración funcione en una DB limpia,
> igual que hará CI. Si necesitas datos de prueba, recárgalos después.

### Después de un `git pull`

Si alguien más agregó migraciones, ponte al día con:

```bash
npx supabase db reset --no-seed
npx prisma generate
```

### Comandos de apoyo

Todos llevan destino explícito: **`--local` apunta a tu Docker**. Sin esa bandera, `migration list` y
`db lint` intentan hablar con el proyecto remoto vinculado y fallan si no hay `link`.

| Comando                                 | Qué hace                                                          |
| --------------------------------------- | ----------------------------------------------------------------- |
| `npx supabase migration list --local`   | Historial de migraciones y cuáles están aplicadas en local         |
| `npx supabase db lint --local`          | Busca errores de tipado en la base local                           |
| `npx supabase db diff`                  | Cambios hechos en la DB local que aún no están en una migración (`--local` es el default) |

### Comandos que requieren `supabase link`

**No los necesitas para trabajar.** Se listan para que quede claro qué queda fuera del día a día y
por qué. Vincular el repo a un proyecto de la nube (`npx supabase link --project-ref <id>`, previo
`npx supabase login`) es un paso de mantenimiento, no de onboarding.

| Comando                                | Qué hace                                              | Quién lo corre                          |
| -------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| `supabase login` / `link`              | Autentica la CLI y vincula el repo a un proyecto remoto | Solo quien mantiene la base (DBA)       |
| `supabase db push`                     | Aplica migraciones a un entorno remoto                 | **Nadie a mano.** Lo hace GitHub Actions |
| `supabase db pull`                     | Trae el esquema del remoto y lo escribe como migración | Solo para generar un baseline           |
| `supabase migration list --linked`     | Compara el historial local contra el del remoto        | Diagnóstico de drift                    |
| `supabase migration repair`            | Reescribe el historial de migraciones del remoto       | Último recurso, con el equipo enterado  |

> **`supabase db pull` ≠ `npx prisma db pull`.** El de Supabase lee un proyecto *remoto* y genera SQL
> de migración; el de Prisma lee tu *base local* (`DATABASE_URL`) y regenera `schema.prisma`. El que
> usas a diario es el de Prisma.

Por qué `db push` está vedado en local: dos personas aplicando migraciones a mano desde sus laptops
desincronizan el historial del remoto. El merge es el único disparador —
ver [docs/CI_CD.md](./docs/CI_CD.md).
## Autenticación

**Supabase Auth** es el proveedor de identidad. La API no guarda contraseñas: recibe el token que
emite Supabase, verifica su firma y resuelve el rol contra `app_user.auth_user_id`.

Hay **dos caminos** hacia los datos, y conviene tenerlos claros:

| Camino | Quién decide | Cuándo |
|---|---|---|
| Cliente → Supabase (`supabase-js`) | **Las políticas RLS** | La mayoría de las consultas de web y móvil |
| Cliente → esta API | **`requireAuth` / `requireRole`** | Import del ERP, alta de vendedores, `/me` |

La API se conecta como rol `postgres`, que **ignora RLS**. Es decir: en el camino de la API no hay
una segunda línea de defensa detrás del middleware. Un grupo de rutas montado sin `requireAuth`
queda público. Hoy la única ruta pública es `/api/health`.

Para levantar la API hacen falta `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Sin ellas el arranque
falla — ver `.env.template`.

> La `service_role` key es un **bypass total de RLS usable por HTTP desde cualquier parte**.
> Filtrarla es peor que filtrar la `DATABASE_URL`. Solo servidor: nunca en el bundle web ni en el APK.

### Cómo llama un cliente

El token va en el header `Authorization`. En web y móvil lo da el SDK de Supabase
(`supabase.auth.getSession()`); para probar a mano:

```bash
TOKEN=$(curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"admin@pragma.test","password":"..."}' | jq -r .access_token)

curl http://localhost:3000/api/v1/me -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "message": "Sesión válida",
  "data": {
    "id": "…uuid de app_user…",
    "authUserId": "…uuid de auth.users…",
    "role": "Administrador",
    "name": "…",
    "email": "…"
  }
}
```

`/api/v1/me` es como web y móvil resuelven su estado inicial. Importa más que antes: **el rol no
viaja en el token**, vive en `app_user`, así que este endpoint es el único lugar donde un cliente
descubre su rol y se entera de que está deshabilitado.

### Cómo se protege un endpoint

Los guards se aplican **por grupo de rutas** en `src/presentation/routes.ts`:

```ts
router.use('/api/v1/goals', requireAuth, requireRole(ROLES.ADMIN), GoalsRoutes.routes);
```

- `requireAuth` — verifica el JWT contra el JWKS del proyecto y deja el usuario en `req.authUser`.
- `requireRole(...roles)` — se encadena **después** de `requireAuth`.

En rutas con subida de archivos, los guards van **en `routes.ts`, no dentro del módulo**: así una
petición anónima se rechaza antes de bufferizar el archivo entero en memoria.

### Códigos de respuesta

| Situación                                              | Código |
| ------------------------------------------------------ | ------ |
| Sin token, expirado, firma inválida, o emitido por otro proyecto | 401 |
| Token válido, `auth_user_id` sin registro en `app_user` | 403    |
| Usuario con `active = false` o borrado (`deleted_at`)   | 403    |
| `app_user.role` fuera de `Administrador` / `Vendedor`   | 403    |
| Rol válido pero sin permiso sobre el endpoint           | 403    |
| El JWKS de Supabase no responde                         | 503    |

**401 se resuelve volviendo a iniciar sesión; 403 no** — es aprovisionamiento. El **503** es
deliberado: si el JWKS no responde, el token podría ser perfecto, y mandar a todos al login por un
problema de red sería peor.

### Alta de un vendedor

`POST /api/v1/sellers` crea la cuenta en Supabase Auth y el perfil en `app_user` en ese orden, así
que `auth_user_id` queda enlazado desde el primer momento — no hay paso manual ni webhook.

La respuesta incluye `inviteLink` **una sola vez**. No se envía correo —así que no hace falta SMTP—:
el administrador se lo pasa al vendedor por el canal que ya use. Caduca a las **24 horas**
(`otp_expiry` en `config.toml`) y no se guarda en ninguna parte.

**No hay contraseña temporal.** La cuenta nace sin contraseña: no hay nada que comunicar aparte del
enlace, ni ningún estado de "debe cambiarla" que gestionar. Supabase no tiene un campo
`must_change_password` y aquí no hace falta, porque el estado es observable en `auth.users`:
`encrypted_password` vacío, `invited_at` con fecha y `last_sign_in_at` en null.

El flujo que **el frontend web tiene que implementar**:

1. El vendedor abre el `inviteLink`. Supabase valida el token y redirige a `SELLER_INVITE_REDIRECT_URL`
   con la sesión en el fragmento de la URL.
2. Esa ruta del dashboard le pide una contraseña y la fija con `supabase.auth.updateUser({ password })`.
3. A partir de ahí entra normal con `signInWithPassword`.

`SELLER_INVITE_REDIRECT_URL` debe apuntar **al dashboard web**, no a esta API. Si se deja sin
definir, Supabase usa `site_url` —que es la API— y el vendedor aterriza en un 404.

Si el enlace caduca sin usarse, el vendedor queda sin contraseña y no puede entrar: hay que generarle
uno nuevo. Hoy eso se hace volviendo a invitarlo desde el dashboard de Supabase.

Deshabilitar a un vendedor (`PATCH /:id/active`) lo corta por los dos caminos: la API responde 403,
las políticas RLS dejan de devolverle filas, y además se banea su cuenta para que la sesión viva
muera en vez de durar hasta que expire el token.

## Estructura

```
src/
  app.ts              entry point
  config/             carga y validación de variables de entorno
  domain/             errores, interfaces, esquemas Zod y tipos
  lib/                helpers transversales (prisma, logger, manejo de errores)
  presentation/       Express: server, rutas, controladores, middlewares
  services/           lógica de negocio
  use-cases/          orquestación de varios services
prisma/               esquema de Prisma (generado con db pull)
supabase/migrations/  migraciones SQL — fuente de verdad del esquema
```

Convenciones detalladas en [CLAUDE.md](./CLAUDE.md).

## Carga de archivos (RF-03)

`POST /api/v1/uploads/sales` recibe el JSON exportado del ERP como
`multipart/form-data`, en el campo `file`. El tamaño máximo lo fija
`UPLOAD_MAX_FILE_SIZE_MB` (100 por defecto).

> **Al desplegar detrás de nginx hay que subir `client_max_body_size` al mismo
> valor.** Por defecto nginx corta en **1 MB** y responde un 413 en HTML antes
> de que la petición llegue a la API — con esa configuración ni siquiera un
> export mensual de 5 MB pasaría, y el dashboard no podría mostrar el mensaje
> de error real.

```nginx
client_max_body_size 100m;
```

## Despliegue de migraciones

Las migraciones **nunca se aplican a mano** contra un entorno remoto: las aplica GitHub Actions al
mergear a `staging` o `prod`. El flujo de ramas es `feat/* → dev → staging → prod`.

Ver [docs/CI_CD.md](./docs/CI_CD.md).

## Docker

```bash
docker build -t pragmacrm-api .
docker run --rm -p 3000:3000 --env-file .env pragmacrm-api
```
