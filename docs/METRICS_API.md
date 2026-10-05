# API del Panel de Métricas (RF-09 · PCRM-13)

Contrato de los endpoints que alimentan el **Resumen** (`1a`) y el **Panel de métricas** (`1d`, `1e`, `1f`, `1v`) del dashboard web. Solo **Administrador**.

Código: `src/services/metrics.service.ts` (orquestación y mapeo), `src/repositories/metrics.repository.ts` + `src/repositories/metrics/*.sql.ts` (SQL), `src/presentation/metrics/`, `src/domain/types/metrics.types.ts` (tipos de respuesta, fuente de verdad de los campos).

---

## Convenciones

- Base: `/api/v1/metrics`. Headers: `x-api-key` + `Authorization: Bearer <token>`.
- Envelope estándar `{ success, message, data }`. Campos en `snake_case` inglés, igual que el resto de la API.
- **Dinero:** string con dos decimales (`"118.00"`), nunca number. **Tasas:** número en %, un decimal (`91.5`). **Conteos:** entero.
- **`null` significa "no calculable en este período"** (sin ventas, sin metas, sin visitas), nunca cero. El frontend lo pinta como `—`.

### Query común

| Param | Formato | Default | Notas |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | primer día del mes en curso | Día local de El Salvador, inclusivo |
| `to` | `YYYY-MM-DD` | último día del mes de `from` | Inclusivo. Máximo 366 días de rango |
| `inactivity_days` | entero 1–365 | `INACTIVITY_THRESHOLD_DAYS` (30) | Sobrescribe el umbral solo para esa petición |
| `names` | lista separada por coma | todas | **Solo en `/kpis/values`.** Ver endpoint 1 |
| `limit` | entero 1–500 | `50` | **Solo en `/products`.** Filas del ranking. Ver endpoint 7 |

Errores de validación → `400` con `errors[].field` (`from` si `from > to`, `to` si el rango excede 366 días).

### Bloque común de toda respuesta

```json
{
  "period": { "from": "2026-09-01", "to": "2026-09-30" },
  "thresholds": { "inactivity_days": 30, "credit_term_days": 60, "gps_radius_meters": 80 }
}
```

`thresholds` son las constantes con las que se calcularon los números. **Sugerencia para la UI:** mostrar un tag discreto junto a las tarjetas afectadas — p. ej. "Umbral: 30 días" en *Clientes sin visita* y *Clientes recuperados*, "Plazo: 60 días" en *Cartera vencida*.

---

## Endpoints

### 1. KPIs de empresa — tarjetas (`1a`, `1d`, `1v`)

**Cada KPI se calcula con su propia query**, y solo corre si se pide. El SQL de cada una está en `src/repositories/metrics/kpis/<nombre>.sql.ts`. Hay tres endpoints:

```
GET /kpis                                        → catálogo: qué KPIs existen (no calcula nada)
GET /kpis/values?names=a,b,c&from&to             → lote: calcula SOLO esas KPIs, en paralelo
GET /kpis/:name?from&to                          → una KPI (refrescar una tarjeta)
```

**Cuál usar:**

| Caso | Llamada |
|---|---|
| Home (`1a`), 4 tarjetas | `GET /kpis/values?names=stops_executed,average_ticket,customers_without_visit,new_prospects` |
| Panel (`1d`), todas | `GET /kpis/values` (sin `names` = las 17), o 2–3 lotes en paralelo por sección para carga progresiva |
| Refrescar una tarjeta | `GET /kpis/average_ticket?from=…&to=…` |

Un lote es **una** request: autenticación una sola vez y las queries en paralelo dentro del servidor. Pedir 4 KPIs ejecuta 4 queries, no 17.

#### `GET /kpis` — catálogo

```json
{
  "kpis": [
    { "name": "total_sales", "unit": "money", "has_previous_period": true, "thresholds": [] },
    { "name": "customers_without_visit", "unit": "count", "has_previous_period": true, "thresholds": ["inactivity_days"] },
    { "name": "overdue_portfolio", "unit": "money", "has_previous_period": false, "thresholds": ["credit_term_days"] }
  ]
}
```

- `unit`: `count`, `money`, `percent`, `minutes` o `days`. Indica cómo formatear el valor.
- `thresholds`: qué claves del bloque `thresholds` afectan a esa KPI. Son las que el frontend muestra como tag ("Umbral: 30 días").
- `has_previous_period: false` corresponde a las KPIs *foto*: `previous_value` siempre es `null`.

#### `GET /kpis/values` — lote

Parámetro `names`: nombres separados por coma, o el parámetro repetido (`?names=a&names=b`).
- Sin `names` calcula las 17.
- Los duplicados se ignoran.
- Un nombre desconocido o una lista vacía devuelve `400`, con `errors[].field` empezando por `names`.
- `kpis` trae solo las pedidas, en el orden en que se pidieron.

**Aislamiento de fallas:** si una KPI falla, llega como `{ "error": "KPI could not be computed" }` y las demás llegan normales. Solo si fallan **todas** se responde `500`. El frontend debe tratar cada tarjeta como opcional y revisar si trae `error`.

Cada KPI viene como `{ value, previous_value }`. `previous_value` es la misma KPI en el período anterior de igual duración (`previous_period`), y sirve para los deltas del Home ("+8 %"). **Se calcula en la misma query**: se recorre una sola vez el tramo `[inicio del período anterior, fin del actual)` y se separan los dos valores con `FILTER`.

#### `GET /kpis/:name` — una KPI

```json
{
  "name": "average_ticket",
  "unit": "money",
  "has_previous_period": true,
  "period": { "from": "2026-09-01", "to": "2026-09-30" },
  "previous_period": { "from": "2026-08-02", "to": "2026-08-31" },
  "thresholds": { "inactivity_days": 30, "credit_term_days": 60, "gps_radius_meters": 80 },
  "value": "118.00",
  "previous_value": "112.54"
}
```

- Un nombre desconocido devuelve `404`.
- En las KPIs *foto*, `previous_period` es `null`.

**Ejemplo de respuesta de `/kpis/values` con las 17:**

```json
{
  "period": { "from": "2026-09-01", "to": "2026-09-30" },
  "previous_period": { "from": "2026-08-02", "to": "2026-08-31" },
  "thresholds": { "inactivity_days": 30, "credit_term_days": 60, "gps_radius_meters": 80 },
  "kpis": {
    "stops_executed":          { "value": 248, "previous_value": 231 },
    "stops_by_type":           { "value": { "visit": 160, "dispatch": 60, "collection": 28 }, "previous_value": { "visit": 150, "dispatch": 55, "collection": 26 } },
    "visited_customers":       { "value": 140, "previous_value": 133 },
    "effective_visits_rate":   { "value": 84.7, "previous_value": 82.1 },
    "average_visit_minutes":   { "value": 17.3, "previous_value": 18.0 },
    "total_sales":             { "value": "29264.00", "previous_value": "27010.50" },
    "orders_count":            { "value": 248, "previous_value": 240 },
    "average_ticket":          { "value": "118.00", "previous_value": "112.54" },
    "average_monthly_sales":   { "value": "29264.00", "previous_value": "27010.50" },
    "route_effectiveness":     { "value": "1180.00", "previous_value": "1050.00" },
    "goal_compliance":         { "value": 91.2, "previous_value": null },
    "customers_without_visit": { "value": 18, "previous_value": 22 },
    "recovered_customers":     { "value": 3, "previous_value": 1 },
    "new_prospects":           { "value": 7, "previous_value": 7 },
    "purchase_frequency_days": { "value": 11, "previous_value": 12 },
    "overdue_portfolio":       { "value": "1450.50", "previous_value": null },
    "pending_collections":     { "value": "3200.00", "previous_value": null }
  }
}
```

| Campo | Tarjeta | Fórmula |
|---|---|---|
| `stops_executed` | "Paradas ejecutadas" / "Paradas del mes" | `COUNT(visit)` con `started_at` en el rango |
| `stops_by_type` | "Paradas por tipo" | Mismo conteo separado por `visit_type` |
| `visited_customers` | métrica base | `COUNT(DISTINCT visit.customer_id)` |
| `effective_visits_rate` | métrica base | Visitas con `successful = true` / visitas × 100 |
| `average_visit_minutes` | métrica base (opcional) | `AVG(finished_at − started_at)` |
| `total_sales` | "Venta mensual" (RF-09) | `SUM(sale.total)`, `erp_status = 2`, por `erp_created_at` |
| `orders_count` | "Número de pedidos" | `COUNT(sale)` |
| `average_ticket` | "Ticket promedio" | `total_sales / orders_count` |
| `average_monthly_sales` | "Venta prom. mensual" | `total_sales /` meses calendario que toca el rango |
| `route_effectiveness` | "Efectividad de ruta" | Venta atribuida a ruta (`sale.visit_id → visit.route_user_id`) ÷ jornadas ejecutadas (par ruta-asignada + día local con al menos una visita) |
| `goal_compliance` | "Cumplimiento de meta" | Venta de los vendedores con meta ÷ suma de sus metas de los meses tocados × 100 |
| `customers_without_visit` | "Clientes sin visita" | Clientes activos sin visita en los `inactivity_days` previos al fin del rango (o a hoy, si el rango llega al futuro) |
| `recovered_customers` | "Clientes recuperados" | Clientes con una compra en el rango precedida de un hueco de más de `inactivity_days` sin comprar. La primera compra histórica no cuenta (clientes nuevos está retirado) |
| `new_prospects` | "Prospectos nuevos" | `COUNT(prospect)` por `created_at` |
| `purchase_frequency_days` | "Frec. de compra" | Promedio de días entre compras consecutivas de un mismo cliente |
| `overdue_portfolio` | "Cartera vencida" | **Foto a hoy.** Saldo de ventas a crédito con más de 60 días. Excluye contado (`payment_id = 1`) |
| `pending_collections` | métrica base | **Foto a hoy.** Todo saldo pendiente a crédito |

### 2. `GET /sellers` — tabla "Desempeño por vendedor" (`1d`) y filas de `1f`

```json
{
  "period": { "...": "..." }, "thresholds": { "...": "..." },
  "sellers": [
    {
      "user_id": "…", "name": "Carlos Martínez", "active": true,
      "stops_executed": 72, "stops_by_type": { "visit": 41, "dispatch": 22, "collection": 9 },
      "visited_customers": 18, "orders_count": 72,
      "total_sales": "9432.00", "average_ticket": "131.00",
      "goal_amount": "9825.00", "goal_compliance": 96.0,
      "route_sales": "9170.00", "executed_route_days": 7, "sales_per_route": "1310.00",
      "dispatches_for_others": 4, "portfolio_customers": 18
    }
  ]
}
```

- Ordenado por `total_sales` descendente.
- La **venta** se acredita al vendedor del ERP (`sale.user_id`); las **paradas**, a quien las ejecutó (`visit.user_id`).
- `dispatches_for_others`: despachos que ejecutó este vendedor cuya venta pertenece a otro (nota de `1f`).
- `portfolio_customers`: clientes de las rutas asignadas **hoy** ("18 clientes en cartera").
- Aparecen los vendedores activos, y los inactivos solo si tuvieron actividad en el período.

### 3. `GET /sellers/:id` — fila expandida de `1f`

```json
{
  "period": { "...": "..." }, "thresholds": { "...": "..." },
  "seller": { "...misma forma que una fila de /sellers..." },
  "weekly_trend": [ { "bucket_start": "2026-08-31", "stops": 18, "orders_count": 17, "total_sales": "2210.00", "average_ticket": "130.00" } ],
  "customers_without_visit": [
    { "customer_id": "…", "name": "Botica Del Valle", "trade_name": null, "zone": "Escalón",
      "last_visit_at": "2026-08-15T15:00:00.000Z", "days_since_last_visit": 38 }
  ]
}
```

`customers_without_visit`: clientes activos de las rutas del vendedor cuya última visita (de cualquier vendedor) supera el umbral. Los nunca visitados vienen primero, con `last_visit_at: null`. `404` si el id no es de un vendedor.

### 4. `GET /trends?granularity=week|month` — gráficos (`1e`, gráfico del Home)

Default `week`. Semanas de lunes a domingo, en hora local.

```json
{
  "period": { "...": "..." }, "thresholds": { "...": "..." },
  "granularity": "week",
  "points": [
    { "bucket_start": "2026-08-31", "stops": 62, "orders_count": 60, "total_sales": "7080.00", "average_ticket": "118.00" }
  ]
}
```

Los buckets sin actividad llegan en cero, así que el gráfico no tiene huecos. El primer y el último bucket pueden empezar antes de `from` o terminar después de `to`, pero solo se cuenta la actividad dentro del rango.

### 5. `GET /coverage` — mapa "Cobertura de cartera" (`1e`)

```json
{
  "period": { "...": "..." }, "thresholds": { "...": "..." },
  "visited": 140, "not_visited": 212, "without_location": 6,
  "customers": [
    { "customer_id": "…", "name": "Farmacia San José", "trade_name": null,
      "lat": 13.70, "lng": -89.24, "visited": true, "last_visit_at": "2026-09-18T16:00:00.000Z" }
  ]
}
```

- `visited` / `not_visited` se cuentan sobre todos los clientes activos.
- `customers` incluye solo los que tienen pin GPS.
- En el mapa: pin lleno si `visited`, pin hueco si no.
- `visited` **no** cuenta una visita que ejecuta una parada extra (PCRM-158): las paradas extra no son cobertura planificada/asignada.

### 6. `GET /purchase-frequency` — histograma (`1e`)

```json
{
  "period": { "...": "..." }, "thresholds": { "...": "..." },
  "buckets": [
    { "label": "0-7",   "min_days": 0,  "max_days": 7,    "customers": 12 },
    { "label": "8-15",  "min_days": 8,  "max_days": 15,   "customers": 30 },
    { "label": "16-30", "min_days": 16, "max_days": 30,   "customers": 25 },
    { "label": "31-60", "min_days": 31, "max_days": 60,   "customers": 9 },
    { "label": "61+",   "min_days": 61, "max_days": null, "customers": 3 }
  ],
  "insufficient_data": 14,
  "average_days": 17
}
```

`insufficient_data`: clientes que compraron en el período pero no tienen una compra anterior con la cual comparar.

### 7. `GET /products` — ranking "Productos más vendidos" (PCRM-172)

Productos ordenados por monto vendido en el período. Misma regla de venta confirmada que el resto del panel: `sale.deleted_at IS NULL`, `sale.erp_status = 2` y la línea se fecha por `sale.erp_created_at` (CLAUDE.md 5.5), no por la fecha de la línea.

```json
{
  "period": { "...": "..." }, "thresholds": { "...": "..." },
  "products": [
    { "position": 1, "product_id": 42, "code": "ABC-1", "name": "Producto X",
      "amount": "1500.00", "units": "120.0000" }
  ],
  "total_amount": "5000.00"
}
```

| Campo | Notas |
|---|---|
| `position` | 1 en adelante, por `amount` descendente; los empates se rompen por `product_id` ascendente, así que el orden es estable entre peticiones |
| `product_id` | `product.erp_product_id`, la PK natural del ERP (entero) |
| `code` | `product.code`. Puede ser `null` |
| `amount` | `SUM(sale_detail.total)` del producto en el período, IVA incluido (decisión D-1). String de dos decimales, como todo el dinero |
| `units` | `SUM(sale_detail.quantity × COALESCE(sale_detail.factor, 1))`, en la unidad base del producto (la de factor 1). `quantity` viene en la unidad de medida de cada línea: el mismo producto se vende por UNIDAD y por DOCENA (factor 12). String con hasta 4 decimales |
| `total_amount` | Monto de **todos** los productos con venta en el período, **antes** de aplicar `limit`. Permite mostrar "top 50 de un total de $X" |

- `limit` recorta las filas devueltas, nunca `total_amount`.
- Solo aparecen productos con al menos una línea de venta confirmada en el rango: no hay filas en cero.
- Se excluyen las líneas huérfanas (`sale_detail.product_id IS NULL`) y los productos con `deleted_at`, porque no tienen fila de catálogo con la que nombrarlos. Quedan fuera también de `total_amount`.
- Sin ventas en el período: `products: []` y `total_amount: "0.00"`.

**Fuera de alcance de PCRM-172** (no pedir todavía): ABC, participación, penetración, productos sin movimiento, detalle por producto, margen e inventario.

### 8. `GET /routes` y `GET /routes/:id` — métricas por ruta (PCRM-178)

Ranking de rutas y detalle de una ruta. Misma query común (`from`, `to`) que el resto del panel.

**Atribución de la venta.** Es **la misma regla que la KPI global `route_effectiveness`** (CLAUDE.md 5.4), escrita una sola vez en `src/repositories/metrics/routeSales.sql.ts` y compartida por las dos: venta confirmada (`deleted_at IS NULL`, `erp_status = 2`, fechada por `erp_created_at`) **unida a una visita que lleva `route_user_id`**. Una venta sin `visit_id`, o colgada de una visita fuera de ruta, no es venta de ruta y no aparece en ningún número de estos endpoints.

**Identidad de la ruta.** `route_id` es `route.id`, el mismo uuid que expone la API de rutas (`/api/v1/routes`), así que la fila del ranking enlaza directo con la pantalla de configuración de la ruta. La venta no guarda ruta: llega a ella por `sale.visit_id → visit.route_user_id → route_user.route_id`. Por eso cada query une `route_user`, que es quien traduce la asignación al id de ruta. `route_user.deleted_at` **no** se filtra: una asignación reasignada después igual ejecutó las visitas de su período, y la KPI global también las cuenta.

**Qué no trae.** `average_ticket` por ruta es PCRM-176 / issue #56, no está en estos endpoints. El denominador que esa issue necesita (facturas distintas) ya lo calcula `findRouteSalesTotals` en `src/repositories/routeMetrics.repository.ts`; #56 lo importa en lugar de reescribir el SQL.

#### `GET /routes` — ranking

```json
{
  "period": { "...": "..." }, "thresholds": { "...": "..." },
  "routes": [
    {
      "route_id": "…", "name": "Zona Escalón", "municipality": "San Salvador", "zone": "Escalón", "active": true,
      "amount": "9170.00", "units": "1240.0000",
      "amount_position": 1, "units_position": 2,
      "executed_route_days": 7, "effectiveness": "1310.00",
      "visited_customers": 18, "planned_customers": 20, "visit_coverage_rate": 90.0,
      "stops_executed": 72, "stops_planned": 80,
      "sellers": [{ "user_id": "…", "name": "Carlos Martínez" }]
    }
  ],
  "total_amount": "12000.00",
  "total_units": "1500.0000"
}
```

| Campo | Notas |
|---|---|
| `amount` | Venta atribuida a la ruta en el período, IVA incluido |
| `units` | `SUM(quantity × COALESCE(factor, 1))` de las líneas de esas ventas, en la unidad base del producto. Misma regla que `/products` |
| `amount_position` / `units_position` | Posición 1 en adelante entre **todas** las rutas; los empates se rompen por nombre. En el detalle es la posición real de la ruta, no un 1 de 1 |
| `executed_route_days` | Jornadas ejecutadas: pares distintos (asignación, día local) con al menos una visita. Misma unidad que la KPI global |
| `effectiveness` | `amount / executed_route_days`. **`null`** si la ruta no se ejecutó ningún día: no hay división por cero |
| `visited_customers` | Clientes distintos visitados en la ruta durante el período |
| `planned_customers` | Clientes distintos en la agenda (`scheduled_visit`) de la ruta en el período. Una parada sobre prospecto suma parada planificada pero no cliente planificado |
| `visit_coverage_rate` | `visited_customers / planned_customers × 100`. **`null`** sin agenda. Puede pasar de 100 % si la ruta visitó clientes que no estaban agendados |
| `stops_executed` / `stops_planned` | Visitas marcadas y paradas agendadas de la ruta en el período |
| `sellers` | Vendedores que la operan: los asignados hoy, más quien ejecutó alguna parada en el período (una reasignación a mitad de período no borra a quien hizo el trabajo) |
| `total_amount` / `total_units` | Suma de **todas** las rutas en el período |

- Ordenado por `amount` descendente.
- Aparecen todas las rutas no borradas, incluidas las que no tuvieron actividad: llegan en ceros, con `effectiveness: null` y `sellers: []`. Nunca un 500.
- **`total_amount` no cuadra con `total_sales` del panel, y es correcto**: `total_sales` incluye la venta sin visita, que no es atribuible a ninguna ruta (Anexo A.2). `total_amount ≤ total_sales` siempre.

#### `GET /routes/:id` — detalle

`:id` es el `route.id`. Si no existe o está borrada, `404`.

```json
{
  "period": { "...": "..." }, "thresholds": { "...": "..." },
  "route": { "...misma forma que una fila de /routes..." },
  "previous": {
    "period": { "from": "2026-08-02", "to": "2026-08-31" },
    "amount": "8100.00",
    "change_rate": 13.2
  },
  "portfolio_coverage": { "assigned_customers": 20, "purchasing_customers": 14, "rate": 70.0 },
  "top_customers": [
    { "position": 1, "customer_id": "…", "name": "Farmacia San José", "trade_name": null,
      "amount": "2100.00", "orders_count": 9 }
  ],
  "top_products": [
    { "position": 1, "product_id": 42, "code": "ABC-1", "name": "Producto X",
      "amount": "1500.00", "units": "120.0000" }
  ],
  "sales_by_weekday": [
    { "weekday": 0, "amount": "0.00", "orders_count": 0 },
    { "weekday": 1, "amount": "9170.00", "orders_count": 72 }
  ],
  "seller_performance": [
    { "user_id": "…", "name": "Carlos Martínez", "amount": "9170.00", "units": "1240.0000", "orders_count": 72 }
  ]
}
```

| Bloque | Notas |
|---|---|
| `previous` | Período anterior de igual largo. `change_rate` es la variación % de `route.amount` contra `previous.amount`; **`null` si el período anterior vendió cero**, porque crecer desde cero no tiene tasa |
| `portfolio_coverage` | Clientes que componen la ruta hoy (`route_customer` vigente) y cuántos compraron en el período. **Distinta de `visit_coverage_rate`**: aquí cuenta cualquier venta confirmada del cliente, con visita o sin ella — la pregunta es si la cartera está comprando, no si la ruta se lleva el crédito. `rate` es `null` sin cartera asignada |
| `top_customers` | Hasta 10 clientes por monto atribuido. Las ventas sin cliente quedan fuera de la lista pero siguen dentro del total de la ruta |
| `top_products` | Hasta 10 productos por monto. Mismas reglas que `/products`: IVA incluido, líneas fechadas por su venta, unidades en la unidad base, sin líneas huérfanas ni productos borrados |
| `sales_by_weekday` | Siempre 7 buckets, ceros incluidos. `weekday` es el `DOW` de Postgres sobre el **día local**: 0 domingo … 6 sábado |
| `seller_performance` | Lista, no serie de gráfico. La venta se acredita a `sale.user_id`, el vendedor del ERP, igual que en `/sellers`. Solo aparecen vendedores con venta atribuida en la ruta |
---

## Qué consume cada pantalla

| Pantalla | Endpoints |
|---|---|
| `1a` Resumen (Home) | `/kpis/values?names=stops_executed,average_ticket,customers_without_visit,new_prospects` (con deltas) y `/trends` para "Paradas por semana" |
| `1d` Panel de métricas | `/kpis/values?names=stops_executed,average_ticket,average_monthly_sales,route_effectiveness` y `/sellers` |
| `1e` Tendencias | `/trends`, `/coverage`, `/purchase-frequency` |
| `1f` Desempeño del equipo | `/sellers`, y `/sellers/:id` al expandir una fila |
| `1v` Tablet | `/kpis/values?names=stops_executed,average_ticket,average_monthly_sales,purchase_frequency_days` y `/sellers` |

---

## Constantes (van al manual técnico, CLAUDE.md 5.8)

| Constante | Valor | Dónde vive | Configurable |
|---|---|---|---|
| Umbral de inactividad | 30 días (**provisional**, pendiente de firma del cliente) | `INACTIVITY_THRESHOLD_DAYS` en `src/config/envs.ts` | Sí: variable de entorno, o `?inactivity_days=` por petición |
| Plazo de crédito | 60 días | `src/domain/constants/businessRules.ts` | No |
| Estado de venta válido | `erp_status = 2` | `businessRules.ts` | No |
| Ventas de contado | `payment_id = 1`, excluidas de cobranza | `businessRules.ts` | No |
| Radio GPS | 80 m | `src/services/visit.service.ts` | No |
| Zona horaria | `America/El_Salvador` | `BUSINESS_TIMEZONE` en `src/config/envs.ts` | Sí, por entorno (validada al arrancar). Cambiarla mueve de día todo el histórico |

---

## Advertencias de interpretación

1. **`goal_compliance` compara la venta del rango contra la meta del mes completo.** Un rango de medio mes muestra cerca del 50 % aunque el vendedor vaya al día. Para leer cumplimiento, usar rangos de meses completos.
2. **`route_effectiveness` es dinero**, como en el wireframe `1d` ("$1,180 · venta generada / ruta ejecutada"). `Contexto_KPIs` §4.1 la definía como `COUNT(venta)/COUNT(visita)`. Pendiente de confirmar con el PO; mientras tanto, la razón en conteo se obtiene de `orders_count` y `stops_executed`.
3. **La venta sin `visit_id` no es venta de ruta** (CLAUDE.md 5.4, Anexo A.2). Por eso `route_sales` ≤ `total_sales`.
4. **`goal` no tiene RF ni CRUD** (Anexo B #6). En producción, `goal_compliance` vale `null` hasta que alguien cargue metas.
5. **Excluidos a propósito:** días promedio de mora (la carga histórica produce ceros falsos, Anexo A.1), cobertura de ruta a nivel gerencial ("no va"), y todo lo retirado en `Contexto_KPIs` §4.5.
