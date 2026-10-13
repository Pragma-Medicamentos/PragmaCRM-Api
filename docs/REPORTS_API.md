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
