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
| `kpis` | lista separada por coma | todas | **Solo en `/kpis`.** Ver endpoint 1 |

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

### 1. `GET /kpis` — tarjetas de empresa (`1a`, `1d`, `1v`)

**Selección de KPIs (opcional):** `?kpis=` con los nombres separados por coma, o el parámetro repetido.

```
GET /kpis?kpis=stops_executed,average_ticket,customers_without_visit,new_prospects   ← Home (1a)
GET /kpis                                                                            ← Panel (1d): las 17
```

- Sin el parámetro devuelve las 17. Con él, `kpis` trae **solo** las pedidas, en el orden pedido.
- Los duplicados se ignoran. Un nombre desconocido o una lista vacía → `400` (`errors[].field` empieza con `kpis`).
- Nombres válidos: los 17 de la tabla de abajo (`KPI_NAMES` en `src/domain/schemas/metrics.schema.ts`).
- El cálculo es el mismo pidas una o todas: las KPIs del período salen de una sola query. Lo que se ahorra es respuesta, y además se omite la query de cartera si no pides `overdue_portfolio` ni `pending_collections` (y las del período si solo pides esas dos).
- En TypeScript el tipo es `Partial<CompanyKpis>`: el frontend debe tratar cada tarjeta como opcional.

Cada KPI viene como `{ value, previous_value }`. `previous_value` es el mismo KPI en el período anterior de igual duración (`previous_period`), para los deltas del Home ("+8 %"). Los KPIs *foto* (cartera) tienen `previous_value: null`.

```json
{
  "period": { "from": "2026-09-01", "to": "2026-09-30" },
  "previous_period": { "from": "2026-08-02", "to": "2026-08-31" },
  "thresholds": { "inactivity_days": 30, "credit_term_days": 60, "gps_radius_meters": 80 },
  "kpis": {
    "stops_executed":          { "value": 248, "previous_value": 231 },
    "stops_by_type":           { "value": { "visit": 160, "dispatch": 60, "collection": 28 }, "previous_value": { "...": 0 } },
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

---

## Qué consume cada pantalla

| Pantalla | Endpoints |
|---|---|
| `1a` Resumen (Home) | `/kpis?kpis=stops_executed,average_ticket,customers_without_visit,new_prospects` (con deltas) y `/trends` para "Paradas por semana" |
| `1d` Panel de métricas | `/kpis` (`stops_executed`, `average_ticket`, `average_monthly_sales`, `route_effectiveness`) y `/sellers` |
| `1e` Tendencias | `/trends`, `/coverage`, `/purchase-frequency` |
| `1f` Desempeño del equipo | `/sellers`, y `/sellers/:id` al expandir una fila |
| `1v` Tablet | `/kpis` (+ `purchase_frequency_days`) y `/sellers` |

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
