import { StagingResult } from '../domain/types/sales-import.types';
import { prisma } from '../lib/prisma';
import { stageSalesFile } from '../services/salesStaging.service';

/**
 * Importacion de un archivo de ventas de Efactsoft (RF-03).
 *
 * Orquesta el flujo completo de la HU-02. Hoy tiene un solo paso; el segundo
 * lo agrega PCRM-34.
 */

/**
 * Margen para la transaccion. El default de Prisma son 5 s, suficiente para el
 * export mensual (~350 ventas) pero no para el backfill historico
 * (~18.000 ventas al ano, CLAUDE.md 7.9), donde el `createMany` se parte en
 * decenas de lotes.
 */
const TRANSACTION_TIMEOUT_MS = 120_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

export const importSalesFile = async (fileBuffer: Buffer): Promise<StagingResult> =>
  prisma.$transaction(
    async (tx) => {
      // PASO 1 — Recibir: validar el archivo y encolarlo. PCRM-32 / PCRM-33.
      const result = await stageSalesFile(tx, fileBuffer);

      // PASO 2 — Sincronizar: consumir la cola y hacer upsert en `customer`,
      // `product`, `sale`, `sale_detail` y `balance_snapshot`.
      //
      // >>> PUNTO DE ENGANCHE DE PCRM-34 <<<
      // Aqui va la llamada al sincronizador, que debe:
      //   - leer `sale_staging` con upload_id = result.upload_id y status 'pending'
      //   - hacer el upsert idempotente por las llaves naturales (CLAUDE.md 6.4),
      //     repitiendo el predicado `WHERE deleted_at IS NULL` en los ON CONFLICT
      //     sobre indices unicos parciales (CLAUDE.md 9.2)
      //   - marcar `processed_at` en cada fila procesada
      //   - actualizar upload.inserted / upload.updated y dejar
      //     upload.status en 'completed'
      //
      // Corre dentro de esta misma transaccion recibiendo `tx`, para que un
      // fallo a mitad del upsert no deje el lote a medio aplicar.
      //
      //   const sync = await syncStagedSales(tx, result.upload_id);
      //   return { ...result, ...sync };

      return result;
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS }
  );
