# CLAUDE.md

Guía para Claude Code (claude.ai/code) al trabajar en este repositorio.

## Comandos

```bash
npm run dev          # Servidor de desarrollo con hot-reload (ts-node-dev)
npm run build        # Compila TypeScript a dist/
npm run start        # Build + ejecuta el output compilado
npm run lint         # ESLint
npm run tsc          # Type-check sin emitir
npm run test         # Tests unitarios (Jest)
npm run test:integration  # Tests de integración (requiere .env.test)
```

La base de datos se opera con la CLI de Supabase, no con scripts de npm:

```bash
npx supabase start                  # Levanta el stack local (Postgres en el 54322)
npx supabase migration new <n>      # Crea una migración SQL nueva
npx supabase db reset --no-seed     # Reaplica todas las migraciones desde una DB vacía
npx prisma db pull                  # Sincroniza prisma/schema.prisma con la DB
npx prisma generate                 # Regenera el cliente tipado
```

Correr un archivo de test concreto:

```bash
npx jest src/presentation/health/__tests__/health.test.ts
npx jest --testNamePattern="handleError"
```

## Variables de entorno

```
STAGE          # "dev" | "staging" | "prod" — entorno de despliegue
NODE_ENV       # "development" en local, "production" en TODO remoto (nunca "staging")
PORT
DATABASE_URL   # Cadena de conexión a PostgreSQL (Supabase)
LOG_LEVEL      # Opcional, por defecto "info"
```

Plantilla en `.env.template`. Los tests de integración leen `.env.test` (ver `.env.test.example`).

## Arquitectura

### Estructura por capas

```
src/app.ts                         ← entry point
src/presentation/
  server.ts                        ← setup de Express, middlewares globales, 404 y error handler
  routes.ts                        ← monta todos los grupos de rutas
  <modulo>/routes.ts               ← registra rutas + aplica validateBody/validateQuery
  <modulo>/<modulo>.controller.ts  ← extrae datos del request, llama al service, arma ApiResponse
  middleware/                      ← requestMetadata, validate
src/services/                      ← lógica de negocio, acceso directo a Prisma
src/use-cases/                     ← operaciones que orquestan varios services
src/domain/
  schemas/                         ← esquemas Zod + tipos inferidos
  types/                           ← tipos de retorno compartidos
  errors/CustomError.ts            ← errores HTTP tipados con factory methods
  interfaces/                      ← ApiResponse, ILogger, IValidator
src/lib/
  handleError.ts                   ← mapea CustomError / ZodError / códigos Prisma a {statusCode, message}
  sendErrorResponse.ts             ← handleError + log de 500 + respuesta JSON
  prisma.ts                        ← instancia única de PrismaClient (adapter PrismaPg)
  adapters/                        ← logger (pino), validator (zod)
```

Un módulo nuevo se agrega creando `src/presentation/<modulo>/{routes.ts, <modulo>.controller.ts}`,
su service en `src/services/`, sus esquemas Zod en `src/domain/schemas/`, y montándolo en
`src/presentation/routes.ts` bajo `/api/v1/<recurso>`. `health/` es el ejemplo mínimo a copiar.

### Autenticación

**No hay autenticación todavía.** No existen middlewares de API key ni de sesión: todas las rutas
son públicas. Cuando se agregue, va como middleware aplicado en `routes.ts` por grupo de rutas.

### Validación

Los esquemas Zod viven en `src/domain/schemas/`. Usar el wrapper correspondiente:

- `validateBody(schema)` — parsea `req.body` y lo reemplaza por el valor tipado
- `validateQuery(schema)` — parsea `req.query`
- `validateParams(schema)` — parsea `req.params`

Un fallo produce `{ success: false, message: 'Validation error…', errors: [{ field, message }] }`.

### Manejo de errores

Lanzar `CustomError` (o sus factory methods) para errores HTTP esperados. `sendErrorResponse` /
`handleError` lo mapean a status + mensaje. Los códigos de Prisma P2002 (409), P2003 (400) y P2025
(404) se mapean automáticamente. Todo lo demás se convierte en 500 y se loguea con `logger.error` —
el mensaje interno nunca llega al cliente.

Regla: los controladores no arman respuestas de error a mano; delegan en `sendErrorResponse`.

### Respuestas

Toda respuesta usa el envelope `ApiResponse<T>`: `{ success, message, data?, errors? }`.

### Base de datos y migraciones

Prisma se usa **solo como cliente**; el esquema es propiedad de las migraciones SQL de Supabase
(`supabase/migrations/`). `prisma/schema.prisma` se regenera con `npx prisma db pull` — no se edita
a mano. El pipeline completo está en [docs/CI_CD.md](./docs/CI_CD.md).

> Estado actual: `supabase/migrations/` está vacío. La migración baseline desde la DB remota está
> pendiente (ver la sección "Pendiente: baseline del esquema" en docs/CI_CD.md).

### Logging

`logger` (pino) desde `src/lib/adapters/logger.ts` — nunca `console.log` (ESLint lo marca).
`requestMetadata` asigna un `X-Request-ID` por petición y loguea método, ruta, status y duración.
