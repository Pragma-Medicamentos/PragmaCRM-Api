import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { StagingResult } from '../../domain/types/sales-import.types';
import { logger } from '../../lib/adapters/logger';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { importSalesFile } from '../../use-cases/importSalesFile.use-case';

/** Fecha a `YYYY-MM-DD`, que es como el frontend espera un rango de dias. */
const toIsoDate = (date: Date | null): string | null =>
  date ? date.toISOString().slice(0, 10) : null;

const buildMessage = (result: StagingResult): string => {
  const { accepted, rejected } = result;
  const base = `Archivo recibido: ${accepted} ${accepted === 1 ? 'venta aceptada' : 'ventas aceptadas'}`;
  return rejected === 0
    ? `${base}, ninguna rechazada`
    : `${base}, ${rejected} ${rejected === 1 ? 'rechazada' : 'rechazadas'}`;
};

export class UploadsController {
  // POST /api/v1/uploads/sales
  // Los metodos no usan `this` a proposito: las rutas los registran sin bind,
  // igual que HealthController.
  public async importSales(req: Request, res: Response) {
    try {
      // El middleware uploadJsonFile ya garantizo que el archivo existe.
      const file = req.file!;

      const result = await importSalesFile(file.buffer);

      logger.info('Archivo de ventas importado', {
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
