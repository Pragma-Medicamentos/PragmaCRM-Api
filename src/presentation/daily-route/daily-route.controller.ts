import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { CustomError } from '../../domain/errors/CustomError';
import {
  DailyRoute,
  StopCustomerLocation,
  StopCustomerMetrics,
  StopNote,
} from '../../domain/types/daily-route.types';
import {
  DailyRouteQuery,
  RouteHistoryQuery,
  SetStopLocationInput,
  SetStopNoteInput,
  StopParams,
} from '../../domain/schemas/daily-route.schema';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  getDailyRoute,
  getStopCustomerMetrics,
  setStopCustomerLocation,
  setStopNote,
} from '../../services/daily-route.service';
import { getWeeklyRoute } from '../../services/weekly-route.service';
import { WeeklyRoute } from '../../domain/types/weekly-route.types';
import { getRouteHistory } from '../../services/route-history.service';
import { RouteHistory } from '../../domain/types/route-history.types';

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

  /** PCRM-170: the seller's live weekly assignment for the current week. */
  public async getWeek(req: Request, res: Response) {
    try {
      if (!req.authUser) throw CustomError.unauthorized();

      const week = await getWeeklyRoute(prisma, req.authUser.id);

      const response: ApiResponse<WeeklyRoute> = {
        success: true,
        message: 'Ruta semanal obtenida correctamente',
        data: week,
      };

      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'DailyRouteController.getWeek');
    }
  }

  /** PCRM-203: the seller's past days, newest first, keyset-paged by date. */
  public async getHistory(req: Request, res: Response) {
    try {
      if (!req.authUser) throw CustomError.unauthorized();

      const { before, limit } = req.query as unknown as RouteHistoryQuery;

      const history = await getRouteHistory(prisma, req.authUser.id, {
        before,
        limit,
      });

      const response: ApiResponse<RouteHistory> = {
        success: true,
        message: 'Historial de rutas obtenido correctamente',
        data: history,
      };

      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'DailyRouteController.getHistory');
    }
  }

  /** PCRM-160: fix the empty GPS pin of a stop's customer. */
  public async setLocation(req: Request, res: Response) {
    try {
      if (!req.authUser) throw CustomError.unauthorized();

      const { id } = req.params as unknown as StopParams;
      const input = req.body as SetStopLocationInput;

      const location = await setStopCustomerLocation(
        prisma,
        req.authUser.id,
        id,
        input
      );

      const response: ApiResponse<StopCustomerLocation> = {
        success: true,
        message: 'Ubicación del cliente establecida correctamente',
        data: location,
      };

      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'DailyRouteController.setLocation');
    }
  }

  /** RF-07: add or replace the note of a completed stop. */
  public async setNote(req: Request, res: Response) {
    try {
      if (!req.authUser) throw CustomError.unauthorized();

      const { id } = req.params as unknown as StopParams;
      const input = req.body as SetStopNoteInput;

      const note = await setStopNote(prisma, req.authUser.id, id, input);

      const response: ApiResponse<StopNote> = {
        success: true,
        message: 'Nota de la parada guardada correctamente',
        data: note,
      };

      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'DailyRouteController.setNote');
    }
  }

  /** PCRM-164: commercial figures of the stop's customer. */
  public async getCustomer(req: Request, res: Response) {
    try {
      if (!req.authUser) throw CustomError.unauthorized();

      const { id } = req.params as unknown as StopParams;

      const metrics = await getStopCustomerMetrics(prisma, req.authUser.id, id);

      const response: ApiResponse<StopCustomerMetrics> = {
        success: true,
        message: 'Métricas del cliente obtenidas correctamente',
        data: metrics,
      };

      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'DailyRouteController.getCustomer');
    }
  }
}
