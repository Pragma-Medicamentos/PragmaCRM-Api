import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { CustomError } from '../../domain/errors/CustomError';
import { DailyRoute } from '../../domain/types/daily-route.types';
import { DailyRouteQuery } from '../../domain/schemas/daily-route.schema';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import { getDailyRoute } from '../../services/daily-route.service';

export class DailyRouteController {
  public async get(req: Request, res: Response) {
    try {
      // Runs behind requireAuth: the guard is for the type, not the flow.
      if (!req.authUser) throw CustomError.unauthorized();

      // Already validated and normalised by validateQuery; the service
      // defaults `date` to today in the business timezone when it is absent,
      // so the controller does not duplicate that logic.
      const { date } = req.query as unknown as DailyRouteQuery;

      const route = await getDailyRoute(prisma, req.authUser.id, date);

      const response: ApiResponse<DailyRoute> = {
        success: true,
        message: 'Ruta del día obtenida correctamente',
        data: route,
      };

      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'DailyRouteController.get');
    }
  }
}
