/**
 * Tipos compartidos del flujo de importacion del JSON de Efactsoft
 * (RF-03, PCRM-32 / PCRM-33).
 */

/** Una venta que no paso la validacion y quedo marcada en `sale_staging`. */
export interface SaleRejection {
  /** Posicion en el array del archivo, para que el admin la ubique. */
  index: number;
  /** `id_venta` del payload, si venia legible. */
  erp_sale_id: number | null;
  /** Motivo en el mismo formato que el resto de la API: `campo: mensaje`. */
  reason: string;
}

/**
 * Estados de `upload.status` a lo largo del ciclo de importacion. La columna es
 * texto libre en la base (sin check), asi que este tipo es el unico contrato.
 *
 *   staged      -> el archivo se recibio y la cola quedo lista   (PCRM-32/33, este modulo)
 *   processing  -> el sincronizador esta consumiendo la cola     (PCRM-34)
 *   completed   -> upsert terminado                              (PCRM-34)
 *   failed      -> el procesamiento aborto                       (PCRM-34)
 */
export type UploadStatus = 'staged' | 'processing' | 'completed' | 'failed';

/**
 * Estados de `sale_staging.status`. `sale_staging` es una cola de trabajo, asi
 * que estos estados hablan del PROCESAMIENTO, no de la validacion:
 *
 *   pending    -> validada y encolada, esperando a PCRM-34   (este modulo)
 *   failed     -> no paso la validacion, no se va a procesar (este modulo)
 *   processed  -> ya se hizo upsert en las tablas vivas      (PCRM-34)
 *
 * Cuidado con `pending`: NO significa "pendiente de validar" — esa venta ya
 * paso el esquema. El sincronizador de PCRM-34 consulta
 * `WHERE upload_id = ? AND status = 'pending'` para saber que le falta, y sin
 * la distincion tendria que reprocesar las que ya sabemos que estan rotas.
 * Tambien es lo que permite reintentar un lote sin resubir el archivo.
 *
 * El nombre viene del `@default("pending")` de la columna (prisma/schema.prisma),
 * definido en PCRM-31.
 */
export type SaleStagingStatus = 'pending' | 'failed' | 'processed';

/** Rango de fechas de factura que cubre el lote, para `upload.range_from/to`. */
export interface UploadRange {
  from: Date | null;
  to: Date | null;
}

/** Resultado de recibir y encolar un archivo. */
export interface StagingResult {
  upload_id: string;
  /** Elementos que traia el archivo. */
  sales_received: number;
  /** Ventas encoladas como `pending`, listas para PCRM-34. */
  accepted: number;
  /** Ventas encoladas como `failed`. */
  rejected: number;
  range: UploadRange;
  /**
   * Detalle de los rechazos, truncado para no devolver una respuesta enorme
   * cuando el archivo viene muy sucio. `rejected` conserva el total real y en
   * `sale_staging` quedan todos.
   */
  rejections: SaleRejection[];
  /** Cuantos rechazos se omitieron de `rejections` por el truncado. */
  rejections_truncated: number;
  /**
   * Datos de control, no errores: ventas aceptadas a las que les falta un
   * vinculo. Explican por que un reporte no cuadra con otro
   * (CLAUDE.md Anexo A punto 2).
   */
  warnings: {
    /** Ventas de mostrador sin `id_cliente`. */
    sales_without_customer: number;
    /** Ventas sin `id_usuario`: no son atribuibles a ninguna ruta. */
    sales_without_user: number;
  };
}
