# Probar KPIs (RF-09) en Postman

Todos los endpoints de métricas son **GET**, no llevan `body` y requieren:

- Header `Authorization: Bearer {{token}}`
- Un `app_user` con `role = 'Administrador'` (el grupo `/api/v1/metrics` exige `requireRole(ROLES.ADMIN)`; con un vendedor da **403**).

Configura en Postman una variable de colección `{{baseUrl}} = http://localhost:3000`.

## 0. Prerrequisitos

1. Base local levantada y con seed aplicado (el seed inserta 1 admin + 5 vendedores, ~12 meses de ventas/visitas/metas — ver `supabase/seed.sql`):

   ```bash
   npx supabase start
   npx supabase db reset --no-seed   # o sin --no-seed si quieres reaplicar el seed
   npm run dev
   ```

2. `npx supabase status` te da `API URL` y `anon key` del stack local.

3. Consigue un token de **admin** (usuario semilla `admin@pragma.test` / password `Pragma123!`, ver `supabase/seed.sql`):

   ```
   POST {SUPABASE_URL}/auth/v1/token?grant_type=password
   Headers: apikey: {SUPABASE_ANON_KEY}, Content-Type: application/json
   Body (raw JSON):
   {
     "email": "admin@pragma.test",
     "password": "Pragma123!"
   }
   ```

   Guarda `access_token` de la respuesta en la variable `{{token}}` de Postman.

4. (Opcional) Confirma el rol con `GET {{baseUrl}}/api/v1/me` usando ese mismo `{{token}}` — debe devolver `role: "Administrador"`.

---

## 1. Catálogo de KPIs

```
GET {{baseUrl}}/api/v1/metrics/kpis
Headers: Authorization: Bearer {{token}}
```

Sin query params. Devuelve nombre, unidad y tags de umbral de los 17 KPIs — no calcula nada, así que sirve para verificar que el catálogo está completo antes de pedir valores.

---

## 2. Batch de KPIs (para pantallas 1a, 1d, 1v)

```
GET {{baseUrl}}/api/v1/metrics/kpis/values
Headers: Authorization: Bearer {{token}}
```

Query params (todos opcionales):

| Param | Formato | Nota |
|---|---|---|
| `from` | `YYYY-MM-DD` | Si se omite junto con `to`, cae al mes actual |
| `to` | `YYYY-MM-DD` | — |
| `inactivity_days` | entero 1–365 | Por defecto `INACTIVITY_THRESHOLD_DAYS` (30) |
| `names` | lista separada por coma, o repetido (`names=a&names=b`) | Si se omite, calcula los 17 |

Ejemplos de URL:

```
{{baseUrl}}/api/v1/metrics/kpis/values?from=2026-01-01&to=2026-08-31
{{baseUrl}}/api/v1/metrics/kpis/values?names=total_sales,average_ticket,overdue_portfolio
{{baseUrl}}/api/v1/metrics/kpis/values?names=recovered_customers&inactivity_days=45
```

`names` inválido (fuera de la lista de abajo) responde 400.

---

## 3. Un solo KPI (refrescar una tarjeta)

```
GET {{baseUrl}}/api/v1/metrics/kpis/:name
Headers: Authorization: Bearer {{token}}
```

`:name` es uno de los 17 valores válidos (ver tabla). Query params opcionales: `from`, `to`, `inactivity_days` (mismas reglas que arriba).

Nombres válidos de KPI (`KPI_NAMES`, `src/domain/schemas/metrics.schema.ts`):

```
stops_executed
stops_by_type
visited_customers
effective_visits_rate
average_visit_minutes
total_sales
orders_count
average_ticket
average_monthly_sales
route_effectiveness
goal_compliance
customers_without_visit
recovered_customers
new_prospects
purchase_frequency_days
overdue_portfolio
pending_collections
```

Ejemplos:

```
{{baseUrl}}/api/v1/metrics/kpis/total_sales
{{baseUrl}}/api/v1/metrics/kpis/goal_compliance?from=2026-07-01&to=2026-07-31
{{baseUrl}}/api/v1/metrics/kpis/overdue_portfolio
```

`:name` fuera del catálogo → 404.

---

## 4. Desempeño por vendedor (tabla, pantallas 1d/1f)

```
GET {{baseUrl}}/api/v1/metrics/sellers
Headers: Authorization: Bearer {{token}}
```

Query opcionales: `from`, `to`, `inactivity_days`.

```
{{baseUrl}}/api/v1/metrics/sellers
{{baseUrl}}/api/v1/metrics/sellers?from=2026-01-01&to=2026-09-24
```

---

## 5. Detalle de un vendedor (pantalla 1f)

```
GET {{baseUrl}}/api/v1/metrics/sellers/:id
Headers: Authorization: Bearer {{token}}
```

`:id` es el `app_user.id` (uuid) de un vendedor. Consíguelo de dos formas:

- Respuesta del endpoint anterior (`/metrics/sellers`), cada fila trae el `id`.
- Consultando la tabla directamente en Supabase Studio: `select id, name, email from app_user where role = 'Vendedor';` (el seed crea 5: Rosa Alvarado, Carlos Meléndez, Ana Cordero, Luis Portillo, Diana Reyes).

Query opcionales: `from`, `to`, `inactivity_days`.

`:id` con formato inválido (no uuid) → 400. `:id` inexistente → 404 (revisar service).

---

## 6. Tendencias (gráficas, pantalla 1e / Home)

```
GET {{baseUrl}}/api/v1/metrics/trends
Headers: Authorization: Bearer {{token}}
```

Query params:

| Param | Formato | Nota |
|---|---|---|
| `from`, `to` | `YYYY-MM-DD` | Opcionales |
| `inactivity_days` | entero | Opcional |
| `granularity` | `week` \| `month` | Opcional, default `week` |

```
{{baseUrl}}/api/v1/metrics/trends
{{baseUrl}}/api/v1/metrics/trends?granularity=month&from=2026-01-01&to=2026-09-24
```

---

## 7. Cobertura de cartera (mapa, pantalla 1e)

```
GET {{baseUrl}}/api/v1/metrics/coverage
Headers: Authorization: Bearer {{token}}
```

Query opcionales: `from`, `to`, `inactivity_days`.

---

## 8. Frecuencia de compra (histograma, pantalla 1e)

```
GET {{baseUrl}}/api/v1/metrics/purchase-frequency
Headers: Authorization: Bearer {{token}}
```

Query opcionales: `from`, `to`, `inactivity_days`.

---

## Notas de validación a tener en cuenta al probar

- `from` debe ser ≤ `to`, y el rango no puede exceder 366 días (`MAX_RANGE_DAYS`) — probar un rango mayor debe dar 400, útil como caso negativo.
- Sin `from`/`to`, el rango cae al mes actual — para ver datos del seed (que cubre ~12 meses hacia atrás desde la fecha de aplicación), conviene fijar explícitamente `from`/`to` dentro de ese histórico.
- Probar también con un token de **Vendedor** (`rosa.alvarado@pragma.test` / `Pragma123!`) para confirmar el 403 de `requireRole(ROLES.ADMIN)`.
- Probar sin header `Authorization` para confirmar el 401.
