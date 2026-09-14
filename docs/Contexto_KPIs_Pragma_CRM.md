# Pragma CRM — Contexto de KPIs, métricas y clasificación A/B/C

**Uso:** documento de contexto para sesiones de backend. Contiene el catálogo completo de KPIs considerados hasta hoy, su estado de alcance, la fórmula de cálculo contra el modelo real, y el detalle de la clasificación A/B/C de clientes (pantallas `1n` / `1o`).

**Fuentes:** `Especificaciones_CRM.docx` (secciones 1, 2, 3, 5) · `Guia_KPIs_Pragma_CRM.md` (reporte de verificación, 7 sept 2026) · `PCRM - Diagrama ER` (versión 7 sept 2026) · `Wireframes_Pragma_CRM_y_App.html` (web `1a`–`1y`, móvil `1`–`16`) · `GPI - Pragma CRM - Primer Avance` (RF-01 a RF-14).

**Motor:** PostgreSQL 15+ con PostGIS. Autorización vía Supabase RLS (`auth.jwt() ->> 'sub'`); autenticación en Clerk.

---

## 1. Vocabulario acordado con el cliente

El cliente fijó esta distinción en `Especificaciones_CRM.docx` y hay que respetarla al nombrar endpoints y tablas:

| Término | Significado |
|---|---|
| **KPI** | Lo que el usuario ve en el dashboard (tarjeta numérica). |
| **Reporte** | Información detallada, filtrable, exportable. |
| **Métrica** | El dato base que el sistema registra para poder calcular KPIs y reportes. |

Implicación práctica: los "reportes" de la sección 3 de la especificación **no requieren cálculos nuevos**. Son los mismos agregados con distinto filtro o nivel de detalle. No hay que diseñar queries aparte.

---

## 2. Constantes y supuestos que afectan a varios indicadores

Ninguna vive en el modelo de datos. Deben quedar en el manual técnico, no solo como comentario en código.

| Constante | Valor | Impacto si cambia |
|---|---|---|
| **Plazo de crédito** | 60 días desde `venta.fecha_creacion` | Uniforme para todos los clientes, sin columna en BD. Cartera vencida y días de mora se recalculan retroactivamente sobre todo el histórico. |
| **Umbral de inactividad** | **Pendiente de definir** | Determina clientes inactivos, clientes recuperados y "clientes sin visita". La especificación menciona cortes de 30/60/90 días para el *reporte*, pero no fija cuál usan los *KPIs*. El wireframe `1f` usa 30 días. |
| **Radio de validación GPS** | 80 m | Tomado del wireframe `1p`. No está persistido por visita: cambiar el radio recalcula todo el histórico de alertas "fuera de radio". |
| **Zona horaria** | `America/El_Salvador` | Todo cruce entre `timestamptz` y `date` debe convertirse explícitamente. Sin conversión, las ventas facturadas después de las 6:00 p.m. se atribuyen al día siguiente y rompen la venta por ruta. |
| **Estado de venta válido** | `venta.estado_erp = 2` | Estado 1 es cotización sin procesar. Todo cálculo de venta, ticket, conversión y efectividad excluye estado 1. El wireframe `1o` las muestra por separado con filtro "Solo cotizaciones". |
| **Ventas de contado** | Excluidas de cobranza | Nacen con `saldop = 0` y distorsionan cartera vencida, mora y días promedio de pago. El criterio de identificación se define sobre `venta.pago` / `venta.id_pago`, que llegan como texto libre desde Efactsoft. **Criterio aún no definido.** |
| **Base monetaria** | Ver §7, discrepancia D-1 | `venta.total` (con impuestos) vs `venta.total_neto`. Los KPIs de venta usan `total`; la columna "Compras (neto)" de `1n` usa `total_neto`. |

---

## 3. Entidades del DER relevantes para KPIs

| Entidad | Campos que alimentan indicadores |
|---|---|
| `venta` | `id_venta_erp` (PK), `cliente_id`, `usuario_id`, `visita_id`, `fecha_creacion`, `ultimo_pago_en`, `total`, `total_neto`, `iva`, `saldop`, `pago`, `id_pago`, `estado_erp`, `documento`, `ausente` |
| `venta_detalle` | `id_venta_erp` (FK), `producto_id`, `cantidad`, `precio`, `total`, `total_imp` |
| `visita` | `cliente_id`, `usuario_id`, `ruta_programada_id`, `iniciada_en`, `finalizada_en`, `ubicacion_checkin`, `distancia_metros`, `tipo_visita`, `visita_exitosa`, `motivo_no_pedido`, `notas` |
| `cliente` | `id_cliente_erp`, `nombre`, `nombre_comercial`, `tipo_establecimiento`, `municipio`, `zona`, `ubicacion`, `credito`, `limite_credito`, `activo`, `personalidad`, `potencial`, `atiende`, `creado_en` |
| `ruta_cliente` | `ruta_id`, `cliente_id`, `orden`, `created_at`, `updated_at`, `deleted_at` — base de planificación |
| `ruta_usuario` | `ruta_id`, `usuario_id`, `fecha`, `estado`, `creado_en` — asignación vendedor↔ruta |
| `meta` | `usuario_id`, `anio`, `mes`, `monto_meta` |
| `prospecto` | `usuario_id`, `estado`, `creado_en` |
| `usuario` | `id_usuario_erp`, `clerk_user_id`, `rol`, `activo` |

**Nota sobre `venta`:** no tiene `deleted_at`. El patrón `AND deleted_at IS NULL` que aparece de forma genérica en la guía de KPIs solo aplica a `ruta_cliente`. No lo copies a queries de venta.

---

## 4. Catálogo de KPIs en alcance

### 4.1 KPIs de Gerencia (panel `1d` / `1e`, RF-09)

Todos admiten filtro por rango de fechas. Filtro base: `venta.estado_erp = 2`.

| KPI | Cálculo |
|---|---|
| **Ventas del mes** | `SUM(venta.total)` con `fecha_creacion` dentro del mes. |
| **Ventas del año** | Idéntico, con rango anual. Un solo query parametrizado sirve para ambos. |
| **Cumplimiento de meta (%)** | `SUM(venta.total) / SUM(meta.monto_meta) × 100`, uniendo `meta` por `usuario_id` + `anio` + `mes`. La meta global de la empresa es la suma de las metas individuales del período. |
| **Ticket promedio** | `AVG(venta.total)` = `SUM(total) / COUNT(venta)`. |
| **Número de pedidos / Efectividad de ruta** | Numerador `COUNT(venta)`, denominador `COUNT(visita)`. La atribución a ruta se resuelve en runtime (§6, cruce X-2). |
| **Clientes visitados** | `COUNT(DISTINCT visita.cliente_id)`. Marcado *"no va"* como tarjeta gerencial, pero se conserva como métrica base porque alimenta cobertura y efectividad. |
| **Clientes recuperados** | `LAG` sobre `venta.fecha_creacion` particionado por `cliente_id`. Es recuperado si el hueco contra la compra anterior supera el umbral de inactividad. |
| **Cartera vencida** | `SUM(venta.saldop)` donde `saldop > 0` y `fecha_creacion + interval '60 days' < now()`. Excluye contado. |
| **Nuevos prospectos** | `COUNT(prospecto)` por `creado_en`, agrupable por `usuario_id`. |

### 4.2 KPIs del Vendedor (móvil pantalla `11` "Mis métricas", web `1f`)

Todos filtrados por el `usuario_id` de la sesión. La pantalla móvil `11` es **solo lectura y muestra exactamente los mismos números que ve el administrador** — no debe existir un segundo cálculo.

| KPI | Cálculo |
|---|---|
| **Cumplimiento de meta (%)** | `SUM(venta.total) WHERE usuario_id = sesión` contra `meta.monto_meta` del mes. El vínculo con Efactsoft es `usuario.id_usuario_erp`. |
| **Pedidos realizados** | `COUNT(venta) WHERE usuario_id = sesión`. |
| **Clientes visitados** | `COUNT(DISTINCT visita.cliente_id) WHERE visita.usuario_id = sesión`. |
| **Cobertura de ruta (%)** | Paradas ejecutadas sobre planificadas. El plan se reconstruye con `generate_series` sobre el calendario que implica `ruta_usuario`, uniendo `ruta_cliente` vigente a esa fecha; la ejecución sale de `visita`. Un `LEFT JOIN` deja al descubierto las paradas no marcadas. |
| **Cobros pendientes** | `SUM(venta.saldop) WHERE saldop > 0`, agrupado por cliente. Marcado *"no va"* pero disponible sin costo adicional. |
| **Clientes recuperados** | Igual que gerencia, filtrando por `venta.usuario_id`. |
| **Próximas visitas** | Proyección del calendario hacia adelante (`generate_series` sobre `ruta_usuario`, cruzado con `ruta_cliente` vigente). Alimenta pantallas móviles `15` y `16`. |
| **Nuevos prospectos** | `COUNT(prospecto) WHERE usuario_id = sesión`. |

### 4.3 Métricas base (sección 5 de la especificación)

**Ventas**

| Métrica | Prioridad | Cálculo |
|---|---|---|
| Venta total | Esencial | `SUM(venta.total)` |
| Venta por vendedor | Esencial | `GROUP BY venta.usuario_id` |
| Venta por ruta | Esencial | Join en runtime, cruce X-2 |
| Venta por municipio | Opcional | `GROUP BY cliente.municipio` |
| Venta por cliente | Esencial | `GROUP BY venta.cliente_id` |
| Venta por producto | Esencial | `SUM(venta_detalle.total)` y `SUM(venta_detalle.cantidad)` por `producto_id` |
| Número de pedidos | Esencial | `COUNT(venta)` |
| Ticket promedio | Esencial | `AVG(venta.total)` |

**Productividad**

| Métrica | Prioridad | Cálculo |
|---|---|---|
| Clientes visitados | Esencial | `COUNT(DISTINCT visita.cliente_id)` |
| Cobertura de ruta (%) | Esencial | Ejecutadas / planificadas, §4.2 |
| Visitas efectivas (%) | Esencial | `COUNT(visita WHERE visita_exitosa) / COUNT(visita) × 100`. Contrastable con `venta.visita_id`. |
| Tiempo promedio por visita | Opcional | `AVG(visita.finalizada_en - visita.iniciada_en)` |
| Tiempo desde la última visita | Esencial | `now() - MAX(visita.iniciada_en)` por cliente. Alimenta "Clientes sin visita en 30 días" (`1f`, móvil `11`). |

**Clientes**

| Métrica | Prioridad | Cálculo |
|---|---|---|
| Clientes activos | Esencial | Al menos una venta en el período |
| Clientes inactivos | Esencial | `cliente.activo = true` sin ventas dentro del umbral |
| Clientes recuperados | Esencial | `LAG` sobre compras; hueco mayor al umbral seguido de compra |
| Nuevos prospectos | Esencial | `COUNT(prospecto)` por `creado_en` |
| Frecuencia de compra | Esencial | Promedio de días entre compras consecutivas, `LAG` sobre `venta.fecha_creacion` por `cliente_id`. Se muestra en `1o` como "Frec. de compra". |

**Cobranza**

| Métrica | Prioridad | Cálculo |
|---|---|---|
| Cobros pendientes | Esencial | `SUM(venta.saldop) WHERE saldop > 0` |
| Cartera vencida | Esencial | `saldop > 0` y más de 60 días desde `fecha_creacion`. Excluye contado. |
| Días promedio de mora | Opcional | `(ultimo_pago_en − fecha_creacion) − 60`, promediado sobre facturas liquidadas. Ver §5.3 y la advertencia de carga histórica. |

### 4.4 Indicadores que aparecen en wireframes pero no en la especificación del cliente

Registrados aquí para que no se lean como alcance nuevo durante el sprint.

| Indicador | Pantalla | Cálculo |
|---|---|---|
| Paradas ejecutadas / Paradas del mes | `1d`, `1f`, móvil `11` | `COUNT(visita)` en el período |
| Venta promedio mensual | `1d` | `SUM(venta.total)` / cantidad de meses del rango |
| Venta / ruta | `1d` (tabla por vendedor) | Venta atribuida a ruta ÷ jornadas ejecutadas |
| Clientes sin visita | `1f`, móvil `11` | Cartera sin `visita` en los últimos N días |
| Paradas por tipo | `1f`, móvil `11` | `COUNT(visita)` con `FILTER` sobre `visita.tipo_visita` (visita / despacho / cobro) |
| Fuera de radio GPS | `1r` | `COUNT(visita)` donde `distancia_metros` supera el radio |
| Notas capturadas | `1r` | `COUNT(visita.notas)` |
| Despachos por cuenta de otros | `1f`, `1s` | Paradas que ejecuta un vendedor pero cuya venta pertenece a otro: `visita.usuario_id <> venta.usuario_id` sobre la venta vinculada |
| **Compras (neto) · Conversión · Días prom. pago** | `1n`, `1o` | **Ver §5 — son los tres insumos de la clasificación A/B/C** |

### 4.5 Retirados — no implementar

No deben reaparecer en queries, endpoints ni tarjetas:

- Clientes nuevos (omitido por decisión del cliente)
- Ranking de clientes (retirado del alcance)
- Clientes asignados (retirado)
- Monto cobrado / Cobranza del período (retirado)
- Pedidos entregados (retirado)
- Entregas a tiempo (%) (retirado)
- Devoluciones (retirado)

"Cobertura de ruta (%)" está marcada *"no va"* **a nivel gerencial**, pero se conserva en el panel del vendedor. "Clientes visitados" y "Cobros pendientes" están marcados *"no va"* como tarjeta pero se conservan como métrica base.

---

## 5. Clasificación A/B/C de clientes

### 5.1 Qué dice el wireframe

Pantalla `1n` (Clientes · listado y filtros · RF-02), nota al pie:

> "La categoría A/B/C se calcula automáticamente a partir de compras netas, conversión y días promedio de pago."

Pantalla `1o` (Perfil de cliente), encabezado:

> "Categoría A = compras netas ($12,480) + conversión (62%) + días promedio de pago (14 d). Cálculo automático."

Datos de ejemplo del listado, útiles para validar rangos:

| Cliente | Categoría | Compras (neto) | Conversión | Días prom. pago | Saldo |
|---|---|---|---|---|---|
| Farmacia San José | A | $12,480 | 62% (18/29) | 14 d | $145.00 |
| Farmacia La Fe | A | $10,905 | 71% (22/31) | 9 d | $88.00 |
| Droguería Central | B | $7,940 | 48% (12/25) | 21 d | — |
| Puesto Medicina Sur | B | $6,315 | 55% (11/20) | 18 d | $310.00 |
| Botica Del Valle | C | $1,260 | 22% (4/18) | — | $62.50 |

Observaciones de lectura directa:
- La conversión se expresa como fracción `compras / visitas`, no como porcentaje aislado.
- "Días prom. pago" admite `NULL` (Botica Del Valle) y se renderiza como `—`.
- Existe un cuarto estado de categoría: **"Sin categorizar"** (chip en el filtro de `1n`). Es el estado de un cliente sin datos suficientes.

### 5.2 Los tres insumos — definición operativa y SQL

Todos los queries asumen un parámetro de ventana `[:desde, :hasta)`. **La ventana de evaluación no está definida** (ver decisión DA-3).

#### Insumo 1 — Compras netas

```sql
SELECT v.cliente_id,
       SUM(v.total_neto) AS compras_netas
FROM   venta v
WHERE  v.estado_erp = 2
  AND  v.fecha_creacion >= :desde
  AND  v.fecha_creacion <  :hasta
GROUP  BY v.cliente_id;
```

- `venta.total_neto` es el monto sin impuestos; `venta.total` incluye IVA. La etiqueta "(neto)" del wireframe obliga a usar `total_neto` **solo aquí**. Ver discrepancia D-1.
- Excluye cotizaciones (`estado_erp = 1`), coherente con el filtro "Solo ventas" de `1o`.

#### Insumo 2 — Conversión visitas → compras

```sql
SELECT vi.cliente_id,
       COUNT(*)                                   AS visitas,
       COUNT(*) FILTER (WHERE v.id_venta_erp IS NOT NULL) AS compras,
       ROUND(100.0 * COUNT(*) FILTER (WHERE v.id_venta_erp IS NOT NULL)
             / NULLIF(COUNT(*), 0)) AS conversion_pct
FROM   visita vi
LEFT   JOIN venta v
       ON v.visita_id = vi.id
      AND v.estado_erp = 2
WHERE  vi.iniciada_en >= :desde
  AND  vi.iniciada_en <  :hasta
GROUP  BY vi.cliente_id;
```

Tres decisiones que el query hace por ti y que hay que confirmar:

1. **Numerador.** Se usa la existencia de una `venta` ligada por `venta.visita_id`, no `visita.visita_exitosa`. Son dos fuentes distintas: `visita_exitosa` lo declara el vendedor en campo; `visita_id` lo estampa el importador de Efactsoft. Si se usa `visita_exitosa` el número es una autodeclaración; si se usa `visita_id` el número es contrastable contra facturación. **Recomendado: `visita_id`**, con `visita_exitosa` como métrica de control para detectar vendedores que declaran pedido sin factura.
2. **Denominador.** El query cuenta *todas* las paradas del cliente, incluidas las de tipo `despacho` y `cobro`. Una parada de cobro nunca genera venta nueva, así que infla el denominador y castiga injustamente a clientes con muchas entregas. **Recomendado: filtrar `vi.tipo_visita = 'visita'`.** Requiere confirmación del PO.
3. **Ventas sin visita.** Una venta cuyo `visita_id` quedó `NULL` (no hubo visita ese día, o el importador no encontró coincidencia de cliente+fecha) no cuenta en el numerador aunque sí sume en compras netas. Un cliente que compra por teléfono puede mostrar conversión baja con compras altas.

#### Insumo 3 — Días promedio de pago

```sql
SELECT v.cliente_id,
       ROUND(AVG(EXTRACT(EPOCH FROM (v.ultimo_pago_en - v.fecha_creacion)) / 86400))
         AS dias_prom_pago
FROM   venta v
WHERE  v.estado_erp = 2
  AND  v.saldop = 0
  AND  v.ultimo_pago_en IS NOT NULL
  AND  v.fecha_creacion >= :desde
  AND  v.fecha_creacion <  :hasta
  -- AND NOT <es_contado(v.pago, v.id_pago)>   -- criterio pendiente, ver §2
GROUP  BY v.cliente_id;
```

- Devuelve `NULL` si el cliente no tiene ninguna factura de crédito liquidada en la ventana → se pinta `—` y el cliente cae en "Sin categorizar" si se aplica la regla de datos mínimos.
- **No confundir con "Días promedio de mora"**, que es esta misma cifra menos 60. Son dos indicadores distintos con nombres parecidos; la mora solo tiene sentido restando el plazo.
- Semántica de los timestamps (no reescribir nunca): `fecha_creacion` se estampa la primera vez que la venta llega con `estado = 2`; `ultimo_pago_en` la primera vez que llega con `estado = 2` **y** `saldop = 0`. Ambos se toman del campo `updated_at` del payload de Efactsoft, **nunca** de la hora de importación.

> **Advertencia crítica para la clasificación.** Las facturas antiguas llegan en el primer JSON ya con `estado = 2` y `saldop = 0`. Ambos timestamps se estampan con el mismo `updated_at`, y el resultado es **0 días de pago** para todo el histórico. Sin un backfill desde `fecha_emision` del payload, o sin excluir las ventas anteriores a la primera carga, **todos los clientes heredados aparecerán como pagadores perfectos** y el insumo 3 quedará inutilizable durante los primeros meses. Esto no es un detalle de un indicador opcional: corrompe directamente el tercio de la fórmula de categoría.

### 5.3 El algoritmo de clasificación no está definido

El wireframe declara que la categoría "se calcula automáticamente a partir de" los tres insumos, pero **en ningún documento del proyecto se especifica cómo se combinan ni cuáles son los cortes.** No hay RF que respalde la clasificación (RF-02 solo cubre perfil base, historial, créditos/cobros y ubicación GPS).

Tres modelos posibles, en orden de esfuerzo:

**Opción 1 — Pareto sobre compras netas, los otros dos como desempate**
A = clientes que acumulan el primer 80 % de la venta neta; B = siguiente 15 %; C = resto. Conversión y días de pago solo mueven a un cliente una letra arriba o abajo en el borde. Ventaja: reutiliza literalmente el "Reporte ABC de clientes" de la especificación. Desventaja: las letras dependen del resto de la cartera, no del cliente — un cliente puede cambiar de categoría sin cambiar su comportamiento.

**Opción 2 — Scoring ponderado con normalización (recomendada)**
Cada insumo se normaliza a 0–100 y se pondera:

```
score = 0.50 × pctl(compras_netas)
      + 0.30 × conversion_pct
      + 0.20 × (100 − min(dias_prom_pago, 60) / 60 × 100)

A: score ≥ 70    B: 40 ≤ score < 70    C: score < 40
Sin categorizar: sin ventas en la ventana, o dias_prom_pago IS NULL con < 3 facturas liquidadas
```

Contra los datos del wireframe esta forma reproduce el orden observado (La Fe y San José arriba, Del Valle abajo). **Los pesos y los cortes son una propuesta, no un acuerdo.** Requieren firma del PO y del cliente antes de codificarse.

**Opción 3 — Umbrales fijos por insumo y regla de mayoría**
Tres semáforos independientes (p. ej. compras ≥ $10k / ≥ $5k, conversión ≥ 60 % / ≥ 40 %, pago ≤ 15 d / ≤ 30 d) y la categoría es la que gana dos de tres. Ventaja: explicable al vendedor en una frase. Desventaja: los umbrales absolutos envejecen y hay que renegociarlos cada año.

### 5.4 Persistencia y refresco

- **No existe columna `categoria` en `cliente`.** La clasificación es derivada. Dos caminos:
  - Vista materializada `cliente_metricas` (compras netas, conversión, días de pago, saldo, frecuencia, última visita, categoría) refrescada al cerrar cada `carga` de JSON y al finalizar una `visita`. Es lo que conviene: los tres insumos solo cambian en esos dos eventos, y el listado `1n` pagina sobre 352 registros con filtros por categoría, tipo, zona y vendedor — calcular al vuelo obliga a agregar `venta` y `visita` en cada request.
  - Columna materializada en `cliente` más job de recálculo. Más simple de consultar, pero mete un dato derivado en una tabla de maestro que además se sincroniza desde Efactsoft.
- Si se opta por la vista materializada, los filtros de `1n` (`Tipo`, `Zona`, `Vendedor`, `Categoría`, `Sin GPS`) deben resolverse todos contra ella para no mezclar orígenes.

---

## 6. Cruces que no corresponden a una relación real

Este es el punto que dispara la mayoría de los errores de interpretación. Varios indicadores se apoyan en vínculos que el modelo no garantiza.

| ID | Cruce | Naturaleza | Riesgo |
|---|---|---|---|
| **X-1** | `venta` ↔ `visita` vía `venta.visita_id` | Existe la FK, pero **se estampa heurísticamente al importar**, cuadrando `cliente_id` + fecha. No la genera la transacción. | Una venta puede quedar sin visita (compra telefónica, visita no marcada) o atribuirse a la visita equivocada si hubo dos el mismo día. Afecta: conversión, visitas efectivas, efectividad de ruta. |
| **X-2** | `venta` ↔ `ruta` | **No hay FK.** Se resuelve en runtime cruzando `venta.usuario_id` + el día de la semana de `venta.fecha_creacion` contra la asignación en `ruta_usuario`, respetando vigencia. | Una venta de un vendedor en un día sin ruta asignada, o cuyo `id_usuario` de Efactsoft no mapea contra `usuario.id_usuario_erp`, **queda fuera del reporte de venta por ruta aunque sí sume en venta total**. El importador debe dejar un conteo de control de ambos casos para que la diferencia entre reportes sea explicable. |
| **X-3** | `cliente` ↔ categoría A/B/C | **No hay columna.** Derivada (§5.4). | El filtro "Categoría" de `1n` no puede ser un `WHERE` simple sobre `cliente`. |
| **X-4** | `cliente` ↔ vendedor responsable | **No hay FK `cliente.usuario_id`.** Se deriva por `ruta_cliente` → `ruta` → `ruta_usuario` → `usuario`. | Un cliente aparece en varias rutas (`1o` muestra "Rutas en las que aparece: Zona Escalón · Zona Centro"), así que puede tener **más de un vendedor**. El filtro "Vendedor" de `1n` necesita `EXISTS`, no igualdad, y "el vendedor del cliente" no es un concepto bien formado. |
| **X-5** | `venta` ↔ `meta` | Sin FK; join por `usuario_id` + `anio` + `mes`. | La tabla `meta` sostiene dos KPIs Esenciales y **no tiene RF que la respalde en el GPI**. Deuda documental abierta. |
| **X-6** | `visita` ↔ `prospecto` | **Imposible hoy.** `visita.cliente_id` es obligatorio y la entidad no tiene `prospecto_id`. | Ningún KPI de esta lista lo requiere ("nuevos prospectos" se resuelve con `prospecto.creado_en`), pero el wireframe `1s` dibuja los prospectos visitados como pin hueco en el mapa. Es una brecha entre modelo y diseño, no entre modelo y KPIs. |
| **X-7** | Búsqueda "por nombre, **NIT** o responsable" (`1n`) | **`cliente` no tiene campo NIT.** Tampoco un "responsable" explícito: lo más cercano es `cliente.atiende` (quién atiende en el negocio), que no es lo mismo que el vendedor responsable. | El buscador de `1n` no es implementable como está. Requiere agregar `nit` a `cliente` (¿llega en el payload de Efactsoft?) o corregir el placeholder. |

---

## 7. Discrepancias y decisiones abiertas

| ID | Asunto | Estado |
|---|---|---|
| **D-1** | **`total` vs `total_neto`.** Los KPIs de venta usan `venta.total` (con impuestos) "por ser el valor que el cliente reconoce en Efactsoft". La columna "Compras (neto)" de `1n`/`1o` usa `total_neto`. Dos cifras de venta distintas conviviendo en la misma app. | Requiere decisión explícita y una nota visible en UI. |
| **D-2** | **Colisión de "ABC".** La especificación pide un "Reporte ABC de clientes" (Pareto por porcentaje acumulado de venta). El wireframe usa A/B/C para una categoría compuesta de tres insumos. **Mismas letras, distinto significado.** | Sin resolver. O se unifican, o se renombra una de las dos. |
| **D-3** | **Tercera clasificación paralela.** `cliente.potencial` (alto/medio/bajo, RF-12, perfilamiento manual) convive con la categoría automática A/B/C y con el ABC de reporte. Tres taxonomías sobre el mismo cliente. | Sin resolver. |
| **D-4** | **Algoritmo y cortes de A/B/C sin definir.** Ningún documento fija pesos ni umbrales. | Bloquea la implementación. Ver §5.3. |
| **D-5** | **Ventana de evaluación de la categoría.** ¿Últimos 3, 6, 12 meses, o histórico completo? Cambia la letra de todos los clientes. | Sin definir. |
| **D-6** | **Sin RF que respalde la clasificación.** RF-02 cubre perfil base, historial, créditos/cobros y ubicación GPS. La categoría automática es alcance nuevo. | Requiere RF nuevo o excepción documentada, igual que el caso de la tabla `meta`. |
| **D-7** | **`ruta_usuario` en el DER tiene `fecha` + `estado`**, lo que sugiere asignación por día concreto. La regla de atribución venta↔ruta asume asignación **recurrente** por día de la semana. El propio DER lleva una nota al margen de Bryan preguntando si la ruta es entidad individual o reutilizable. | Sin resolver. Bloquea X-2 y "Cobertura de ruta". |
| **D-8** | **Umbral de inactividad sin definir** (§2). | Afecta clientes inactivos, recuperados y "clientes sin visita". |
| **D-9** | **Criterio de identificación de ventas de contado** sobre texto libre de Efactsoft. | Afecta cartera vencida, mora y días promedio de pago (insumo 3). |
| **D-10** | **Carga histórica y mora cero** (§5.2, insumo 3). | Afecta directamente la clasificación durante los primeros meses de operación. |

---

## 8. Trazabilidad

| Requerimiento | Cobertura |
|---|---|
| **RF-02** (Alta) | Perfil base de clientes, historial de ventas, créditos/cobros vigentes, ubicación GPS. Pantallas `1n`, `1o`, `1p`. **No cubre la clasificación A/B/C** (ver D-6). |
| **RF-09** (Alta) | Panel de métricas base que automatiza el cálculo de KPIs priorizados y viables, como cantidad de paradas y ticket promedio. Pantallas `1d`, `1e`, `1f`, móvil `11`. |
| **RF-12** (Media) | Perfilamiento comercial: personalidad de 4 colores y potencial de compra. Pantalla `1q`. Alimenta `cliente.personalidad` y `cliente.potencial`. |
| **Objetivo específico 4 del Acta** | Automatizar el cálculo de indicadores clave sin procesamiento manual. Nota de cierre de `1d`: "Cada KPI se calcula solo: sin hojas de cálculo intermedias". |

Los indicadores marcados *"no va"* en la especificación del cliente se conservan como métricas base cuando alimentan otros cálculos, pero **no se muestran como tarjeta en el dashboard**.
