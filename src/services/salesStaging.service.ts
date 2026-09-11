import { CustomError } from '../domain/errors/CustomError';
import {
  efactsoftSaleSchema,
  formatZodIssues,
} from '../domain/schemas/efactsoft-sale.schema';
import {
  SaleRejection,
  SaleStagingStatus,
  StagingResult,
  UploadRange,
} from '../domain/types/sales-import.types';
import { parseErpDateOnly } from '../lib/parseErpDate';
import { Client } from '../lib/prisma';

/**
 * Recepcion del JSON de Efactsoft: valida el archivo y lo deja encolado en
 * `upload` + `sale_staging` (RF-03, PCRM-32 y PCRM-33).
 *
 * Este modulo NO escribe en las tablas vivas (`customer`, `product`, `sale`,
 * `sale_detail`, `balance_snapshot`): ese upsert es PCRM-34. La separacion es
 * lo que hace que el criterio de aceptacion CA2 de la HU-02 —"sin corromper
 * datos existentes"— se cumpla por construccion, porque esas tablas ni se
 * abren durante la carga.
 */

/**
 * Cuantos rechazos se devuelven en la respuesta HTTP. Un archivo con miles de
 * registros sucios no debe producir una respuesta de megabytes; los rechazos
 * quedan completos en `sale_staging` de todas formas.
 */
export const MAX_REJECTIONS_IN_RESPONSE = 100;

/**
 * Tamano de lote del `createMany`. Evita armar un solo INSERT gigante cuando
 * se cargue el historico completo (CLAUDE.md 7.9: ~18.000 ventas al ano).
 */
const STAGING_CHUNK_SIZE = 500;

interface StagingRow {
  erp_sale_id: number | null;
  payload: object;
  status: SaleStagingStatus;
  error: string | null;
}

/** Extrae `venta.id_venta` de un elemento sin confiar en su forma. */
const readErpSaleId = (item: unknown): number | null => {
  if (typeof item !== 'object' || item === null) return null;

  const venta = (item as { venta?: unknown }).venta;
  if (typeof venta !== 'object' || venta === null) return null;

  const id = (venta as { id_venta?: unknown }).id_venta;
  return typeof id === 'number' && Number.isInteger(id) ? id : null;
};

/** Convierte el buffer del archivo en el array de ventas, o falla explicando por que. */
const parseFile = (fileBuffer: Buffer): unknown[] => {
  // El export del ERP viene en UTF-8 (trae acentos en nombres de cliente);
  // forzarlo evita que el locale del servidor lo lea como ANSI.
  const text = fileBuffer.toString('utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // El detalle de JSON.parse ("Unexpected end of JSON input") no le sirve al
    // administrador y filtra interioridades del runtime. El motivo fino de
    // cada venta rechazada si viaja, en `rejections`.
    throw CustomError.badRequest('El archivo no es un JSON valido.');
  }

  if (!Array.isArray(parsed)) {
    throw CustomError.unprocessable(
      'El archivo debe contener un arreglo de ventas en la raiz.'
    );
  }

  if (parsed.length === 0) {
    throw CustomError.unprocessable('El archivo no contiene ninguna venta.');
  }

  return parsed;
};

/**
 * Valida cada elemento y arma las filas de staging. Los errores son por venta,
 * no por archivo: una venta sucia se marca y el resto del lote sigue. El
 * historico son anos de ventas y un registro corrupto no puede bloquear la
 * carga completa.
 */
const buildStagingRows = (items: unknown[]) => {
  const rows: StagingRow[] = [];
  const rejections: SaleRejection[] = [];
  const seenSaleIds = new Set<number>();

  let accepted = 0;
  let salesWithoutCustomer = 0;
  let salesWithoutUser = 0;
  let rangeFrom: Date | null = null;
  let rangeTo: Date | null = null;

  items.forEach((item, index) => {
    const erpSaleId = readErpSaleId(item);

    const reject = (reason: string) => {
      rejections.push({ index, erp_sale_id: erpSaleId, reason });
      rows.push({
        erp_sale_id: erpSaleId,
        // A staging va el payload CRUDO, no el parseado: PCRM-34 necesita los
        // 200+ campos del ERP, y una venta rechazada debe poder auditarse tal
        // como llego.
        payload: (item ?? {}) as object,
        status: 'failed',
        error: reason,
      });
    };

    const result = efactsoftSaleSchema.safeParse(item);
    if (!result.success) {
      reject(formatZodIssues(result.error));
      return;
    }

    const { venta } = result.data;

    // Un `id_venta` repetido dentro del mismo archivo reventaria el upsert de
    // PCRM-34 contra la PK natural `sale.erp_sale_id`. Se corta aqui.
    if (seenSaleIds.has(venta.id_venta)) {
      reject(`venta.id_venta: ${venta.id_venta} aparece mas de una vez en el archivo`);
      return;
    }
    seenSaleIds.add(venta.id_venta);

    if (venta.id_cliente === null || venta.id_cliente === undefined) salesWithoutCustomer += 1;
    if (venta.id_usuario === null || venta.id_usuario === undefined) salesWithoutUser += 1;

    const emitted = parseErpDateOnly(venta.fecha_emision);
    if (emitted) {
      if (!rangeFrom || emitted < rangeFrom) rangeFrom = emitted;
      if (!rangeTo || emitted > rangeTo) rangeTo = emitted;
    }

    accepted += 1;
    rows.push({
      erp_sale_id: venta.id_venta,
      payload: item as object,
      status: 'pending',
      error: null,
    });
  });

  const range: UploadRange = { from: rangeFrom, to: rangeTo };

  return { rows, rejections, accepted, range, salesWithoutCustomer, salesWithoutUser };
};

/**
 * Recibe el archivo, lo valida y lo deja encolado para PCRM-34.
 *
 * Recibe `Client` (y no `PrismaClient`) para poder correr suelto o dentro de
 * un `$transaction`, segun la convencion de CLAUDE.md 8.1.
 */
export const stageSalesFile = async (
  client: Client,
  fileBuffer: Buffer
): Promise<StagingResult> => {
  const items = parseFile(fileBuffer);

  const { rows, rejections, accepted, range, salesWithoutCustomer, salesWithoutUser } =
    buildStagingRows(items);

  // Si no se salvo ni una venta, lo mas probable es que el archivo no sea el
  // export de ventas. Se corta sin crear el `upload` para no dejar lotes
  // vacios en el historial de cargas.
  if (accepted === 0) {
    throw CustomError.unprocessable(
      'Ninguna venta del archivo tiene el formato esperado.'
    );
  }

  const upload = await client.upload.create({
    data: {
      // La API todavia no tiene autenticacion (CLAUDE.md 5.9 y 8.1): la
      // columna es nullable y se llenara cuando exista el middleware de Clerk.
      //TODO: cuando se agregue Clerk, cambiar a `uploaded_by: clerkUserId`.
      uploaded_by: null,
      range_from: range.from,
      range_to: range.to,
      sales_received: items.length,
      failed: rejections.length,
      // `inserted` y `updated` quedan en 0: los llena PCRM-34 al procesar.
      status: 'staged',
    },
  });

  for (let i = 0; i < rows.length; i += STAGING_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + STAGING_CHUNK_SIZE);
    await client.sale_staging.createMany({
      data: chunk.map((row) => ({
        upload_id: upload.id,
        erp_sale_id: row.erp_sale_id,
        payload: row.payload,
        status: row.status,
        error: row.error,
      })),
    });
  }

  return {
    upload_id: upload.id,
    sales_received: items.length,
    accepted,
    rejected: rejections.length,
    range,
    rejections: rejections.slice(0, MAX_REJECTIONS_IN_RESPONSE),
    rejections_truncated: Math.max(0, rejections.length - MAX_REJECTIONS_IN_RESPONSE),
    warnings: {
      sales_without_customer: salesWithoutCustomer,
      sales_without_user: salesWithoutUser,
    },
  };
};
