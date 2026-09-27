import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { logger } from '../../lib/adapters/logger';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { importSalesFile, ImportSalesResult } from '../../use-cases/importSalesFile.use-case';

/** Date to `YYYY-MM-DD`, which is how the frontend expects a day range. */
const toIsoDate = (date: Date | null): string | null =>
  date ? date.toISOString().slice(0, 10) : null;

const buildMessage = (result: ImportSalesResult): string => {
  const { accepted, rejected, inserted, updated, sync_failed } = result;
  const base = `File received: ${accepted} ${accepted === 1 ? 'sale' : 'sales'} accepted`;
  const rejectedPart = rejected === 0 ? 'none rejected' : `${rejected} rejected`;
  const syncPart = `${inserted} inserted, ${updated} updated${
    sync_failed > 0 ? `, ${sync_failed} failed to synchronize` : ''
  }`;
  const { created_count } = result.sellers;
  const sellersPart =
    created_count > 0
      ? ` ${created_count} new ${created_count === 1 ? 'seller' : 'sellers'} created (disabled, pending admin activation).`
      : '';
  return `${base}, ${rejectedPart}. ${syncPart}.${sellersPart}`;
};

export class UploadsController {
  // POST /api/v1/uploads/sales
  // Methods deliberately avoid `this`: routes register them without binding,
  // the same way HealthController does.
  public async importSales(req: Request, res: Response) {
    try {
      // The uploadJsonFile middleware already guaranteed the file is there,
      // and requireAuth guaranteed authUser (the route is admin-only).
      const file = req.file!;

      const result = await importSalesFile(file.buffer, req.authUser!.id);

      logger.info('Sales file imported', {
        upload_id: result.upload_id,
        filename: file.originalname,
        size_bytes: file.size,
        sales_received: result.sales_received,
        accepted: result.accepted,
        rejected: result.rejected,
        inserted: result.inserted,
        updated: result.updated,
        sync_failed: result.sync_failed,
        sellers_created: result.sellers.created_count,
        sellers_unmapped: result.sellers.unmapped.length,
        request_id: res.getHeader('X-Request-ID'),
      });

      const response: ApiResponse = {
        success: true,
        message: buildMessage(result),
        data: {
          upload_id: result.upload_id,
          sales_received: result.sales_received,
          accepted: result.accepted,
          rejected: result.rejected,
          inserted: result.inserted,
          updated: result.updated,
          sync_failed: result.sync_failed,
          sellers: result.sellers,
          range: {
            from: toIsoDate(result.range.from),
            to: toIsoDate(result.range.to),
          },
          rejections: result.rejections,
          rejections_truncated: result.rejections_truncated,
          warnings: result.warnings,
        },
      };

      res.status(201).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'UploadsController.importSales');
    }
  }
}
