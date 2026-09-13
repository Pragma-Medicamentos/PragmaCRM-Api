import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { StagingResult } from '../../domain/types/sales-import.types';
import { logger } from '../../lib/adapters/logger';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { importSalesFile } from '../../use-cases/importSalesFile.use-case';

/** Date to `YYYY-MM-DD`, which is how the frontend expects a day range. */
const toIsoDate = (date: Date | null): string | null =>
  date ? date.toISOString().slice(0, 10) : null;

const buildMessage = (result: StagingResult): string => {
  const { accepted, rejected } = result;
  const base = `File received: ${accepted} ${accepted === 1 ? 'sale' : 'sales'} accepted`;
  return rejected === 0
    ? `${base}, none rejected`
    : `${base}, ${rejected} rejected`;
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
