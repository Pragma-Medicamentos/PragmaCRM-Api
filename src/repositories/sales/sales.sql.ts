import { Prisma } from '../../generated/prisma/client';

/*
 * SQL of the sales import reconciliation (RF-03). Raw because the "absent
 * from the file" side is an anti-join against `sale_staging`, which Prisma's
 * typed API cannot express without first loading every id of the batch.
 */

/** Instant bounds of the export range, `[start, end)`, already in UTC. */
export interface SaleRemovalWindow {
  start: Date;
  end: Date;
}

/**
 * Soft-deletes, in one statement, the live sales the batch says are gone:
 *
 *   - annulled: staged as `annulled` (`estado = 3`), whatever their date;
 *   - missing:  `erp_quoted_at` inside `window` and no staging row of this
 *               upload at all. `erp_quoted_at` (venta.created_at) is the
 *               date Efactsoft filters its export on; `erp_created_at`
 *               (fecha_emision) lags it by days and would reach sales the
 *               export never covered. Rows rejected at intake still count
 *               as present, so a dirty record never deletes its sale.
 *
 * Returns one row per removed sale with the reason, for the counters.
 * `window` is null when the file has no created_at: then only annulments
 * apply, because without a range there is no safe "absent" to compare
 * against. A sale with a NULL `erp_quoted_at` is never removed as missing.
 *
 * Compared with a range on the raw column, never with a `::date` cast
 * (CLAUDE.md 5.7); matches the partial index `sale_erp_quoted_at_idx`.
 */
export const softDeleteSalesNotInUploadSql = (
  uploadId: string,
  window: SaleRemovalWindow | null
): Prisma.Sql => {
  const missingPredicate = window
    ? Prisma.sql`
        s.erp_quoted_at >= ${window.start}
        AND s.erp_quoted_at < ${window.end}
        AND NOT EXISTS (
          SELECT 1
          FROM   sale_staging st
          WHERE  st.upload_id = ${uploadId}::uuid
            AND  st.erp_sale_id = s.erp_sale_id
        )`
    : Prisma.sql`FALSE`;

  return Prisma.sql`
    WITH annulled AS (
      SELECT DISTINCT st.erp_sale_id
      FROM   sale_staging st
      WHERE  st.upload_id = ${uploadId}::uuid
        AND  st.status = 'annulled'
        AND  st.erp_sale_id IS NOT NULL
    )
    UPDATE sale s
    SET    deleted_at = now(),
           updated_at = now()
    WHERE  s.deleted_at IS NULL
      AND  (
             s.erp_sale_id IN (SELECT erp_sale_id FROM annulled)
             OR (${missingPredicate})
           )
    RETURNING s.erp_sale_id,
              (s.erp_sale_id IN (SELECT erp_sale_id FROM annulled)) AS annulled
  `;
};
