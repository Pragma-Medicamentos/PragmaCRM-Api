# PragmaCRM API

API REST del CRM de Pragma Medicamentos. Node.js + TypeScript + Express, con PostgreSQL vía
Supabase y Prisma como cliente de acceso a datos.

## Requisitos

- Node.js 20+ (desarrollado con 24)
- Docker Desktop (lo necesita la CLI de Supabase para la base de datos local)
- Supabase CLI — no hace falta instalarla globalmente, se usa vía `npx`

## Puesta en marcha

```bash
# 1. Variables de entorno
cp .env.template .env

# 2. Dependencias
npm install

# 3. Base de datos local (Supabase: Postgres en el puerto 54322)
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

La base de datos se opera con la **CLI de Supabase**, no con scripts de npm:

| Comando                            | Qué hace                                          |
| ---------------------------------- | ------------------------------------------------- |
| `npx supabase start`               | Levanta el stack local (Postgres en el 54322)     |
| `npx supabase stop`                | Lo apaga                                          |
| `npx supabase migration new <n>`   | Crea una migración SQL                            |
| `npx supabase db reset --no-seed`  | Reaplica todas las migraciones desde una DB vacía |
| `npx supabase migration list`      | Estado del historial de migraciones               |
| `npx prisma db pull`               | Sincroniza `prisma/schema.prisma` con la DB       |
| `npx prisma generate`              | Regenera el cliente tipado de Prisma              |

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
