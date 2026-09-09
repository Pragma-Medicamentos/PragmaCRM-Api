# CI/CD — Migraciones de base de datos

Este documento describe cómo se validan y despliegan los cambios de esquema (migraciones de
Supabase) a través de GitHub Actions.

> **Alcance:** cubre únicamente el pipeline de **migraciones de base de datos**. El despliegue del
> runtime de la aplicación (la imagen Docker) es independiente y se define aparte.

---

## Por qué existe

Aplicar migraciones a mano con `supabase db push` desde la laptop de cada desarrollador desincroniza
el historial del remoto en cuanto hay más de una persona trabajando en paralelo: aparecen
migraciones fuera de orden que solo se recuperan manualmente.

La solución es **sacar `db push` de las laptops y que el merge sea el único disparador**. Los merges
a una rama están serializados por definición, así que solo una fuente ordenada aplica migraciones al
remoto. Git pasa a ser la única fuente de verdad; el estado de la base de datos se deriva de él y
nunca al revés.

---

## Mapeo rama → entorno

| Rama Git  | Proyecto Supabase      | Disparador del deploy | Puerta                                |
| --------- | ---------------------- | --------------------- | ------------------------------------- |
| `dev`     | — (solo integración)   | ninguno               | —                                     |
| `staging` | Testing                | merge/push → auto     | ninguna                               |
| `prod`    | Producción             | merge/push → auto     | **aprobación manual** (required reviewer) |

El flujo es en una sola dirección: `feat/* → dev → staging → prod`.

---

## Workflows

Viven en `.github/workflows/`.

### `ci.yml` — validación (en cada PR)

Corre en `pull_request` hacia `dev`, `staging` o `prod`. Dos jobs en paralelo:

| Job                   | Qué hace                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `lint-and-test`       | `npm ci`, `npm audit`, `prisma generate`, `npm run lint`, `npm run tsc`, `npm run test`     |
| `validate-migrations` | Levanta Postgres vía Docker y reaplica **todas las migraciones desde cero** (`supabase db start` + `supabase db reset --no-seed`) |

`validate-migrations` es la **defensa principal contra migraciones fuera de orden**: si dos
migraciones entran en conflicto o una está rota, falla ahí — en el PR, antes de tocar cualquier base
remota.

### `deploy-staging.yml` — merge a `staging`

`supabase link` + `supabase db push` contra el proyecto de Testing. Totalmente automático.

### `deploy-prod.yml` — merge a `prod`

Los mismos pasos, pero el job apunta al Environment `production` de GitHub, que tiene un **required
reviewer**: el deploy **queda en estado "Waiting" hasta que una persona lo apruebe**.

---

## Por qué `db push` corre *sin* `--include-all`

- `--include-all` forzaría a aplicar migraciones cuyo timestamp está *por detrás* de la última ya
  aplicada en el remoto. Para migraciones independientes eso es inofensivo, pero para las que
  **entran en conflicto** las aplicaría igual y podría romper a mitad del push (`db push` no es
  transaccional entre archivos).
- Sin la bandera, una migración fuera de orden hace que el deploy **falle ruidosamente**, forzando
  una decisión manual consciente en lugar de aplicar un cambio desordenado en producción.

> Estrategia de rollback: Supabase no tiene down-migrations automáticas. Revertir siempre es un
> **forward-fix** (una nueva migración correctiva), nunca un rollback.

---

## Secrets y environments

Se configuran en **Settings** del repositorio (nunca se comitean). Los workflows solo los referencian
por nombre.

### Secret del repositorio

| Secret                  | Dónde                                        | Notas                                                                                |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `SUPABASE_ACCESS_TOKEN` | `Settings → Secrets and variables → Actions` | Personal Access Token a nivel de cuenta. Compartido por ambos entornos. No expira: revocar a mano si se filtra. Preferir una cuenta de servicio, no una personal. |

### Secrets por environment

En `Settings → Environments`. Cada environment además restringe *Deployment branches* a su propia
rama, de modo que solo esa rama puede leer sus secrets.

| Environment  | Restricción de rama | Secrets                                             | Extra                              |
| ------------ | ------------------- | --------------------------------------------------- | ---------------------------------- |
| `staging`    | solo `staging`      | `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` (Testing) | —                                  |
| `production` | solo `prod`         | `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` (Prod)    | **Required reviewers** (la puerta) |

`SUPABASE_DB_PASSWORD` es la contraseña del rol `postgres`, no la del rol restringido que use la API
en runtime: las migraciones son DDL y requieren el rol privilegiado.

> Los required reviewers en repos **privados** requieren plan GitHub Pro/Team/Enterprise. En un repo
> privado gratuito la opción puede no aparecer — el fallback es la puerta manual de
> `workflow_dispatch`.

---

## ⚠️ Pendiente: baseline del esquema

**La base de datos remota ya existe, pero `supabase/migrations/` está vacío.** Mientras eso siga
así, `validate-migrations` pasa trivialmente y los deploys no aplican nada. El siguiente paso es
generar la migración baseline:

```bash
# 1. Vincular el repo al proyecto remoto (una sola vez)
npx supabase link --project-ref <PROJECT_ID>

# 2. Traer el esquema actual como primera migración
npx supabase db pull

# 3. Confirmar que reaplica limpio desde cero
npx supabase db reset --no-seed

# 4. Sincronizar el cliente de Prisma con ese esquema
npx prisma db pull
npx prisma generate
```

Antes del primer deploy automatizado, verificar que el historial remoto esté en sync:
`npx supabase migration list --linked` contra Testing y Prod.

---

## Checklist de configuración inicial

- [ ] Secret de repo `SUPABASE_ACCESS_TOKEN` (Dashboard → Account → Access Tokens)
- [ ] Environment `staging`: `SUPABASE_PROJECT_ID` + `SUPABASE_DB_PASSWORD`, rama `staging`
- [ ] Environment `production`: los mismos secrets (valores de Prod), rama `prod`, **required reviewers**
- [ ] Branch protection en `dev`/`staging`/`prod`: exigir `lint-and-test` y `validate-migrations`
- [ ] Restringir quién puede hacer push/merge a `staging` y `prod`
- [ ] Generar la migración baseline (sección anterior)

---

## Cómo fluye un cambio de esquema

1. Crear la migración en local (`npx supabase migration new <nombre>`), probarla con
   `npx supabase db reset --no-seed`, abrir PR hacia `dev`. **Nunca correr `db push` contra un
   remoto a mano.**
2. CI corre en el PR (`lint-and-test` + `validate-migrations`). Ambos deben estar en verde.
3. Merge a `dev` (integración; no toca ninguna base remota).
4. Promover `dev → staging`. El push dispara `deploy-staging` → aplica a Testing automáticamente.
5. Tras verificar staging, promover `staging → prod`. El push dispara `deploy-prod`, que **espera
   aprobación manual** antes de aplicar a Producción.

---

## Troubleshooting

**Un job `deploy-*` falla con error de historial / fuera de orden.**
Llegó al remoto una migración con timestamp anterior a la última aplicada. Es el comportamiento
"fallar ruidosamente" funcionando. Investigar con `supabase migration list --linked` y resolver
re-timestampeando la migración rezagada o con una migración correctiva — nunca editando una
migración ya aplicada en producción.

**`deploy-staging` falla en la primera corrida.**
Lo más probable es que falten los secrets del environment `staging`. Configurarlos **antes** de
mergear a `staging`. Un job fallido aquí no toca la base de datos.

**`validate-migrations` falla pero la migración se ve bien por separado.**
Probablemente choca con otra migración al aplicarse en orden desde una base vacía (p. ej. dos
migraciones creando el mismo objeto). Ese es exactamente el drift que este job existe para atrapar.
