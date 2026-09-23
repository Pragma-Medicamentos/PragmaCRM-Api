# Despliegue en el VPS con Dokploy

Cómo se levanta la API en el VPS del cliente (RNF-02), en los entornos **staging** y
**producción**. Complementa a [CI_CD.md](./CI_CD.md), que cubre solo las migraciones de base de
datos.

> **Regla de oro del orden:** primero la migración, después el redeploy. Las migraciones las aplica
> GitHub Actions al mergear a `staging` o `prod`; el redeploy de la API va siempre después. Al
> revés, la API arranca contra un esquema que todavía no existe.

---

## Cómo se despliega

Dokploy **construye desde Git dentro del VPS**: clona el repositorio, ejecuta `docker build` con el
`Dockerfile` de la raíz y levanta el contenedor. No hay registry de imágenes ni workflow de GitHub
Actions que publique nada — el único artefacto versionado es el código.

```
merge a staging ──► GitHub Actions: supabase db push  ──► (esquema actualizado)
                                                            │
                                                            ▼
                                        Dokploy: git clone + docker build + run
```

---

## Configuración de la aplicación en Dokploy

Una aplicación por entorno: una apuntando a la rama `staging` y otra a `prod`.

| Campo | Valor |
| --- | --- |
| Tipo | Application |
| Provider | Git — `Pragma-Medicamentos/PragmaCRM-Api` |
| Branch | `staging` o `prod` |
| Build type | **Dockerfile** (ruta `./Dockerfile`) |
| Puerto interno | `3000` |
| Start command | **ninguno** — ver abajo |
| Dominio | el del entorno, con TLS automático (Traefik + Let's Encrypt) |

### No definir un start command

El `CMD` de la imagen es `node dist/app.js`. Poner `npm start` en su lugar **rompe el contenedor**:
ese script es `rimraf ./dist && tsc && node dist/app.js`, y `tsc` y `rimraf` son devDependencies que
la etapa de runtime no instala (`npm ci --omit=dev`). Dejar el campo vacío.

### TLS

Traefik gestiona el certificado y termina TLS en el borde; el contenedor habla HTTP en claro
dentro de la red de Docker. Eso cubre RNF-05 siempre que el dominio esté configurado en Dokploy y
se fuerce la redirección de HTTP a HTTPS.

`trust proxy` está en `1` (`src/presentation/server.ts`), es decir **un solo proxy**. Si más
adelante se pone Cloudflare delante de Traefik hay que subir ese número o el IP real del cliente
que se loguea será el del proxy.

### Memoria

`POST /api/v1/uploads/sales` procesa el archivo **en memoria** (multer con `memoryStorage`), con un
techo de `UPLOAD_MAX_FILE_SIZE_MB` (100 por defecto). Un export normal de 5 MB usa ~17 MB, pero la
carga inicial del histórico puede llegar a un pico de ~330 MB. Asignar al contenedor al menos
**512 MB**, o el OOM killer lo tumba a mitad del import de RF-03.

### Healthcheck

La imagen trae `HEALTHCHECK` contra `GET /api/health`, la única ruta que no exige `x-api-key`. Es
un chequeo de *liveness*: responde 200 mientras el proceso viva, **no verifica la base de datos**.
Un contenedor con `DATABASE_URL` mal puesta se reporta sano; la validación real es el paso 4 de la
verificación post-deploy.

---

## Variables de entorno

Se cargan en el panel de Dokploy, por aplicación. **Nunca en el repositorio**: `.env` y `.env.test`
están en `.gitignore` y no hay ningún secreto versionado. `.env.template` es la referencia de qué
hay que llenar.

| Variable | staging | prod | Nota |
| --- | --- | --- | --- |
| `STAGE` | `staging` | `prod` | Entorno de despliegue |
| `NODE_ENV` | `production` | `production` | **Nunca `staging`**: Node solo entiende `development` y `production` |
| `PORT` | `3000` | `3000` | Debe coincidir con el puerto interno de Dokploy |
| `DATABASE_URL` | 🔒 pooler del proyecto Testing | 🔒 pooler del proyecto Producción | Ver nota del pooler |
| `SUPABASE_URL` | proyecto Testing | proyecto Producción | De aquí salen el issuer y el JWKS |
| `SUPABASE_SERVICE_ROLE_KEY` | 🔒 | 🔒 | Bypass total de RLS: filtrarla es peor que filtrar `DATABASE_URL` |
| `API_KEY` | 🔒 distinta por entorno | 🔒 | Header `x-api-key` en toda ruta salvo `/api/health` |
| `CORS_ORIGIN` | dominio del dashboard de staging | dominio del dashboard de producción | **Obligatoria fuera de `dev`**: sin ella el arranque falla |
| `LOG_LEVEL` | `info` | `info` | Opcional |
| `UPLOAD_MAX_FILE_SIZE_MB` | `100` | `100` | Opcional. Ver Memoria |

🔒 = secreto. No sale del panel de Dokploy ni de la bóveda que use el equipo.

Las variables sin default son `.required()` en `src/config/envs.ts`: si falta una, **el proceso no
arranca** y el log dice cuál. Es deliberado — es preferible un contenedor que no levanta a uno que
sirve tráfico a medias.

### Nota del pooler

El VPS sale a internet por IPv4 y las conexiones directas a Postgres de Supabase son IPv6, así que
`DATABASE_URL` debe apuntar al **pooler**, no al host directo. Cada contenedor abre su propio pool
de hasta 10 conexiones (`src/lib/prisma.ts`); si se levanta más de una réplica, ese número se
multiplica y hay que contrastarlo con el límite del proyecto.

### Rotación de secretos

Cambiar una variable en Dokploy exige redeploy: el proceso las lee una sola vez al arrancar. Al
rotar `API_KEY` hay que actualizar el dashboard web y la app Android antes de redesplegar, o
quedan fuera con 401.

---

## Verificación post-deploy

```bash
# 1. Vivo y público, sin api-key
curl -i https://<dominio>/api/health

# 2. La api-key manda: sin ella, 401
curl -i https://<dominio>/api/v1/me

# 3. Con api-key pero sin JWT: 401 (no 500)
curl -i -H "x-api-key: $API_KEY" https://<dominio>/api/v1/me

# 4. Con un JWT real: 200 con usuario y rol.
#    Prueba de una sola vez que DATABASE_URL, SUPABASE_URL y API_KEY estan bien
#    y que el VPS alcanza el JWKS de Supabase.
curl -H "x-api-key: $API_KEY" -H "Authorization: Bearer $TOKEN" https://<dominio>/api/v1/me
```

El token de la prueba 4 se obtiene contra `/auth/v1/token?grant_type=password` del proyecto
Supabase del entorno (ver README, sección *Autenticación*).

Además:

5. Subir el export real del ERP (~5 MB) desde el dashboard: confirma que el proxy no corta el body
   y que el contenedor no muere por memoria.
6. Redesplegar con tráfico en curso: ninguna petición debe cortarse. La API cierra ordenadamente al
   recibir `SIGTERM` (deja de aceptar conexiones, espera las que están en vuelo hasta 8 s y libera
   el pool de Postgres).

---

## Rollback

- **De la aplicación:** redeploy del commit anterior desde Dokploy. Es inmediato, porque la imagen
  se reconstruye desde Git.
- **De la base de datos:** no hay. La estrategia es *forward-fix*, una migración nueva que corrija
  (ver [CI_CD.md](./CI_CD.md)). Por eso el orden importa: una migración compatible hacia atrás
  permite volver la aplicación sin tocar el esquema.

---

## Probar la imagen en local

```bash
docker build -t pragmacrm-api:local .
docker run --rm -p 3000:3000 --env-file .env --name pcrm pragmacrm-api:local

curl http://localhost:3000/api/health
docker inspect --format='{{.State.Health.Status}}' pcrm   # healthy
docker stop pcrm                                          # debe salir en ~1 s
```

Si `docker stop` tarda los 10 s completos, el apagado ordenado dejó de funcionar: la señal no está
llegando al proceso.
