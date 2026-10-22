# API de Reportes de KPIs (RF-09)

Descarga de los indicadores del panel de métricas como **Excel (.xlsx)** o **PDF**, con gráficas y las tablas de datos usadas. Un reporte por cada endpoint de [`METRICS_API.md`](./METRICS_API.md), alimentado por la misma función del service: **un reporte no puede diferir del panel**. Solo **Administrador**.

Código: `src/services/report.service.ts` (orquestación), `src/services/reports/*.report.ts` (un builder por reporte: respuesta de métricas → `ReportDefinition`), `src/lib/reports/` (renderizadores xlsx y pdf), `src/presentation/reports/`, `src/domain/types/report.types.ts`.

---

## Convenciones

- Base: `/api/v1/reports`. Headers: `x-api-key` + `Authorization: Bearer <token>`.
- **Éxito = el archivo**, no el envelope: `200` con `Content-Type` del formato, `Content-Disposition: attachment; filename="…"` y `Cache-Control: no-store`.
- **Error = JSON** con el envelope de siempre (`400`, `401`, `403`, `404`, `500`). Distinguir por status code antes de tratar la respuesta como blob.
- Nombre del archivo: `pragma-crm_<reporte>_<from>_<to>.<xlsx|pdf>`.

### Query

La misma de cada endpoint de métricas (`from`, `to`, `inactivity_days`, y `names` / `limit` / `granularity` donde aplican, con los mismos defaults y validaciones), más:

| Param | Valores | Default |
|---|---|---|
| `format` | `xlsx` \| `pdf` | `xlsx` |

## Endpoints

| Reporte | Endpoint | Métrica de origen | Gráficas |
|---|---|---|---|
| KPIs | `GET /reports/kpis` | `/metrics/kpis/values` (`names` opcional) | Barras actual vs. anterior por unidad (dinero, conteo, %, minutos, días) + dona de paradas por tipo |
| Un KPI | `GET /reports/kpis/:name` | `/metrics/kpis/:name` | Igual que el anterior, con un solo KPI. Nombre desconocido → `404` |
| Desempeño por vendedor | `GET /reports/sellers` | `/metrics/sellers` | Venta por vendedor, cumplimiento de meta, paradas por tipo (apiladas) |
| Detalle de vendedor | `GET /reports/sellers/:id` | `/metrics/sellers/:id` | Venta semanal, paradas por semana, dona de paradas por tipo. Incluye la tabla de clientes sin visita |
| Tendencias | `GET /reports/trends` | `/metrics/trends` (`granularity=week\|month`) | Venta, paradas y pedidos, ticket promedio por semana o mes |
| Cobertura | `GET /reports/coverage` | `/metrics/coverage` | Dona visitados vs. no visitados. Lista de clientes con coordenadas (no visitados primero) |
| Productos | `GET /reports/products` | `/metrics/products` (`limit`) | Top 15 por monto; la tabla trae las `limit` filas |
| Frecuencia de compra | `GET /reports/purchase-frequency` | `/metrics/purchase-frequency` | Histograma de clientes por días entre compras |

`GET /metrics/kpis` (catálogo) no tiene reporte: no calcula nada.

## Contenido de los archivos

**Excel.** Hoja `Resumen` (logo, periodo, parámetros y umbrales usados, indicadores clave, índice y notas), hoja `Gráficas` con **gráficas nativas de Excel ligadas a las celdas** de las hojas de datos, y una hoja por tabla. Las celdas guardan números y fechas reales con formato, no texto, para que el cliente pueda sumar, filtrar o hacer tablas dinámicas. Fechas en hora de El Salvador.

**PDF.** A4 (horizontal en los reportes de vendedores), mismo contenido: encabezado con logo, indicadores clave, gráficas vectoriales y la sección **Datos utilizados** con las tablas. Algunas columnas secundarias (IDs, coordenadas) solo van en el Excel.

Ambos formatos salen del mismo `ReportDefinition`, así que muestran las mismas cifras.

## Uso desde el dashboard

```ts
const res = await fetch(`${API}/api/v1/reports/sellers?from=2026-09-01&to=2026-09-30&format=pdf`, {
  headers: { 'x-api-key': KEY, Authorization: `Bearer ${token}` },
});
if (!res.ok) throw new Error((await res.json()).message);
const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1];
const url = URL.createObjectURL(await res.blob());
Object.assign(document.createElement('a'), { href: url, download: filename }).click();
URL.revokeObjectURL(url);
```

CORS expone `Content-Disposition` (`exposedHeaders` en `server.ts`), así que el nombre es legible desde el origen del dashboard.

## Notas

- El contenido de los archivos está en español aunque el código esté en inglés: el archivo es lo que lee el cliente y no hay frontend que lo traduzca (excepción a la convención de la sección 11 de `CLAUDE.md`).
- Cada reporte imprime en sus notas los supuestos que cambian las cifras: umbral de inactividad, plazo de crédito, estado 2 de venta, atribución de venta a ruta vía visita, zona horaria.
- Sin dependencias con costo: `exceljs`, `jszip` y `pdfmake` son MIT. El PDF usa las fuentes estándar de PDF (Helvetica), no lee archivos de disco.

---

## Reportes gerenciales (PCRM-159)

Los reportes detallados que pide el doc **Especificaciones CRM**. A diferencia de los anteriores, **no espejan un endpoint de métricas**: cada uno tiene su propio SQL (`src/repositories/reports/`), construido sobre los mismos fragmentos (`repositories/metrics/fragments.sql.ts`) y la misma atribución de venta a ruta (`attributedSalesCte`). Por eso aceptan filtros que el panel no tiene y, aun así, sin filtros suman lo mismo que las KPIs del panel para el mismo rango (lo verifica `__tests__/integration/managementReports.integration.test.ts`). Los 8 reportes anteriores no cambian.

Código: `src/services/managementReport.service.ts`, `src/services/reports/management/*.report.ts` (builders), `src/repositories/reports/*.sql.ts`, `src/presentation/reports/management.routes.ts`.

### Filtros

Además de `from`, `to`, `inactivity_days` y `format`:

| Param | Qué filtra |
|---|---|
| `zone` | `route.zone` de la ruta a la que se atribuye la venta o la visita. Sin distinguir mayúsculas ni espacios. El importador nunca llena `customer.zone`, por eso la zona (y el municipio) salen de la ruta |
| `user_id` | El vendedor: `sale.user_id` en ventas y créditos, `visit.user_id` en visitas, `route_user.user_id` en la agenda |
| `route_id` | La ruta atribuida (venta → visita → parada de la agenda → ruta, CLAUDE.md 5.4) |

Se combinan con AND. Un `user_id` o `route_id` inexistente responde `404` (`Seller not found` / `Route not found`), no un archivo vacío. Un rango sin datos sí genera el archivo, con la leyenda **"Sin datos para el período."**. El encabezado imprime los filtros aplicados y **"Generado por"** con el nombre del admin.

### Endpoints

| Reporte | Endpoint | Archivo | Filas | Filtros |
|---|---|---|---|---|
| Ventas por vendedor / cliente / municipio / ruta / zona / producto | `GET /reports/sales/:group` (`seller\|customer\|municipality\|route\|zone\|product`) | `ventas-por-<grupo>` | Monto, pedidos, ticket, clientes, % del total. Las ventas sin ruta atribuible quedan en su propia fila | Todos |
| Comparativo entre vendedores | `GET /reports/sales/sellers-comparison` | `comparativo-vendedores` | Venta y pedidos del periodo vs. el anterior de igual duración | Todos |
| ABC de clientes / productos | `GET /reports/abc/:entity` (`customer\|product`) | `abc-clientes`, `abc-productos` | Pareto: A hasta 80% acumulado, B hasta 95%, C el resto | Todos |
| Rankings generales | `GET /reports/rankings?limit=` (1–500, default 50) | `rankings` | Tres tablas: vendedores, clientes, productos | Todos |
| Cumplimiento de metas | `GET /reports/goals` | `cumplimiento-de-metas` | Meta prorrateada vs. venta por vendedor (`goalSlicesCte`, igual que la KPI) | Solo `user_id` |
| Visitas realizadas vs. planificadas | `GET /reports/visits/planned-vs-done` | `visitas-planificadas-vs-realizadas` | Por vendedor y ruta: paradas planificadas y realizadas, extra, fuera de agenda | Todos |
| Efectividad de visitas | `GET /reports/visits/effectiveness` | `efectividad-de-visitas` | Por vendedor: visitas a clientes, con pedido (`sale.visit_id`), % y lo autodeclarado | Todos |
| Clientes nuevos | `GET /reports/customers/new` | `clientes-nuevos` | Clientes cuya primera venta confirmada cae en el rango | Todos |
| Clientes recuperados | `GET /reports/customers/recovered` | `clientes-recuperados` | Misma regla que la KPI, con `inactivity_days` | Todos |
| Clientes sin compra 30/60/90 | `GET /reports/customers/no-purchase` | `clientes-sin-compra` | Clientes activos con última compra hace más de 30 días, por tramo | Ruta y zona por `route_customer`; vendedor de la última venta |
| Cobranza por vendedor | `GET /reports/collections` | `cobranza-por-vendedor` | Cobrado en el periodo, saldo pendiente y vencido al día de hoy | Todos |
| Cartera vencida | `GET /reports/overdue-portfolio` | `cartera-vencida` | Por factura, por cliente y por antigüedad; foto al día de hoy | Todos (el rango no aplica) |

### Supuestos que conviene conocer

- **Cobranza.** Efactsoft no informa pagos, solo el saldo de cada factura en cada carga (`balance_snapshot`). "Cobrado" suma las bajas de saldo entre dos cargas consecutivas cuando la más reciente cae en el periodo: la fecha es la de la carga, no la del pago.
- **Planificadas.** La agenda de un día se genera cuando alguien abre ese día en la app (PCRM-161); un día que nadie abrió no suma planificadas.
- **Cartera vencida y saldos** son al día de hoy, con el mismo criterio que las KPIs `overdue_portfolio` y `pending_collections` (venta confirmada, sin contado, plazo de 60 días).
