import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import { MetricsRangeQuery } from '../../domain/schemas/metrics.schema';
import {
  MetricsRouteParams,
  MetricsRouteWorkdaysQuery,
} from '../../domain/schemas/routeMetrics.schema';
import {
  MetricsRouteDetailResponse,
  MetricsRoutesResponse,
  MetricsRouteWorkdaysResponse,
} from '../../domain/types/routeMetrics.types';
import {
  getRouteMetricsDetail,
  getRouteWorkdayComparison,
  listRouteMetrics,
} from '../../services/routeMetrics.service';

/** Per-route metrics (PCRM-178). Admin only, like the rest of the panel. */
export class RouteMetricsController {
  /** Ranking of routes by attributed sale. */
  public async routes(req: Request, res: Response) {
    try {
      const query = req.query as unknown as MetricsRangeQuery;
      const data = await listRouteMetrics(prisma, query);

      const response: ApiResponse<MetricsRoutesResponse> = {
        success: true,
        message: 'Route metrics retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RouteMetricsController.routes');
    }
  }

  /** Expanded route: trend, coverage, top customers and products, sellers. */
  public async routeDetail(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as MetricsRouteParams;
      const query = req.query as unknown as MetricsRangeQuery;
      const data = await getRouteMetricsDetail(prisma, id, query);

      const response: ApiResponse<MetricsRouteDetailResponse> = {
        success: true,
        message: 'Route metrics retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RouteMetricsController.routeDetail');
    }
  }

  /** The route against itself on the same weekday (PCRM-188). */
  public async routeWorkdays(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as MetricsRouteParams;
      const query = req.query as unknown as MetricsRouteWorkdaysQuery;
      const data = await getRouteWorkdayComparison(prisma, id, query);

      const response: ApiResponse<MetricsRouteWorkdaysResponse> = {
        success: true,
        message: 'Route workdays retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RouteMetricsController.routeWorkdays');
    }
  }
}
