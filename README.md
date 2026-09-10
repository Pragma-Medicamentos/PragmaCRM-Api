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
| `npm run dev:token`        | Emite un token de Clerk para probar con curl |
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

Clerk es el proveedor de identidad; la API solo **verifica** el token que emite y resuelve el rol
contra la base. No hay contraseñas ni sesiones propias.

Web y móvil **no consultan Supabase directamente**: todo pasa por esta API. Por lo tanto el control
de acceso del sistema es el middleware de aquí abajo — no hay políticas RLS respaldándolo. Un
endpoint montado sin `requireAuth` queda público. Ver [CLAUDE.md](./CLAUDE.md) sección 5.9.

Para levantar la API hacen falta `CLERK_PUBLISHABLE_KEY` y `CLERK_SECRET_KEY` (Dashboard de Clerk →
API Keys). Sin ellas el arranque falla — ver `.env.template`.

### Cómo llama un cliente

El token va en el header `Authorization`. En web y móvil se obtiene con `getToken()` del SDK de
Clerk:

```bash
curl http://localhost:3000/api/v1/me -H "Authorization: Bearer <token>"
```

```json
{
  "success": true,
  "message": "Sesión válida",
  "data": {
    "id": "…uuid de app_user…",
    "clerkUserId": "user_2ab…",
    "role": "Administrador",
    "name": "…",
    "email": "…"
  }
}
```

`/api/v1/me` es el endpoint con el que web y móvil resuelven su estado inicial: quién es el usuario
y qué rol tiene. Lo pueden llamar los dos roles.

### Cómo se protege un endpoint

Los guards se aplican **por grupo de rutas** en `src/presentation/routes.ts`:

```ts
router.use('/api/v1/goals', requireAuth, requireRole(ROLES.ADMIN), GoalsRoutes.routes);
```

- `requireAuth` — exige sesión de Clerk y deja el usuario resuelto en `req.authUser`.
- `requireRole(...roles)` — se encadena **después** de `requireAuth`.

### Códigos de respuesta

| Situación                                              | Código |
| ------------------------------------------------------ | ------ |
| Sin token, token expirado o firma inválida              | 401    |
| Token válido, `clerk_user_id` sin registro en `app_user` | 403    |
| Usuario con `active = false` o borrado (`deleted_at`)   | 403    |
| `app_user.role` fuera de `Administrador` / `Vendedor`   | 403    |
| Rol válido pero sin permiso sobre el endpoint           | 403    |

La distinción importa para el cliente: **401 se resuelve volviendo a iniciar sesión; 403 no** — es
un problema de aprovisionamiento que resuelve un administrador.

### Probar un endpoint protegido sin frontend

Mientras web y móvil no existan, no hay quién inicie sesión y por tanto no hay token. Para eso está
`npm run dev:token`, que crea una sesión en la instancia de **desarrollo** de Clerk y devuelve un
token de sesión real — el mismo que emitiría el SDK en la app:

```bash
# 1. Crea el usuario en el dashboard de Clerk (Users → Create user), luego:
npm run dev:token -- juan@pragma.com
```

Imprime el `clerk_user_id`, el `UPDATE` para enlazarlo (ver abajo) y un `curl` listo para pegar. Para
capturar solo el token:

```bash
TOKEN=$(npm run --silent dev:token -- juan@pragma.com --quiet)
curl http://localhost:3000/api/v1/me -H "Authorization: Bearer $TOKEN"
```

El token dura 600 s por defecto (`--expires <segundos>` para cambiarlo; Clerk puede recortarlo, así
que el script informa la vigencia real que quedó en el `exp`, no la pedida).

> El script se niega a correr con una llave `sk_live_` o con `STAGE=prod`. Crear sesiones desde el
> backend está restringido por Clerk a instancias de desarrollo — no existe forma de usarlo contra
> producción, ni por accidente.

### Enlazar un usuario a mano

Mientras no exista el webhook `user.created`, el vínculo se carga manualmente. El `clerk_user_id` es
el ID del usuario en el Dashboard de Clerk (`user_2ab…`), que es el claim `sub` del token:

```sql
UPDATE public.app_user
   SET clerk_user_id = 'user_2ab…'
 WHERE email = 'persona@pragma.com';
```

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

## Despliegue de migraciones

Las migraciones **nunca se aplican a mano** contra un entorno remoto: las aplica GitHub Actions al
mergear a `staging` o `prod`. El flujo de ramas es `feat/* → dev → staging → prod`.

Ver [docs/CI_CD.md](./docs/CI_CD.md).

## Docker

```bash
docker build -t pragmacrm-api .
docker run --rm -p 3000:3000 --env-file .env pragmacrm-api
```
