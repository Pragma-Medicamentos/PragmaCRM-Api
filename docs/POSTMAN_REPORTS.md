# Probar los reportes de KPIs en Postman

Todos los endpoints son **GET** y **no llevan body**. Para los detalles de diseño, ver [`REPORTS_API.md`](./REPORTS_API.md).

## Configuración

Variables de colección:

| Variable | Valor |
|---|---|
| `baseUrl` | `http://localhost:3000` |
| `apiKey` | el `API_KEY` de tu `.env` |
| `token` | `access_token` de un usuario **Administrador** |

Headers obligatorios en **todas** las peticiones:

| Header | Valor |
|---|---|
| `x-api-key` | `{{apiKey}}` |
| `Authorization` | `Bearer {{token}}` |

### Ver el archivo

La respuesta es binaria. En Postman, usa **Send and Download** (flecha junto a *Send*) para guardar el archivo y abrirlo en Excel o en un lector de PDF. Con *Send* normal, Postman intenta mostrarlo y el `.xlsx` se ve como texto ilegible.

En la pestaña **Headers** de la respuesta deberías ver:

| Header | xlsx | pdf |
|---|---|---|
| `Content-Type` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `application/pdf` |
| `Content-Disposition` | `attachment; filename="pragma-crm_<reporte>_<from>_<to>.xlsx"` | `… .pdf"` |
| `Cache-Control` | `no-store` | `no-store` |

### Query params comunes

Todos son opcionales en todos los endpoints:

| Param | Formato | Default |
|---|---|---|
| `format` | `xlsx` \| `pdf` | `xlsx` |
| `from` | `YYYY-MM-DD` | primer día del mes en curso |
| `to` | `YYYY-MM-DD` | último día del mes de `from` (rango máximo de 366 días) |
| `inactivity_days` | entero de 1 a 365 | `30` (`INACTIVITY_THRESHOLD_DAYS`) |

---

## 1. Reporte de KPIs

```
GET {{baseUrl}}/api/v1/reports/kpis
```

Param extra: `names`, una lista de KPIs separados por coma (si se omite, salen los 17).

Ejemplos:

```
{{baseUrl}}/api/v1/reports/kpis?from=2026-09-01&to=2026-09-30&format=xlsx
{{baseUrl}}/api/v1/reports/kpis?from=2026-09-01&to=2026-09-30&format=pdf
{{baseUrl}}/api/v1/reports/kpis?names=total_sales,orders_count,average_ticket,stops_by_type&format=pdf
```

Nombres válidos: `stops_executed`, `stops_by_type`, `visited_customers`, `effective_visits_rate`, `average_visit_minutes`, `total_sales`, `orders_count`, `average_ticket`, `average_monthly_sales`, `route_effectiveness`, `goal_compliance`, `customers_without_visit`, `recovered_customers`, `new_prospects`, `purchase_frequency_days`, `overdue_portfolio`, `pending_collections`.

Archivo: `pragma-crm_kpis_<from>_<to>.<ext>`

---

## 2. Reporte de un KPI

```
GET {{baseUrl}}/api/v1/reports/kpis/:name
```

Ejemplos:

```
{{baseUrl}}/api/v1/reports/kpis/total_sales?from=2026-09-01&to=2026-09-30
{{baseUrl}}/api/v1/reports/kpis/overdue_portfolio?format=pdf
```

Archivo: `pragma-crm_kpi_<name>_<from>_<to>.<ext>`

---

## 3. Desempeño por vendedor

```
GET {{baseUrl}}/api/v1/reports/sellers
```

Ejemplo:

```
{{baseUrl}}/api/v1/reports/sellers?from=2026-09-01&to=2026-09-30&format=pdf
```

Archivo: `pragma-crm_vendedores_<from>_<to>.<ext>`

---

## 4. Detalle de un vendedor

```
GET {{baseUrl}}/api/v1/reports/sellers/:id
```

`:id` es el UUID de `app_user.id`. Para obtenerlo, toma el campo `user_id` de `GET {{baseUrl}}/api/v1/metrics/sellers`.

Ejemplo:

```
{{baseUrl}}/api/v1/reports/sellers/11111111-1111-1111-1111-111111111101?from=2026-09-01&to=2026-09-30&inactivity_days=30&format=pdf
```

Archivo: `pragma-crm_vendedor_<nombre-normalizado>_<from>_<to>.<ext>`

---

## 5. Tendencias

```
GET {{baseUrl}}/api/v1/reports/trends
```

Param extra: `granularity`, que acepta `week` o `month` (default `week`).

Ejemplos:

```
{{baseUrl}}/api/v1/reports/trends?from=2026-07-01&to=2026-09-30&granularity=week
{{baseUrl}}/api/v1/reports/trends?from=2026-01-01&to=2026-09-30&granularity=month&format=pdf
```

Archivo: `pragma-crm_tendencias_semanal_<from>_<to>.<ext>` (o `_mensual_`)

---

## 6. Cobertura de cartera

```
GET {{baseUrl}}/api/v1/reports/coverage
```

Ejemplo:

```
{{baseUrl}}/api/v1/reports/coverage?from=2026-09-01&to=2026-09-30&format=xlsx
```

Archivo: `pragma-crm_cobertura_<from>_<to>.<ext>`

---

## 7. Productos más vendidos

```
GET {{baseUrl}}/api/v1/reports/products
```

Param extra: `limit`, un entero de 1 a 500 (default `50`).

Ejemplos:

```
{{baseUrl}}/api/v1/reports/products?from=2026-09-01&to=2026-09-30
{{baseUrl}}/api/v1/reports/products?limit=100&format=pdf
```

Archivo: `pragma-crm_productos_<from>_<to>.<ext>`

---

## 8. Frecuencia de compra

```
GET {{baseUrl}}/api/v1/reports/purchase-frequency
```

Ejemplo:

```
{{baseUrl}}/api/v1/reports/purchase-frequency?from=2026-07-01&to=2026-09-30&format=pdf
```

Archivo: `pragma-crm_frecuencia-compra_<from>_<to>.<ext>`

---

## Casos de error que conviene probar

Los errores siempre vuelven en **JSON**, no como archivo:

| Petición | Esperado |
|---|---|
| Cualquiera sin `Authorization` | `401` |
| Cualquiera sin `x-api-key` | `401`, `Invalid or missing API key` |
| Cualquiera con el token de un **Vendedor** | `403` |
| `/reports/coverage?format=csv` | `400`, `errors[].field = "format"` |
| `/reports/sellers?from=2026-09-30&to=2026-09-01` | `400`, `errors[].field = "from"` |
| `/reports/sellers?from=2025-01-01&to=2026-09-30` | `400`, el rango excede 366 días |
| `/reports/kpis?names=foo` | `400`, KPI desconocido |
| `/reports/kpis/foo` | `404`, `Unknown KPI "foo"…` |
| `/reports/sellers/not-a-uuid` | `400`, `Invalid seller id` |
| `/reports/sellers/00000000-0000-0000-0000-000000000000` | `404`, `Seller not found` |
| `/reports/products?limit=0` | `400` |
| `/reports/trends?granularity=day` | `400` |
