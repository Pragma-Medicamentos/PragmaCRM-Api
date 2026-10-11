import { Client } from '../lib/prisma';
import { SaleRemovalWindow, softDeleteSalesNotInUploadSql } from './sales/sales.sql';

/*
 * Raw-SQL data access of the sales module (RF-03): the reconciliation that
 * leaves the CRM matching the imported file. The typed upserts stay in
 * `salesSync.service`.
 */

export interface RemovedSaleRow {
  erp_sale_id: number;
  annulled: boolean;
}

/** Soft-deletes the sales the batch annulled or left out of its range. */
export const softDeleteSalesNotInUpload = (
  client: Client,
  uploadId: string,
  window: SaleRemovalWindow | null
): Promise<RemovedSaleRow[]> =>
  client.$queryRaw<RemovedSaleRow[]>(softDeleteSalesNotInUploadSql(uploadId, window));
