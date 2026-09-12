# CLAUDE.md — Pragma CRM

Archivo de contexto de proyecto. Cárgalo al inicio de cualquier sesión relacionada con Pragma CRM: backend, frontend web, app Android, base de datos, documentación, gestión de proyecto o diseño de interfaces.

**Última actualización:** 9 de septiembre de 2026
**Estado del proyecto:** fase de validación previa al desarrollo. DER cerrado y validado. KPIs verificados. Índices y esquema físico en diseño. **Backend inicializado**: esquema aplicado en Supabase y capturado como migración baseline.

> **Este archivo vive en el repositorio del backend (`PragmaCRM-Api`).** Los comandos, la arquitectura del código y el flujo de migraciones de este repo están en la **sección 8.1**. Todo lo demás es contexto de proyecto compartido con las otras plataformas.

---

## 0. Cómo debe actuar Claude en este proyecto

Reglas de comportamiento acordadas con el equipo. Aplican a toda interacción salvo instrucción explícita en contrario.

### Tono y formato

- **Al grano.** Respuestas directas, sin preámbulos ni resúmenes de lo que se acaba de pedir. El equipo trabaja con plazos y prefiere densidad sobre cortesía.
- **Anclar todo a referencias concretas:** número de RF, ID de pantalla del wireframe (`1a`, `1w`, `1x` en web; `1`–`14` en móvil), nombre exacto de tabla y columna, texto literal de la copy. Nunca describir en abstracto algo que tiene un identificador.
- **No expandir sin que lo pidan.** Si la pregunta es puntual, la respuesta es puntual. Las explicaciones largas se ofrecen, no se imponen.
- **Español para hablar, inglés para el código.** La documentación (este archivo, el README, los entregables académicos) y la comunicación con el equipo van en español. **Todo lo que vive dentro de `src/` va en inglés: identificadores, comentarios y mensajes de error incluidos** — ver la sección 11. La nomenclatura de base de datos está en la advertencia de la sección 7.

### Criterios de trabajo

- **Validar antes de implementar.** El patrón del proyecto es cruzar cada artefacto (DER, wireframes, casos de uso) contra la especificación antes de avanzar. Si detectas una inconsistencia, dila; no la resuelvas en silencio con una suposición.
- **Separar estrictamente los planos.** Un cambio de wireframe no es un cambio de modelo de datos. Un KPI no es un requerimiento funcional. Cuando una petición mezcle planos, sepáralos explícitamente y di qué corresponde a cuál.
- **Las decisiones de negocio confirmadas por el equipo mandan** sobre cualquier modelado que Claude proponga. Si el equipo ya decidió algo que aparece en la sección 5 de este documento, esa es la verdad, aunque exista una alternativa técnicamente superior. Se puede señalar la alternativa; no se puede asumirla.
- **Retirar formalmente, no descartar en silencio.** Cuando algo sale del alcance (una métrica, una entidad, un campo), se documenta con su razón. El proyecto lleva registro explícito de lo descartado para que no reaparezca en sprints posteriores.
- **Si falta información, buscarla en los documentos fuente antes de preguntar.** Los archivos del proyecto están listados en la sección 12, con sus particularidades de lectura.
- **El esquema aplicado gana sobre el DER dibujado.** Cuando el PDF del DER y `prisma/schema.prisma` difieran, la base de datos real es la verdad operativa; la diferencia se reporta, no se ignora.

### Lo que Claude no debe hacer

- No inventar campos, tablas ni requerimientos que no estén en el DER o el GPI.
- No asumir que existe integración en tiempo real con nada. **No la hay.** Ver sección 6.
- No proponer funcionalidad de RF-13 ni RF-14 (optimización automática de rutas, sugerencia de frecuencia). Están fuera del MVP.
- No agregar dependencias externas de pago o con costo de API sin señalarlo como riesgo de presupuesto. Ya hay un caso así sin resolver (`place_id` / Google Places).
- No tratar los wireframes como especificación funcional. Son diseño; cuando difieren del GPI o de la especificación del cliente, la discrepancia se reporta.
- No editar `prisma/schema.prisma` a mano ni usar `prisma migrate`. Ver sección 8.1.

---

## 1. El proyecto en una página

**Nombre:** Sistema de Gestión Pragma CRM.

**Cliente:** Droguería Pragma, El Salvador. Distribuidora farmacéutica que vende a farmacias, cadenas de farmacias, droguerías y puestos de medicina.

**Naturaleza:** proyecto académico real. Se desarrolla en el marco de la asignatura de Gestión de Proyectos Informáticos de la Universidad Católica de El Salvador, **para un cliente real y con entrega en producción**. No es un ejercicio; hay acta de constitución firmada, patrocinador y compromiso de despliegue y capacitación.

**Problema raíz:** la gestión comercial vive en la memoria y experiencia individual de cada vendedor. No hay registro estructurado de a quién visitar, en qué orden, con qué frecuencia ni con qué resultado.

**Objetivo central:** centralizar la gestión comercial y **eliminar la dependencia de la memoria individual del vendedor**, mediante planificación digital estructurada y control de campo verificable.

**Solución:** sistema dual e interconectado.

| Plataforma | Rol | Función |
|---|---|---|
| Dashboard web | `Administrador` | Gestión de vendedores y clientes, importación de datos del ERP, creación y asignación de rutas, supervisión de rutas ejecutadas, panel de métricas y reportes |
| App Android (APK) | `Vendedor` | Ruta del día en mapa y lista, ejecución de paradas con validación GPS obligatoria, notas de visita, registro de prospectos y de productos fuera de catálogo |

**Fecha comprometida de despliegue y capacitación:** semana del **2 al 7 de noviembre de 2026**.

**Entregables:** código fuente en GitHub, acceso completo a la base de datos, sistema desplegado en el VPS del cliente con usuario administrador, APK de la app móvil, manual de usuario y manual técnico.

---

## 2. Contexto de negocio

### 2.1 Cómo opera Pragma hoy

Esto importa porque el sistema debe encajar en una operación que ya existe, no reemplazarla de golpe:

- **Gestión mental.** Cada vendedor organiza sus rutas, visitas y seguimiento de clientes de memoria.
- **Sin programación formal.** No hay anotaciones estructuradas ni planificación sistemática de visitas.
- **Coordinación oral y por WhatsApp.** La comunicación con clientes, vendedores y bodega es informal.
- **Sistema de ventas e inventario existente (Efactsoft).** Registra solo clientes que ya compraron y movimientos comerciales ya realizados. No planifica ni da seguimiento.
- **Operación combinada en campo.** Visitar, despachar y cobrar ocurren dentro de la misma dinámica de trabajo.
- **Venta directa en ruta.** El vendedor carga producto en el vehículo, visita al cliente y puede vender o despachar en el mismo momento.

Esa última característica es la que justifica la clasificación estricta de paradas (Visita / Despacho / Cobro): en la operación actual los tres actos se confunden, y el sistema los separa deliberadamente para poder medirlos.

### 2.2 Dolores concretos que el sistema debe resolver

1. Dependencia del conocimiento individual del vendedor.
2. Imposibilidad de dar continuidad a una ruta cuando un vendedor falta, enferma o se va.
3. Recorridos ineficientes por falta de planificación estructurada.
4. Riesgo de olvidar clientes, pedidos o paradas.
5. Ausencia de un perfil centralizado por cliente.
6. Falta de criterios para priorizar visitas (frecuencia, valor, potencial).
7. Necesidad de registrar visitas de forma simple **y verificable**.
8. Falta de seguimiento a prospectos.
9. Falta de registro de productos solicitados que no están en catálogo.
10. Ausencia de métricas para evaluar desempeño y decidir.

El punto 7 es el que da sentido a la validación GPS: el problema no es registrar, es **poder confiar en el registro**.

### 2.3 Objetivos formales

**Objetivo general.** Desarrollar e implementar Pragma CRM (dashboard web y app Android), lograr su despliegue operativo y la capacitación del personal del 2 al 7 de noviembre de 2026, eliminando la dependencia operativa de la memoria individual de los vendedores.

**Objetivos específicos:**

1. Alimentar y sincronizar la base de datos central con los registros e historiales comerciales del sistema existente, **antes** de desarrollar la app móvil y las pruebas de campo.
2. Implementar la validación por geolocalización en la app móvil **antes** de la fase de integración y pruebas piloto, para auditar la ejecución real de las paradas.
3. Habilitar los módulos de prospección y de productos fuera de catálogo **antes** de la capacitación, sustituyendo el uso informal de WhatsApp, libretas y notas personales.
4. Desplegar el panel de métricas base **antes** de las pruebas de campo, automatizando el cálculo de KPIs sin procesamiento manual.

Nota: los cuatro objetivos tienen dependencia temporal explícita. El orden importa. La base de datos poblada es prerequisito de todo lo demás.

### 2.4 Criterios de aceptación del cliente

- APK instalada y operativa en los dispositivos de campo.
- Personal administrativo y vendedores capacitados en sus perfiles.
- Ruteo diario funcionando y validado por GPS.
- Gestión comercial centralizada: clientes, historiales, prospectos, productos fuera de catálogo.
- Métricas y supervisión operando en el panel web.
- Manuales técnico y de usuario entregados.

---

## 3. Actores, roles y casos de uso

### 3.1 Actores

| Actor | Plataforma | Descripción |
|---|---|---|
| **Administrador** | Dashboard web | Dueño o gerencia. Control total: perfiles, historiales, rutas, métricas, prospectos |
| **Vendedor** | App Android | Personal de campo. Interfaz simplificada, optimizada para mínima interacción en ruta |
| **Efactsoft** | — | Sistema externo. Fuente de datos comerciales vía exportación JSON manual |

El control de acceso es **estricto y separado técnica y visualmente** (RNF-04). Un administrador no usa la app; un vendedor no entra al dashboard.

### 3.2 Casos de uso — Dashboard web (Administrador)

```
Gestionar vendedores
  ├── Registrar vendedor  ──<<include>>── Generar credenciales
  ├── Editar vendedor
  └── Deshabilitar acceso

Gestionar clientes
  ├── Consultar ficha  ──<<include>>── Ver historial de compras
  │                    ──<<include>>── Ver créditos y cobros
  ├── Asignar ubicación GPS
  └── Definir perfil comercial

Planificar y asignar rutas
  ├── Crear ruta
  ├── Configurar paradas (Visita, Despacho, Cobro)
  ├── Asignar ruta a vendedor
  ├── Reasignar ruta
  └── Asignar visitas únicas (clientes / prospectos)

Supervisar rutas pasadas
  ├── Ver rutas ejecutadas
  ├── Ver detalle de ruta  ──<<include>>── Ver paradas ejecutadas
  ├── Ver notas de parada
  └── Ver prospectos nuevos por ruta

Importar historial comercial  ──<<include>>── Validar archivo JSON
  ├── Seleccionar archivo
  ├── Validar JSON
  ├── Confirmar carga
  └── Ver rechazados

Gestionar prospectos
  ├── Consultar listado de prospectos
  ├── Ver en mapa
  └── Editar y eliminar prospectos

Visualizar KPIs
```

### 3.3 Casos de uso — App Android (Vendedor)

```
Consultar ruta del día
  ├── Ver ruta del día  ──<<include>>── Ver paradas en mapa
  ├── Ver detalle de paradas
  ├── Consultar calendario de rutas
  └── Consultar historial de rutas

Ejecutar parada con GPS
  ├── Ver detalle de parada
  ├── Validar GPS  ──<<extend>>── Notificar fuera de rango GPS
  └── Registrar nota de visita  <<extend>>

Registrar prospecto
  ├── Capturar datos
  ├── Capturar ubicación GPS
  └── Guardar prospecto  ──<<extend>>── Prospecto ya existente

Registrar producto fuera de catálogo
  ├── Indicar producto  ──<<include>>── Validar disponibilidad
  ├── Indicar cantidad
  └── Guardar producto
```

---

## 4. Alcance funcional

### 4.1 Must have — núcleo del MVP (RF-01 a RF-09)

| RF | Módulo | Descripción |
|---|---|---|
| **RF-01** | Gestión de vendedores (web) | Alta, modificación, habilitación y deshabilitación de perfiles del equipo de ventas. Incluye gestión centralizada de credenciales y control de estado operativo |
| **RF-02** | Perfil base de cliente (web) | Visualizar el perfil del cliente con historial de ventas, créditos y cobros vigentes, montos y responsable de compra. Permite establecer su ubicación GPS exacta para el ruteo |
| **RF-03** | Carga manual de JSON (web) | Alimentación y sincronización de clientes y ventas mediante carga manual de archivos JSON exportados desde Efactsoft |
| **RF-04** | Gestión y asignación de rutas (web) | Crear rutas estáticas (paquetes de clientes) de base semanal y asignarlas o reasignarlas manualmente a vendedores. Mantiene flexibilidad para paradas extra, redistribución y reasignación por enfermedad, vacaciones o reestructuración |
| **RF-05** | Mapa y ejecución de ruta diaria (móvil) | Mapa interactivo y lista de paradas de la jornada, clasificadas en **Visita**, **Despacho** o **Cobro**. Integra y muestra los prospectos en la ruta |
| **RF-06** | Verificación GPS (móvil) | El vendedor confirma la visita; el sistema valida por GPS que esté físicamente dentro del radio del cliente en el momento exacto de marcarla |
| **RF-07** | Notas de visita (móvil) | Apunte o comentario breve al finalizar una parada. Habilita registrar situaciones particulares, como que el cliente principal no estaba y atendió un auxiliar |
| **RF-08** | Rutas ejecutadas (web) | Consultar rutas completadas por vendedor, con la ubicación GPS exacta donde se marcó cada parada y las notas capturadas en campo |
| **RF-09** | Panel de métricas base (web) | Dashboard que automatiza el cálculo de KPIs priorizados, consolidando desempeño de vendedores y estadísticas de clientes |

### 4.2 Nice to have (RF-10 a RF-12)

| RF | Módulo | Descripción |
|---|---|---|
| **RF-10** | Prospectación (móvil y web) | Registro de clientes potenciales: nombre, ubicación GPS, teléfono, fecha de detección y vendedor que lo registró. Se visualizan en el mapa de la ruta del día para captar oportunidades cercanas sin desviar la logística principal |
| **RF-11** | Productos fuera de catálogo (móvil y web) | Registro rápido de artículos que el cliente solicita y no están en inventario. Reporte web consolidado de demandas insatisfechas para decidir sobre nuevas líneas |
| **RF-12** | Personalidad del cliente (web) | Clasificar la personalidad o estilo de comunicación del cliente con 4 colores (rojo, azul, amarillo, verde) y definir potencial de compra (alto, medio, bajo), intereses y afinidad a laboratorios |

Ejemplo del uso de la personalidad, según el cliente: el color rojo indica un cliente directo que quiere ir al grano.

### 4.3 Fuera del MVP (RF-13 y RF-14)

| RF | Descripción | Por qué está fuera |
|---|---|---|
| **RF-13** | Optimización automática e inteligente de rutas: algoritmo que secuencia los puntos del recorrido según valor, histórico y frecuencia de pedidos del cliente | Su ausencia no impide operar. La droguería puede seguir secuenciando manualmente |
| **RF-14** | Sugerencia automática de frecuencia de visita ideal (semanal, quincenal, mensual) según historial y rentabilidad | Igual. Reemplaza análisis manual, no funcionalidad esencial |

**No desarrollar, no modelar y no indexar pensando en estos dos.**

### 4.4 Requerimientos no funcionales

| RNF | Tipo | Contenido |
|---|---|---|
| **RNF-01** | Plataforma | App móvil exclusiva Android (APK). iOS descartado por costo y complejidad de App Store |
| **RNF-02** | Infraestructura | Despliegue en el VPS y dominio propiedad del cliente, ya adquiridos |
| **RNF-03** | Interoperabilidad | Validaciones para parsear y procesar con precisión la estructura del JSON de Efactsoft |
| **RNF-04** | Seguridad | Control de acceso estricto por roles, separando técnica y visualmente `Administrador` (dashboard) y `Vendedor` (app) |
| **RNF-05** | Seguridad | Toda comunicación cifrada con TLS/SSL (HTTPS), incluidas las ubicaciones GPS al transitar por redes móviles públicas |
| **RNF-06** | Usabilidad | Interfaz móvil de alto contraste y touch targets amplios, para uso en campo |
| **RNF-07** | Rendimiento | **Carga inicial de rutas diarias y renderizado del mapa en 3 a 5 segundos máximo** bajo condiciones normales de red |
| **RNF-08** | Escalabilidad | Soportar **más de 350 perfiles de clientes** y **más de 15 visitas diarias por vendedor** sin degradación |
| **RNF-09** | Identidad visual | Respetar la identidad corporativa de Droguería Pragma. El cliente cuenta con paleta de colores e iconografía básica |
| **RNF-10** | Responsive | Dashboard web operativo en escritorio y tablet |
| **RNF-11** | UI | Transiciones fluidas y micro-animaciones. Prioridad baja |

RNF-07 y RNF-08 son los únicos con número. Todo lo demás es cualitativo.

---

## 5. Lógica de negocio y decisiones confirmadas

**Esta es la sección más importante del documento.** Contiene decisiones ya tomadas con el cliente y el equipo. No se reabren sin conversación explícita.

### 5.1 El modelo de rutas: cuatro conceptos que se confunden fácil

Es el punto donde más errores de interpretación ocurren. Los cuatro son entidades distintas con propósitos distintos:

| Concepto | Entidad (DER) | Tabla real | Qué es |
|---|---|---|---|
| **La ruta** | `ruta` | `route` | Un paquete estático de clientes, con nombre, municipio y zona. Es reutilizable e independiente del vendedor. Ejemplo: "Zona Escalón" |
| **La composición de la ruta** | `ruta_cliente` | `route_customer` | Qué clientes componen la ruta y en qué orden. **Es planificación.** Tiene soft delete (`deleted_at`) para conservar vigencia histórica |
| **La asignación** | `ruta_usuario` | `route_user` | Asignación **recurrente e indefinida** de vendedor ↔ ruta ↔ día de la semana. "El vendedor X atiende la ruta Y todos los lunes, desde tal fecha hasta que se reasigne". **No es un registro por jornada** |
| **La ejecución** | `visita` | `visit` | Registro cronológico de lo que efectivamente pasó: check-in con GPS, hora, notas, resultado |

**Regla mental:** la composición de ruta es planeación, `visit` es ejecución de esa planeación.

**Consecuencia de que la asignación sea recurrente:** las jornadas concretas no están almacenadas. Se **generan en runtime** con `generate_series` sobre el día de la semana, uniendo la composición vigente a esa fecha. Esto sostiene tanto "próximas visitas" como "cobertura de ruta".

**✅ Discrepancia resuelta en el esquema aplicado.** El DER dibujaba `ruta_usuario.fecha date`; la decisión confirmada pedía día de la semana con vigencia. **La base implementada le dio la razón a la decisión:** `route_user.day smallint` + `created_at` / `deleted_at`, con índice único parcial `(route_id, user_id, day) WHERE deleted_at IS NULL`. El punto 1 del Anexo B queda cerrado.

### 5.2 Clasificación estricta de paradas

Toda parada es de uno de tres tipos, y la clasificación es obligatoria y visible:

- **Visita** — labor comercial.
- **Despacho** — entrega de pedido.
- **Cobro** — gestión de cobranza.

Esto es un requisito de alto nivel del acta, no un detalle de diseño. Existe porque en la operación actual los tres actos ocurren mezclados y el negocio no puede medirlos por separado.

En la base: `scheduled_visit.stop_type` (default `'visit'`) para la parada planificada, y `visit.visit_type` para la ejecutada.

### 5.3 Validación GPS

- La confirmación de visita **exige** que el vendedor esté físicamente dentro del radio del cliente en el momento exacto de marcar (RF-06).
- **Radio de validación: 80 metros.** Tomado del wireframe de ubicación del cliente.
- El radio **no está persistido por visita**. Si cambia, todo el histórico de alertas "fuera de radio" se recalcula retroactivamente.
- Se guarda `visit.checkin_location` y `visit.distance_meters` en cada visita.

**⚠ Contradicción conocida sin resolver:** el comportamiento cuando el vendedor está fuera de rango difiere entre tres documentos del proyecto. Los casos de uso lo modelan como `<<extend>>` "Notificar fuera de rango GPS", lo que sugiere que se permite marcar y se alerta, pero no está confirmado si bloquea, advierte o registra con bandera. **Requiere decisión del cliente.**

### 5.4 Atribución de venta a ruta

Una venta llega de Efactsoft sin ninguna referencia a rutas. Hay que atribuirla. Dos soluciones estaban sobre la mesa:

**Opción A — join en runtime.** Cruzar el vendedor de la venta + día de la semana de su fecha contra `route_user.day`, respetando la vigencia por `created_at` / `deleted_at`. Es la que está documentada en la guía de KPIs.

**Opción B — denormalización.** Agregar `venta.ruta_id`, estampado al importar y nunca tocado en upserts posteriores. Era la nota manuscrita del DER.

**✅ Resuelta de facto por el esquema aplicado: ganó la opción A.** `sale` **no tiene `route_id`**. Lo que sí tiene es `sale.visit_id`, así que la cadena de atribución es `sale → visit → route_user → route`. El punto 2 del Anexo B queda cerrado, con una consecuencia práctica: **una venta sin `visit_id` no es atribuible a ninguna ruta** — ver Anexo A, punto 2.

### 5.5 Semántica de la venta — reglas que no se negocian

Nombres reales entre paréntesis.

- **`erp_status = 1` es cotización sin procesar. `erp_status = 2` es venta realizada.** Todo cálculo de venta, ticket promedio y efectividad **excluye el estado 1**. Es el filtro más repetido del sistema.
- **`erp_created_at`** (el `fecha_creacion` del DER) se estampa la **primera vez** que la venta llega con estado 2, tomando el campo `updated_at` del payload de Efactsoft. **Nunca se sobrescribe.**
- **`last_payment_at`** (`ultimo_pago_en`) se estampa la **primera vez** que llega con estado 2 **y** saldo pendiente en 0. **Nunca se sobrescribe.**
- Ambos valores salen de `updated_at` del payload, **nunca de la hora de importación**.
- **`pending_balance`** (el `saldop` del ERP) **sí se sobrescribe** en cada carga. Por eso existe `balance_snapshot`, que conserva el histórico de saldos por corte.

### 5.6 Crédito y cobranza

- **Plazo de crédito: 60 días fijos y uniformes** desde `erp_created_at`, para todos los clientes. Decisión del cliente. **No requiere columna en base de datos**; se documenta como supuesto explícito.
- No está diferenciado por tipo de establecimiento.
- Si el plazo cambiara, **cartera vencida y días de mora se recalculan retroactivamente sobre todo el histórico**.
- **Ventas de contado quedan excluidas de cobranza.** Nacen con saldo 0 y distorsionan cartera vencida y mora. El criterio de identificación se define sobre `sale.payment` / `sale.payment_id`, que llegan como texto libre desde Efactsoft.
- **Días promedio de mora** = `(last_payment_at − erp_created_at) − 60`, promediado sobre facturas liquidadas.

### 5.7 Zona horaria

**`America/El_Salvador`** (UTC−6, sin horario de verano).

Todo cruce entre `timestamptz` y `date` debe convertirse explícitamente. **Sin la conversión, las ventas facturadas después de las 6:00 p.m. se atribuyen al día siguiente y rompen la venta por ruta.** Es un error silencioso y difícil de detectar.

Recomendación operativa: calcular los límites del rango en la capa de aplicación y consultar con predicados de rango sobre la columna cruda, en lugar de aplicar `::date` sobre la columna en el `WHERE` (que además invalida los índices).

### 5.8 Constantes de configuración

Estas no viven en el modelo de datos y **deben quedar en el manual técnico**, no solo como comentarios en el código, porque cambian el resultado de varios indicadores a la vez:

| Constante | Valor | Impacto si cambia |
|---|---|---|
| Plazo de crédito | 60 días | Recálculo retroactivo de cartera vencida y mora |
| **Umbral de inactividad** | **⚠ Pendiente de definir** | Determina clientes inactivos, recuperados y "clientes sin visita". La especificación menciona cortes de 30/60/90 días para reportes pero no fija cuál usan los KPIs |
| Radio de validación GPS | 80 metros | Recálculo retroactivo del histórico de alertas fuera de radio |
| Zona horaria | `America/El_Salvador` | Ver 5.7 |
| Estado de venta válido | `erp_status = 2` | Excluye cotizaciones de todo cálculo |
| Ventas de contado | Excluidas de cobranza | Criterio sobre `payment` / `payment_id` |

En este repositorio, las constantes que sean configurables por entorno van en `src/config/envs.ts` con `env-var`; las que son reglas de negocio fijas van como constante exportada del service que las usa, con comentario que remita a esta sección.

### 5.9 Autenticación y autorización

**Decisión confirmada (11 de septiembre de 2026): Supabase Auth es el proveedor de identidad y RLS es el control de acceso.** Sustituye a la decisión anterior basada en Clerk, que queda retirada.

- **Supabase Auth es dueño de la autenticación.** `app_user.auth_user_id uuid` guarda el `auth.users.id`, que es el claim `sub` del JWT. Ese es el vínculo.
- **Los clientes consultan Supabase directamente** con `supabase-js`. Las políticas RLS deciden qué ve cada quien.
- **El rol vive en `app_user.role`, no en los claims.** Cambiarlo es un `UPDATE` y aplica en la consulta siguiente. Por eso las políticas lo resuelven con las funciones de `app_auth` y no leyendo el token.
- **No hay webhook de sincronización y no hace falta**: la API crea la identidad en Supabase Auth y la fila de `app_user` en la misma operación, así que conoce el `sub` en el acto.
- La tabla de usuarios sigue sin campos de contraseña ni credenciales: los gestiona Supabase Auth.

**Dos caminos, y solo uno pasa por RLS.**

| Camino | Quién autoriza |
|---|---|
| Cliente → Supabase (`supabase-js`) | Las políticas RLS |
| Cliente → PragmaCRM-Api | `requireAuth` + `requireRole` |

La API se conecta con `DATABASE_URL` como rol `postgres`, que **bypassea RLS**. No es una sola fuente de verdad: es una división por camino. La frontera, que hay que respetar al agregar funcionalidad: **`app_user` se escribe solo desde la API** — crear una identidad exige la `service_role` key — **y el resto del dominio se lee y escribe por RLS**.

**Cómo se escribe una política.** Las funciones `app_auth.current_app_user_id()`, `app_auth.role_name()` y `app_auth.is_admin()` (migración `rls_helper_functions`) resuelven al usuario. Son `SECURITY DEFINER` a propósito: una política que consultara `app_user` directamente dispararía las políticas de `app_user` y Postgres abortaría con `42P17: infinite recursion detected in policy`.

Cuatro reglas que no son opcionales:

1. Siempre `TO authenticated`. Sin la cláusula la política también se evalúa para `anon`.
2. Siempre `(select app_auth.is_admin())`, envuelto. Sin el `select` el planner ejecuta la función **una vez por fila**; con él es un InitPlan, se evalúa una sola vez y el filtro resultante puede usar el índice. Verificar con `pg_stat_user_functions`: `calls` debe ser 1.
3. `deleted_at IS NULL` va en `USING`, nunca en el `WITH CHECK` de un UPDATE: ahí rompe el propio soft delete.
4. Ninguna política `FOR DELETE` ni `GRANT DELETE`. El modelo es soft delete.

**`FORCE ROW LEVEL SECURITY` está prohibido sobre `app_user`.** Activarlo reintroduce la recursión *y* deja ciega a la API, que se conecta como `postgres`.

**Estado de los permisos.** `anon` no tiene ningún privilegio, deliberadamente: la anon key viaja dentro del bundle web y del APK. `authenticated` tiene solo el DML que necesita, tabla por tabla. Las tablas sin política siguen en deny-all: `upload` y `sale_staging` entre ellas, que son exclusivas de la API.


## 6. Integración con Efactsoft

### 6.1 Qué es y qué no es

**Efactsoft** es el sistema de ventas e inventario que Droguería Pragma ya usa. Es la **única fuente** de ventas, productos y buena parte de los datos de clientes.

**No hay integración en tiempo real. No hay API. No hay webhook.** El flujo es:

```
Administrador exporta JSON desde Efactsoft
   → sube el archivo en el dashboard web (RF-03)
   → el sistema valida la estructura (RNF-03)
   → carga a staging → procesa → confirma
   → muestra rechazados
```

Cualquier propuesta que asuma sincronización automática es incorrecta.

### 6.2 Particularidad crítica del payload

**El JSON no envía objetos independientes de cliente, usuario ni producto.** Todo llega **embebido dentro del objeto `venta`**:

- Datos de cliente: `id_cliente`, `nombres`, `apellidos`, `nombre_comercial`, `credito`, `limite_credito`.
- Datos de vendedor: `id_usuario`, `usuario`.
- Datos de producto: dentro de `detalle` → `id_producto`, `nombre`, `codigo`, `grupo_prod`.

El importador extrae y hace upsert de esas entidades desde ahí.

**Riesgo conocido:** `product` y `customer` **no tienen tabla de staging**. Se hace upsert directo desde el payload, sin landing intermedio. Es más frágil que el camino de la venta, que sí tiene `sale_staging` como red de seguridad.

### 6.3 Campos del payload que importan

| Campo | Uso |
|---|---|
| `id_venta` | PK natural → `sale.erp_sale_id` |
| `updated_at` | Fuente de `erp_created_at` y `last_payment_at`. **Nunca la hora de importación** |
| `estado` | 1 = cotización, 2 = venta realizada → `sale.erp_status` |
| `fecha_emision` | Fecha real de la factura. Relevante para el backfill del histórico inicial |
| `saldop` | Saldo pendiente → `sale.pending_balance`. Se sobrescribe en cada carga |
| `pago`, `id_pago` | Texto libre → `sale.payment` / `sale.payment_id`. Base del criterio para identificar ventas de contado |
| `id_cliente`, `id_usuario` | Vínculos con `customer.erp_customer_id` y `app_user.erp_user_id` |
| `detalle[]` | Líneas de la venta → `sale_detail`. Incluye `id_producto`, `cantidad`, `precio`, `total`, `um`, `factor` |

### 6.4 Llaves de vinculación con el ERP

| Tabla real | Columna puente | Campo del payload |
|---|---|---|
| `app_user` | `erp_user_id` UNIQUE (parcial, `WHERE deleted_at IS NULL`) | `venta.id_usuario` |
| `customer` | `erp_customer_id` UNIQUE (parcial) | `venta.id_cliente` |
| `product` | `erp_product_id` PK | `detalle[].id_producto` |
| `sale` | `erp_sale_id` PK | `venta.id_venta` |
| `sale_detail` | `sale_detail_id` PK | `detalle[].id_venta_det` |

**El importador debe ser idempotente.** El mismo JSON puede cargarse dos veces sin duplicar. Eso depende de que estas claves únicas existan y se usen en `ON CONFLICT`.

**Ojo con los índices únicos parciales:** `erp_user_id` y `erp_customer_id` son únicos solo sobre filas no borradas. Un `ON CONFLICT` sobre esas columnas debe declarar el mismo predicado (`WHERE deleted_at IS NULL`) o Postgres no reconocerá el índice.

---

## 7. Modelo de datos (DER)

**Versión de referencia del DER:** `PCRM - Diagrama ER`, Jimmy R., 7 de septiembre de 2026.
**Motor:** PostgreSQL 17 con PostGIS. Hosting: Supabase.
**Esquema aplicado:** capturado en `supabase/migrations/20260909045944_baseline_remote_schema.sql` y reflejado en `prisma/schema.prisma` (17 modelos).

### 7.0 ⚠ Nomenclatura: el DER y la base real no coinciden

**El DER y las secciones siguientes usan nombres en español; la base de datos aplicada está en inglés.** Esto no es un error a corregir en el código — es la base real y la fuente de verdad — pero sí es una discrepancia documental que hay que tener presente al leer cualquier artefacto del proyecto.

**Al escribir código, consultas o migraciones, usar siempre los nombres reales.** Al conversar con el equipo sobre el DER, traducir.

| DER (español) | Tabla real (inglés) |
|---|---|
| `usuario` | `app_user` |
| `cliente` | `customer` |
| `prospecto` | `prospect` |
| `ruta` | `route` |
| `ruta_cliente` | `route_customer` |
| `ruta_usuario` | `route_user` |
| `visita` | `visit` |
| `visita_programada` | `scheduled_visit` |
| `venta` | `sale` |
| `venta_detalle` | `sale_detail` |
| `venta_staging` | `sale_staging` |
| `producto` | `product` |
| `solicitud_producto` | `product_request` |
| `producto_cotizado` | `quoted_product` |
| `carga` | `upload` |
| `saldo_snapshot` | `balance_snapshot` |
| `meta` | `goal` |

Las columnas siguen la misma regla: `creado_en` → `created_at`, `fecha_creacion` → `erp_created_at`, `saldop` → `pending_balance`, `ubicacion_checkin` → `checkin_location`, `distancia_metros` → `distance_meters`, `notas` → `notes`, y así.

La convención de la base real, ya consistente, es: **inglés, `snake_case`, con `created_at` / `updated_at` / `deleted_at` en casi todas las tablas** (soft delete generalizado). Desapareció la inconsistencia `creado_en` vs `created_at` que tenía el DER.

### 7.1 Diferencias entre el DER dibujado y el esquema aplicado

Además de la nomenclatura, tres decisiones que el DER dejaba abiertas ya están tomadas en la base:

| Tema | Lo que decía el DER | Lo que hay en la base |
|---|---|---|
| Asignación de ruta | `ruta_usuario.fecha date` | `route_user.day smallint` + vigencia por `deleted_at`. **La decisión confirmada ganó** (ver 5.1) |
| Planificación vs ejecución | `visita` absorbía `visita_programada` | **No la absorbió.** `scheduled_visit` existe como tabla propia y `visit` no tiene `fecha_planificada`, `origen`, `estado` ni `orden` |
| Atribución venta→ruta | Opción B: `venta.ruta_id` denormalizado | **No existe `sale.route_id`.** Ganó la opción A: join en runtime vía `sale.visit_id` |

La segunda es la más importante y cambia el modelo mental de la sección 5.1: **planificación y ejecución son dos tablas**, no una.

- `scheduled_visit` — la agenda. Cuelga de `route_user_id`, tiene `visit_date`, `stop_type` y acepta **`customer_id` o `prospect_id`, ambos nullable**. Esto absorbió la entidad propuesta `parada_unica`: una parada ad-hoc es una fila de `scheduled_visit` con `reason` explicando el motivo.
- `visit` — la ejecución. Cuelga de `customer_id` (obligatorio), `user_id`, y opcionalmente `route_user_id` y `route_customer_id`.

**Consecuencia directa sobre el Anexo A punto 3:** se puede **planificar** una parada sobre un prospecto (`scheduled_visit.prospect_id` existe y tiene índice parcial), pero **no se puede ejecutar**: `visit.customer_id` sigue siendo obligatorio y `visit` no tiene `prospect_id`. La brecha entre modelo y wireframe sigue abierta, ahora con contorno exacto.

### 7.2 Identidad

```
app_user
  PK  id              uuid
      erp_user_id     integer  UNIQUE parcial   -- puente con Efactsoft
      auth_user_id    uuid     UNIQUE parcial   -- auth.users.id (claim 'sub')
      role            text                       -- 'Administrador' | 'Vendedor'
      name            text
      email           text
      active          boolean
      created_at / updated_at / deleted_at
```

### 7.3 Cartera

```
customer
  PK  id                  uuid
      erp_customer_id     integer  UNIQUE parcial
      personality         text                   -- RF-12: rojo|azul|verde|amarillo
      potential           text                   -- RF-12: alto|medio|bajo
      name                text
      trade_name          text
      establishment_type  text                   -- cadena|independiente|droguería
      address             text
      municipality        text
      zone                text
      phone / mobile      text
      location            geography(Point,4326)
      place_id            text                   -- ⚠ ver riesgos, 9.2
      attends             text                   -- dependiente | dueño
      credit              boolean
      credit_limit        numeric(14,2)
      origin              text
      active              boolean
      created_at / updated_at / deleted_at

prospect
  PK  id           uuid
  FK  user_id      uuid -> app_user.id      -- quién lo registró
      name / trade_name / address / phone
      location     geography(Point,4326)
      status       text
      created_at / updated_at / deleted_at
```

### 7.4 Rutas

```
route                                   -- paquete estático de clientes, reutilizable
  PK  id           uuid
      name / municipality / zone
      active       boolean

route_customer                          -- PLANIFICACIÓN: composición de la ruta
  PK  id           uuid
  FK  route_id     uuid -> route.id
  FK  customer_id  uuid -> customer.id
      sort_order   smallint
      created_at / updated_at / deleted_at   -- soft delete = vigencia histórica

route_user                              -- ASIGNACIÓN recurrente vendedor↔ruta↔día
  PK  id           uuid
  FK  route_id     uuid -> route.id
  FK  user_id      uuid -> app_user.id
      day          smallint             -- día de la semana. Ver 5.1
      status       text
      created_at / updated_at / deleted_at
  UQ  (route_id, user_id, day) WHERE deleted_at IS NULL
```

### 7.5 Ejecución en campo

```
scheduled_visit                         -- AGENDA: la parada planificada
  PK  id             uuid
  FK  route_user_id  uuid -> route_user.id
      visit_date     date
  FK  customer_id    uuid -> customer.id    NULL
  FK  prospect_id    uuid -> prospect.id    NULL
      stop_type      text  default 'visit'  -- visit | dispatch | collection
      reason         text                   -- motivo de una parada ad-hoc
      created_at / updated_at / deleted_at

visit                                   -- EJECUCIÓN: lo que pasó en campo
  PK  id                 uuid
  FK  customer_id        uuid -> customer.id        NOT NULL
  FK  user_id            uuid -> app_user.id
  FK  route_user_id      uuid -> route_user.id      NULL
  FK  route_customer_id  uuid -> route_customer.id  NULL
      started_at         timestamptz
      finished_at        timestamptz
      checkin_location   geography(Point,4326)
      distance_meters    numeric(8,2)
      visit_type         text            -- visit | dispatch | collection
      successful         boolean
      no_order_reason    text
      notes              text            -- RF-07
      created_at / updated_at / deleted_at
```

`visit` es **la tabla más consultada del sistema**: sostiene el historial de productividad, la atribución de ventas a ruta y los KPIs de cobertura. Sus tres índices parciales (`customer_id + started_at DESC`, `user_id + started_at`, `route_user_id`) están todos filtrados por `deleted_at IS NULL`, así que **toda consulta debe incluir ese predicado** o no los usará.

### 7.6 Ventas

```
sale
  PK  erp_sale_id      integer            -- PK natural del ERP
  FK  customer_id      uuid -> customer.id
  FK  upload_id        uuid -> upload.id
  FK  user_id          uuid -> app_user.id
  FK  visit_id         uuid -> visit.id   -- única vía de atribución a ruta (ver 5.4)
      erp_created_at   timestamptz        -- ver 5.5
      last_payment_at  timestamptz        -- ver 5.5
      total / net_total / vat  numeric(14,2)
      pending_balance  numeric(14,2)      -- se sobrescribe en cada carga
      payment          text
      payment_id       smallint
      erp_status       smallint           -- 1=cotización, 2=venta realizada
      document / remarks  text
      absent           boolean
      created_at / updated_at / deleted_at

sale_detail
  PK  sale_detail_id   integer
  FK  erp_sale_id      integer -> sale.erp_sale_id   ON DELETE CASCADE
  FK  product_id       integer -> product.erp_product_id
      quantity         numeric(12,4)
      unit_of_measure  text
      factor           numeric(10,2)
      price            numeric(14,4)
      total            numeric(14,2)
      tax_total        numeric(14,4)

product
  PK  erp_product_id   integer
      code / name / product_group  text
      last_seen_at     timestamptz
```

`sale` tiene un índice parcial dedicado a cobranza: `(customer_id, erp_created_at) WHERE pending_balance > 0 AND deleted_at IS NULL`. Las consultas de cartera vencida deben escribirse para calzar con ese predicado.

### 7.7 Importación

```
upload                             -- cabecera de cada lote
  PK  id                uuid
  FK  uploaded_by       uuid -> app_user.id
      rango, contadores (recibidas / insertadas / actualizadas / fallidas), estado
      created_at

sale_staging                       -- landing del JSON crudo
  PK  id            bigserial
  FK  upload_id     uuid -> upload.id
      erp_sale_id   integer
      payload       jsonb
      status / error / processed_at

balance_snapshot                   -- ledger histórico de saldos por carga
  PK  id               bigserial
  FK  upload_id        uuid    -> upload.id
  FK  erp_sale_id      integer -> sale.erp_sale_id
      pending_balance  numeric(14,2)
      payment          text
      captured_at      timestamptz
```

`balance_snapshot` existe porque `sale.pending_balance` se sobrescribe y pierde historia. Sostiene la vista de créditos y cobros de RF-02.

### 7.8 Complementarias

```
product_request                    -- RF-11
  PK  id                  uuid
  FK  visit_id            uuid -> visit.id
  FK  customer_id         uuid -> customer.id
  FK  user_id             uuid -> app_user.id
  FK  quoted_product_id   uuid -> quoted_product.id
      requested_quantity  numeric(12,3)
      requested_at        timestamptz

quoted_product
  PK  id      uuid
      name / code  text

goal                               -- meta mensual de venta por vendedor
  PK  id           uuid
  FK  user_id      uuid -> app_user.id
      year / month smallint
      goal_amount  numeric(14,2)
  UQ  (user_id, year, month) WHERE deleted_at IS NULL
```

**⚠ `goal` no tiene RF asociado.** Sostiene dos KPIs marcados como Esenciales (cumplimiento de meta gerencial y del vendedor) pero no aparece en el GPI. Requiere un RF nuevo o una excepción documentada. **Sin resolver.**

### 7.9 Volumetría estimada

Base: 350+ clientes, ~5 vendedores, 15+ visitas diarias por vendedor, 22 días hábiles.

| Tabla | Crecimiento anual | Orden a 3 años |
|---|---|---|
| `app_user`, `route`, `route_user`, `goal` | decenas | decenas |
| `customer`, `route_customer`, `prospect`, `upload` | decenas–cientos | cientos |
| `product` | ~300 | miles |
| **`visit`** | ~20.000 | ~60.000 |
| **`sale`** | ~18.000 | ~60.000+ |
| **`sale_detail`** | ~150.000 | ~500.000 |
| `balance_snapshot` | ~25.000 | ~80.000 |
| `sale_staging` | ~18.000 si no se purga | ~60.000 |

**Es una base de datos pequeña.** Solo tres tablas pasan de 50.000 filas. Consecuencia práctica: el riesgo del proyecto es sobre-optimizar, no sub-optimizar. Un seq scan sobre `customer` o `route_customer` es correcto y más rápido que un índice.

---

## 8. Stack y arquitectura

| Capa | Tecnología | Nota |
|---|---|---|
| Base de datos | **PostgreSQL 17** con **PostGIS** | `geography(Point,4326)` para todas las ubicaciones |
| Plataforma de datos | **Supabase** | Solo la base de datos. No se usa `auth.users` ni la Data API — ver 5.9 |
| Autenticación | **Supabase Auth** | Dueño de la identidad. Vínculo por claim `sub` → `app_user.auth_user_id` |
| **Backend (este repo)** | **Node.js + TypeScript + Express 4, Prisma 7 como cliente** | Ver 8.1 |
| Frontend web | Dashboard administrativo, responsive (escritorio y tablet) | RNF-10 |
| App móvil | **Android nativo**, entregada como APK | RNF-01. Sin iOS |
| Despliegue | **VPS y dominio propiedad del cliente**, ya adquiridos | RNF-02 |
| Transporte | TLS/SSL (HTTPS) obligatorio | RNF-05 |
| Fuente de datos comercial | Efactsoft, vía JSON manual | RF-03 / RNF-03. Sin API |
| Control de versiones | GitHub | Entregable |
| Gestión de proyecto | **Jira**, Scrum, sprints de dos semanas | |

**Ingesta:** tablas de staging para JSON (`sale_staging`), con `upload` como cabecera de lote y contadores de control (insertadas, actualizadas, fallidas).

---

## 8.1 Este repositorio — PragmaCRM-Api (backend)

API REST del CRM. Node.js + TypeScript + Express, PostgreSQL vía Supabase, Prisma como cliente de acceso a datos.

### Comandos

```bash
npm run dev          # Servidor de desarrollo con hot-reload (ts-node-dev)

npm run build        # Compila TypeScript a dist/
npm run start        # Build + ejecuta el output compilado
npm run lint         # ESLint
npm run tsc          # Type-check sin emitir
npm run test         # Tests unitarios (Jest)
npm run test:integration  # Tests de integración (requiere .env.test)
```

Correr un archivo o un test concreto:

```bash
npx jest src/presentation/health/__tests__/health.test.ts
npx jest --testNamePattern="handleError"
```

### Base de datos y migraciones

La base de datos se opera con la **CLI de Supabase**, no con scripts de npm. Requiere Docker Desktop corriendo.

```bash
npx supabase start                  # Levanta el stack local (Postgres en el 54322)
npx supabase stop
npx supabase status                 # URLs, puertos y llaves del stack local
npx supabase migration new <n>      # Crea una migración SQL nueva
npx supabase db reset --no-seed     # Reaplica todas las migraciones desde una DB vacía
npx prisma db pull                  # Sincroniza prisma/schema.prisma con la DB
npx prisma generate                 # Regenera el cliente tipado
```

Reglas del flujo:

- **El esquema es propiedad del SQL versionado en `supabase/migrations/`**, no de Prisma. `prisma/schema.prisma` se regenera con `prisma db pull` — **no se edita a mano**, y **no existe `prisma migrate`** en este proyecto.
- Todo desarrollo corre contra la base **local en Docker**. Nada local toca staging ni producción: esos entornos los actualiza únicamente GitHub Actions al mergear (ver `docs/CI_CD.md`).
- Ciclo de un cambio de esquema: `supabase migration new` → escribir el SQL → `supabase db reset --no-seed` → `prisma db pull` → `prisma generate`. Los dos pasos de Prisma **no son opcionales**: sin ellos el cliente sigue tipado contra el esquema anterior.
- Tras un `git pull` con migraciones nuevas: `supabase db reset --no-seed` + `prisma generate`.
- La migración baseline `20260909045944_baseline_remote_schema.sql` capturó el esquema que se había creado desde el dashboard. Desde ahí, **Git es la fuente de verdad del esquema**.

Guía completa para desarrolladores en [README.md](./README.md#base-de-datos); pipeline de despliegue en [docs/CI_CD.md](./docs/CI_CD.md).

### Variables de entorno

```
STAGE          # "dev" | "staging" | "prod" — entorno de despliegue
NODE_ENV       # "development" en local, "production" en TODO remoto (nunca "staging")
PORT
DATABASE_URL   # Cadena de conexión a PostgreSQL (Supabase)
LOG_LEVEL      # Opcional, por defecto "info"
```

Plantilla en `.env.template`. Los tests de integración leen `.env.test` (ver `.env.test.example`). Toda variable nueva se declara en `src/config/envs.ts` con `env-var` y falla el arranque si es requerida y falta.

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
  prisma.ts                        ← instancia única de PrismaClient (adapter PrismaPg) + type Client
  adapters/                        ← logger (pino), validator (zod)
```

Un módulo nuevo se agrega creando `src/presentation/<modulo>/{routes.ts, <modulo>.controller.ts}`, su service en `src/services/`, sus esquemas Zod en `src/domain/schemas/`, y montándolo en `src/presentation/routes.ts` bajo `/api/v1/<recurso>`. `health/` es el ejemplo mínimo a copiar.

Los services reciben el tipo `Client` de `src/lib/prisma.ts` (unión de `PrismaClient` y el cliente de transacción), de modo que la misma función corra suelta o dentro de un `$transaction`.

### Validación

Los esquemas Zod viven en `src/domain/schemas/`. Usar el wrapper correspondiente:

- `validateBody(schema)` — parsea `req.body` y lo reemplaza por el valor tipado
- `validateQuery(schema)` — parsea `req.query`
- `validateParams(schema)` — parsea `req.params`

Un fallo produce `{ success: false, message: 'Validation error…', errors: [{ field, message }] }`.

### Manejo de errores

Lanzar `CustomError` (o sus factory methods) para errores HTTP esperados. `sendErrorResponse` / `handleError` lo mapean a status + mensaje. Los códigos de Prisma P2002 (409), P2003 (400) y P2025 (404) se mapean automáticamente. Todo lo demás se convierte en 500 y se loguea con `logger.error` — el mensaje interno nunca llega al cliente.

Regla: los controladores no arman respuestas de error a mano; delegan en `sendErrorResponse`.

### Respuestas

Toda respuesta usa el envelope `ApiResponse<T>`: `{ success, message, data?, errors? }`.

### Logging

`logger` (pino) desde `src/lib/adapters/logger.ts` — nunca `console.log` (ESLint lo marca). `requestMetadata` asigna un `X-Request-ID` por petición y loguea método, ruta, status y duración.

### Autenticación

Implementada con `jose` (verificación del JWT) y `@supabase/supabase-js` (Admin API). La decisión de arquitectura está en 5.9.

- **No hay middleware global.** `requireAuth` (`presentation/middleware/auth.ts`) lee el header `Bearer`, verifica el token con `verifyAccessToken` (`lib/supabaseJwt.ts`) contra el JWKS asimétrico del proyecto, resuelve el `sub` contra `app_user.auth_user_id` y deja el usuario en `req.authUser`. Una ruta pública no paga el costo de verificar nada.
- La verificación exige `iss` (el proyecto de Supabase) y `aud` (`authenticated`), y rechaza sesiones anónimas. El check de `iss` es lo que impide que sirva aquí un token emitido por otro proyecto.
- El claim `role` del JWT es el rol de **Postgres**, no el de negocio. Nunca se usa para autorizar.
- `requireRole(...roles)` se encadena después. Los roles son la constante `ROLES`.
- Los guards se aplican **por grupo de rutas** en `routes.ts`, nunca dentro del controlador. En rutas con subida de archivos van necesariamente ahí, por delante de multer, para rechazar a un anónimo antes de bufferizar el archivo.
- Códigos: **401** por token ausente, inválido, expirado o de otro emisor. **403** por usuario no enlazado, `active = false`, `role` desconocido o rol insuficiente. **503** si el JWKS no responde — el token podría ser válido, y mandar a todos al login por un problema de red sería peor.
- `/api/v1/me` devuelve usuario y rol. Importa más que antes: como el rol no viaja en el token, es el único lugar donde un cliente que habla directo con Supabase descubre su rol y se entera de que está deshabilitado.
- `/api/health` es la única ruta pública.

**Alta de vendedores.** `use-cases/create-seller.use-case.ts` crea primero la identidad (`services/supabaseAdmin.service.ts`, con la `service_role` key) y después el perfil, con `auth_user_id` ya poblado; si el perfil falla, borra la identidad. No hay ventana con el enlace en NULL ni paso manual. El `inviteLink` se devuelve una sola vez en el 201 y no se almacena.

**Deshabilitar** corta por los dos caminos: la API responde 403, las funciones `app_auth.*` filtran por `active` y las políticas dejan de devolver filas, y además se banea la cuenta para que muera la sesión viva.

**Probar endpoints protegidos:** pedir un token a `/auth/v1/token?grant_type=password` con la anon key (ver README). En los tests se mockea `lib/supabaseJwt`; la criptografía real se prueba en `lib/__tests__/supabaseJwt.test.ts`, que firma tokens ES256 de verdad sin red.

**Lo que no está hecho:** las políticas RLS están escritas solo para las tablas que web y móvil consumen en este sprint. El resto sigue en deny-all — no rompe nada porque nadie las consulta, pero quien agregue una funcionalidad nueva tendrá que escribir su política y su GRANT, o verá cero filas sin explicación.


### Ramas y CI

Flujo `feat/* → dev → staging → prod`. `ci.yml` corre en cada PR (lint, tsc, tests, audit y reaplicación de migraciones desde cero); `deploy-staging.yml` y `deploy-prod.yml` aplican migraciones al remoto al mergear, con aprobación manual en producción.

---

## 9. Limitaciones y restricciones

### 9.1 Limitaciones duras (no negociables)

| Limitación | Origen |
|---|---|
| **Sin iOS.** App exclusiva Android, entregada como APK | RNF-01. Decisión por costo y complejidad de App Store |
| **Sin integración en tiempo real con Efactsoft.** Solo carga manual de JSON | RF-03. No existe API disponible |
| **Despliegue restringido al VPS y dominio del cliente** | RNF-02 |
| **TLS/SSL obligatorio** en toda comunicación | RNF-05 |
| **Roles cerrados:** solo `Administrador` y `Vendedor` | RNF-04 |
| **Rutas estáticas y asignación manual.** Sin optimización algorítmica | RF-13 fuera del MVP |
| **Frecuencia de visita definida manualmente** | RF-14 fuera del MVP |
| **Plazo de crédito uniforme de 60 días** para todos los clientes | Decisión del cliente |
| **Fecha de entrega inamovible:** 2–7 de noviembre de 2026 | Acta de constitución |

### 9.2 Riesgos técnicos identificados

| Riesgo | Detalle |
|---|---|
| **`customer.place_id`** | Implica integración con Google Places API. **No está presupuestada, no tiene RF ni wireframe de soporte.** Riesgo de costo y de alcance. Puede quedar vacía o eliminarse |
| **Cobertura GPS en campo** | Riesgo declarado en el acta. La validación de RF-06 depende de señal en zonas donde puede no haberla. Sin plan de contingencia definido |
| **Inconsistencias en la importación del histórico** | Riesgo declarado en el acta. Ver Anexo A, punto 1 |
| **Resistencia al cambio** | Riesgo declarado en el acta. La operación actual es verbal y por WhatsApp; la adopción de planificación digital puede encontrar fricción |
| **Upsert directo de `customer` y `product`** | Sin tabla de staging, a diferencia de `sale`. Patrón más frágil |
| **Radio GPS no persistido** | Cambiar el radio recalcula retroactivamente todo el histórico de alertas |
| **Índices únicos parciales** | Un `ON CONFLICT` que no repita el predicado `WHERE deleted_at IS NULL` no reconoce el índice y falla en runtime. Afecta a todo el importador |
| **Sin presupuesto definido** | El cliente no fijó monto. Cualquier dependencia con costo recurrente debe señalarse antes de adoptarse |

### 9.3 Discrepancias del DER

| # | Discrepancia | Estado |
|---|---|---|
| 1 | Falta campo `tipo` en las tablas de fase de planificación | **Resuelto** vía `scheduled_visit.stop_type` y `visit.visit_type` |
| 2 | `visit` no soporta prospectos (`customer_id` obligatorio, sin `prospect_id`) | **Abierta.** `scheduled_visit` sí acepta prospectos; `visit` no. Ningún KPI lo requiere, pero el wireframe de ruta ejecutada dibuja prospectos visitados como pin hueco |
| 3 | Falta de validez temporal en la asignación de ruta | **Resuelto:** `route_user` con `day` + vigencia por `created_at` / `deleted_at` |
| 4 | Tabla de usuarios sin campos de contraseña ni credenciales | **Resuelto**: las gestiona Supabase Auth |
| 5 | Comportamiento GPS fuera de rango contradictorio entre tres documentos | **Abierta.** Requiere decisión del cliente |
| 6 | El DER está en español; la base aplicada está en inglés | **Abierta como deuda documental.** La base es la verdad; el DER debería actualizarse o publicarse la tabla de equivalencias de 7.0 |

### 9.4 Elementos del DER que exceden el MVP

Están en el modelo pero no tienen RF que los respalde. Se conservan porque alimentan KPIs o porque el costo de quitarlos es mayor que el de dejarlos:

- Tabla `goal` (sostiene dos KPIs Esenciales, sin RF).
- Campos de recurrencia.
- `visit.successful`.
- Dependencia de `place_id`.

### 9.5 Contexto académico

El proyecto se ejecuta como trabajo de curso universitario con cliente real. Implicaciones:

- Hay entregables académicos además de los técnicos (acta de constitución, brief, GPI, documentación de avances).
- El equipo son cinco estudiantes con roles definidos y disponibilidad limitada.
- El cronograma es rígido y está atado al calendario académico.
- Las decisiones se documentan formalmente porque parte de la evaluación depende de esa documentación.

---

## 10. Equipo y comunicación

| Rol | Persona |
|---|---|
| Product Owner / Gerente de Proyecto TI | **Josué Andrés Galán Gómez** |
| Scrum Master y Backend | **Bryan Steven Escobar Preza** |
| DBA y Backend — responsable del DER | **Jimmy Ernesto Ramos Castaneda** |
| Frontend Web | **Gustavo Adolfo Retana Hernández** |
| Frontend Android | **Kevin Fernando Rodríguez Posada** |
| Patrocinador y Cliente | **Josué Elías Galán**, dueño de Droguería Pragma |

**Usuarios finales:** vendedores de Pragma.

**Metodología:** Scrum, sprints de dos semanas, gestionado en Jira.

**Comunicación con el cliente:** reuniones semanales, miércoles alrededor de las 3 p.m. Se priorizan reuniones presenciales, canalizadas por el gerente de proyecto. Los avances los reporta Andrés Galán, con presencia deseable de todo el equipo.

**Cronograma de alto nivel:**

| Etapa | Fechas |
|---|---|
| Levantamiento de requerimientos | 20–25 de julio de 2026 |
| Emisión del brief | 22 de julio de 2026 |
| Entrega del acta de constitución | 23 de julio de 2026 |
| Planificación y diseño | 27 de julio – 22 de agosto de 2026 |
| Desarrollo y pruebas | septiembre – 31 de octubre de 2026 |
| Entrega, despliegue y capacitación | **2–7 de noviembre de 2026** |

---

## 11. Glosario y convenciones

| Término | Significado en este proyecto |
|---|---|
| **Parada** | Cada punto de atención dentro de una ruta. Siempre clasificada en Visita, Despacho o Cobro |
| **Visita** | Parada de labor comercial. También el nombre de la entidad que registra la ejecución de cualquier parada |
| **Despacho** | Parada de entrega de pedido |
| **Cobro** | Parada de gestión de cobranza |
| **Ruta** | Paquete estático y reutilizable de clientes. No pertenece a un vendedor |
| **Cartera** | Conjunto de clientes de la droguería. ~352 al arranque |
| **Prospecto** | Cliente potencial aún no convertido. Entidad separada de `customer` |
| **Producto fuera de catálogo** | Artículo que un cliente solicita y no está en el inventario. Se registra para decidir sobre nuevas líneas |
| **Personalidad** | Clasificación por color del estilo de comunicación del cliente (rojo, azul, amarillo, verde) |
| **Potencial** | Clasificación del potencial de compra del cliente (alto, medio, bajo) |
| **Carga** | Un lote de importación de JSON (`upload`). Tiene cabecera, contadores y estado |
| **Efactsoft** | Sistema de ventas e inventario preexistente del cliente. Fuente de datos comerciales |
| **Cartera vencida** | Suma de saldos pendientes con más de 60 días desde la venta |
| **KPI** | Lo que el usuario ve en el dashboard |
| **Reporte** | Información detallada |
| **Métrica** | Dato base que el sistema registra para poder calcular KPIs y generar reportes |

**Convenciones de nomenclatura.** La documentación y la comunicación van en español; **la base de datos y el código van en inglés**. Tablas y columnas en `snake_case` inglés (ver la tabla de equivalencias en 7.0). PK `uuid` para entidades propias del CRM; PK entera natural (`erp_*_id`) para entidades espejo de Efactsoft. Toda ubicación es `geography(Point,4326)`. Soft delete generalizado con `deleted_at`.

**En el código TypeScript todo va en inglés**, siguiendo la convención del stack: nombres de archivo, símbolos, **comentarios** y **mensajes de error**. Los comentarios explican el porqué y no el qué.

Esto incluye los mensajes del envelope `ApiResponse` que llegan al navegador. Si el dashboard necesita mostrarlos en español al usuario final, la traducción se hace en el frontend, no en la API — así el backend queda con un solo idioma y el texto de cara al usuario se puede cambiar sin tocar el servidor.

> Decisión tomada en septiembre de 2026. Antes la convención era comentarios en español; el código anterior se migró completo, así que **no debe quedar español dentro de `src/`**. La documentación (este archivo, el README) sigue en español.

**IDs de pantalla:** wireframes web `1a`–`1w` más `1x` y `1y`; wireframes móviles `1`–`14`. Usarlos como ancla en cualquier discusión de interfaz.

---

## 12. Documentos fuente y manejo de archivos

| Archivo | Contenido |
|---|---|
| `Acta_de_Constitución_del_Proyecto_-_Pragma_CRM.md` | Propósito, objetivos, alcance, riesgos de alto nivel, cronograma, criterios de aprobación, firmas |
| `Brief-Pragma-CRM.md` | Contexto de negocio, operación actual, solución propuesta, alcance funcional por prioridad, stakeholders, entregables |
| `GPI_-_Pragma_CRM_-_Primer_Avance.md` | Requerimientos funcionales (RF-01 a RF-14) y no funcionales (RNF-01 a RNF-11) con tipo, prioridad y actor. Módulos y justificación de prioridades |
| `Especificaciones_CRM.docx` | Documento del cliente. Objetivos de gerencia y vendedor, KPIs, reportes y métricas solicitados, con marcas de "no va" y "opcional" |
| `PCRM__Diagrama_ER.pdf` | Modelo de datos, con notas manuscritas de decisiones pendientes de dibujar |
| `Pragma_CRM__Casos_de_uso.pdf` | Diagrama de casos de uso, niveles 0, 1 y 2 |
| `Guia_KPIs_Pragma_CRM.md` | Verificación de cada KPI contra el modelo, lógica de cálculo, métricas descartadas con motivo, constantes de configuración, puntos abiertos |
| `estructura_datos_efactsoft.txt` | Estructura del payload JSON del ERP, separando campos importantes de los ignorados |
| `Wireframes_Web_Pragma_CRM.html` | Dashboard web, 17 pantallas |
| `Wireframes_App_Móvil_Pragma_-_standalone.html` | App móvil, 14 pantallas |

**En este repositorio**, la fuente de verdad del esquema es `supabase/migrations/` y su reflejo en `prisma/schema.prisma`. Ante cualquier duda sobre un nombre de tabla o columna, consultar el schema, no el PDF del DER.

### Particularidades de lectura

- **`PCRM__Diagrama_ER.pdf` y `Pragma_CRM__Casos_de_uso.pdf` son en realidad archivos ZIP.** `pdfinfo` y `pdf2image` fallan. Hay que descomprimirlos y leer el `.jpeg` (visual) y el `.txt` (texto extraído). El `.txt` conserva las notas manuscritas del diagrama, que contienen decisiones importantes.
- **Los HTML de wireframes son bundles con el contenido dentro de `<script>`.** Extraer tags directamente devuelve solo el mensaje de carga. Funciona mejor buscar cadenas literales con `grep -o -E` sobre el archivo crudo, o usar `re.finditer` con ventanas de contexto para leer secciones concretas.
- **`Especificaciones_CRM.docx` es texto plano UTF-8 a pesar de la extensión.** Se lee directo.

---

## Anexo A — Puntos abiertos

Ninguno bloquea el desarrollo, pero todos afectan la calidad del resultado y deben resolverse antes del despliegue.

**1. Carga histórica inicial y métrica de mora.** Las facturas antiguas llegan en el primer JSON ya con `estado = 2` y `saldop = 0`. Eso hace que `erp_created_at` y `last_payment_at` se estampen con el mismo `updated_at` y produzcan **mora cero**. Sin un backfill desde `fecha_emision` del payload, o sin excluir del cálculo las ventas anteriores a la primera carga, el indicador arrancará mostrando valores falsos durante los primeros meses de operación.

**2. Ventas sin ruta atribuible.** Ahora que la atribución pasa exclusivamente por `sale.visit_id` (ver 5.4), **toda venta sin visita asociada queda fuera del reporte de venta por ruta** aunque sí entre en venta total. Ocurre cuando el vendedor no marcó la parada, cuando el día no tenía ruta asignada, o cuando el `id_usuario` de Efactsoft no mapea contra `app_user.erp_user_id`. El importador debería dejar un conteo de control de los tres casos para que la diferencia entre reportes sea explicable.

**3. Ejecución de paradas sobre prospectos.** `visit.customer_id` es obligatorio y no existe `visit.prospect_id`, así que un check-in sobre un prospecto no tiene dónde registrarse — aunque `scheduled_visit.prospect_id` sí permite planificarlo. Ningún KPI lo requiere, pero el wireframe de ruta ejecutada dibuja los prospectos visitados como pin hueco en el mapa.

**4. Deuda documental de nomenclatura.** El DER, la guía de KPIs y este documento hablan en español; la base está en inglés. Mientras no se unifique, toda consulta escrita a partir del DER hay que traducirla con la tabla de 7.0. Riesgo de errores silenciosos al copiar SQL de la documentación.

---

## Anexo B — Decisiones abiertas que requieren confirmación

| # | Decisión | Impacto | Quién decide | Estado |
|---|---|---|---|---|
| 1 | ¿La asignación de ruta lleva `fecha date` o día de la semana + vigencia? | Modelo de rutas y generación de jornadas | Jimmy / equipo | ✅ **Cerrada.** La base implementó `route_user.day` + vigencia |
| 2 | ¿`sale.route_id` denormalizado o join en runtime? | Atribución de venta a ruta | Equipo | ✅ **Cerrada.** No existe `route_id`; atribución vía `sale.visit_id` |
| 3 | ¿`visit` absorbe `scheduled_visit`? ¿Se crea además `parada_unica`? | Define la tabla más consultada del sistema | Jimmy / equipo | ✅ **Cerrada.** Son dos tablas separadas; `scheduled_visit` absorbió `parada_unica` vía `reason` + FKs nullable |
| 4 | ¿Cuál es el **umbral de inactividad**? | Determina clientes inactivos, recuperados y "sin visita" | Cliente | ⚠ Abierta |
| 5 | ¿Qué hace el sistema cuando el vendedor está **fuera del radio GPS**? ¿Bloquea, advierte o registra con bandera? | Define el flujo central de RF-06 | Cliente | ⚠ Abierta |
| 6 | ¿`goal` obtiene un RF nuevo o una excepción documentada? | Trazabilidad del GPI | Andrés / equipo | ⚠ Abierta |
| 7 | ¿`customer.place_id` se mantiene? Implica Google Places API sin presupuesto | Costo y alcance | Cliente / equipo | ⚠ Abierta |
| 8 | ¿Se resuelve el check-in sobre prospectos en `visit`? | Coherencia entre modelo y wireframes | Equipo | ⚠ Abierta |
| 9 | ¿Se purga `sale_staging` tras procesar cada carga? | Crecimiento de la base | Equipo | ⚠ Abierta |
| 10 | ¿Se actualiza el DER a los nombres reales en inglés, o se publica la tabla de equivalencias? | Deuda documental | Jimmy / equipo | ⚠ Abierta |

---

## Anexo C — Métricas y KPIs

El detalle completo (lógica de cálculo de cada KPI, métricas descartadas con su motivo, reportes derivados) vive en `Guia_KPIs_Pragma_CRM.md`. Resumen de lo que quedó:

- **KPIs de Gerencia:** ventas del mes, ventas del año, cumplimiento de meta, ticket promedio, número de pedidos / efectividad de ruta, clientes visitados, clientes recuperados, cartera vencida, nuevos prospectos.
- **KPIs del Vendedor:** cumplimiento de meta, pedidos realizados, clientes visitados, cobertura de ruta, cobros pendientes, clientes recuperados, próximas visitas, nuevos prospectos.
- **Métricas base:** venta total, por vendedor, por ruta, por municipio, por cliente y por producto; número de pedidos; ticket promedio; clientes visitados; cobertura de ruta; visitas efectivas; tiempo promedio por visita; tiempo desde la última visita; clientes activos, inactivos y recuperados; frecuencia de compra; cobros pendientes; cartera vencida; días promedio de mora.

**Retirados formalmente del alcance** (no reintroducir sin conversación): clientes nuevos, ranking de clientes, clientes asignados, monto cobrado, pedidos entregados, entregas a tiempo, devoluciones, cobertura de ruta a nivel gerencial, cobranza del período.
