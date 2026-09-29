import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  CreateExtraStopInput,
  ExtraStopParams,
  SellerIdParam,
} from '../../domain/schemas/extra-stop.schema';
import { DailyRouteQuery } from '../../domain/schemas/daily-route.schema';
import { ExtraStop } from '../../domain/types/extra-stop.types';
import { DailyRoute } from '../../domain/types/daily-route.types';
import {
  createExtraStop,
  deleteExtraStop,
  getExtraStopsDay,
} from '../../services/extra-stop.service';

export class SellerDailyRouteController {
  /** PCRM-158: seller's day, extras included, so the Web knows what to delete. */
  public async getDay(req: Request, res: Response) {
    try {
      const { sellerId } = req.params as unknown as SellerIdParam;
      const { date } = req.query as unknown as DailyRouteQuery;
      const route = await getExtraStopsDay(prisma, sellerId, date);

      const response: ApiResponse<DailyRoute> = {
        success: true,
        message: 'Ruta del día obtenida exitosamente',
        data: route,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'SellerDailyRouteController.getDay');
    }
  }

  /** PCRM-158: Administrador adds a one-off stop for a single date. */
  public async createExtraStop(req: Request, res: Response) {
    try {
      const { sellerId } = req.params as unknown as SellerIdParam;
      const data = req.body as CreateExtraStopInput;
      const stop = await prisma.$transaction((tx) => createExtraStop(tx, sellerId, data));

      const response: ApiResponse<ExtraStop> = {
        success: true,
        message: 'Parada extra creada exitosamente',
        data: stop,
      };
      res.status(201).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'SellerDailyRouteController.createExtraStop');
    }
  }

  /** PCRM-158: removes an extra stop that has no check-in yet. */
  public async deleteExtraStop(req: Request, res: Response) {
    try {
      const { sellerId, stopId } = req.params as unknown as ExtraStopParams;
      const result = await prisma.$transaction((tx) => deleteExtraStop(tx, sellerId, stopId));

      const response: ApiResponse<{ id: string; deleted: true }> = {
        success: true,
        message: 'Parada extra eliminada exitosamente',
        data: result,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'SellerDailyRouteController.deleteExtraStop');
    }
  }
}
