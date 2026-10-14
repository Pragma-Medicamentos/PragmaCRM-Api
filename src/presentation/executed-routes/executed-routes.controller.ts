import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import { ExecutedRoutesQuery } from '../../domain/schemas/executed-route.schema';
import { ExecutedRoutesHistory } from '../../domain/types/executed-route.types';
import { getExecutedRoutes } from '../../services/executed-route.service';

export class ExecutedRoutesController {
  /** HU-08: executed routes with check-in GPS and notes, filtered by date/seller. */
  public async list(req: Request, res: Response) {
    try {
      const query = req.query as unknown as ExecutedRoutesQuery;
      const history = await getExecutedRoutes(prisma, query);

      const response: ApiResponse<ExecutedRoutesHistory> = {
        success: true,
        message: 'Rutas ejecutadas obtenidas exitosamente',
        data: history,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ExecutedRoutesController.list');
    }
  }
}
