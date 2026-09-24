import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  MetricsKpisQuery,
  MetricsRangeQuery,
  MetricsSellerParams,
  MetricsTrendsQuery,
} from '../../domain/schemas/metrics.schema';
import {
  MetricsCoverageResponse,
  MetricsKpisResponse,
  MetricsPurchaseFrequencyResponse,
  MetricsSellerDetailResponse,
  MetricsSellersResponse,
  MetricsTrendsResponse,
} from '../../domain/types/metrics.types';
import {
  getCompanyKpis,
  getCoverage,
  getPurchaseFrequency,
  getSellerDetail,
  getTrends,
  listSellerPerformance,
} from '../../services/metrics.service';

export class MetricsController {
  /** Company KPI cards with previous-period values (1a, 1d, 1v). */
  public async kpis(req: Request, res: Response) {
    try {
      const query = req.query as unknown as MetricsKpisQuery;
      const data = await getCompanyKpis(prisma, query);

      const response: ApiResponse<MetricsKpisResponse> = {
        success: true,
        message: 'KPIs retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'MetricsController.kpis');
    }
  }

  /** Per-seller performance table (1d, 1f). */
  public async sellers(req: Request, res: Response) {
    try {
      const query = req.query as unknown as MetricsRangeQuery;
      const data = await listSellerPerformance(prisma, query);

      const response: ApiResponse<MetricsSellersResponse> = {
        success: true,
        message: 'Seller performance retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'MetricsController.sellers');
    }
  }

  /** Expanded seller row (1f). */
  public async sellerDetail(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as MetricsSellerParams;
      const query = req.query as unknown as MetricsRangeQuery;
      const data = await getSellerDetail(prisma, id, query);

      const response: ApiResponse<MetricsSellerDetailResponse> = {
        success: true,
        message: 'Seller metrics retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'MetricsController.sellerDetail');
    }
  }

  /** Weekly or monthly series for the charts (1e, Home). */
  public async trends(req: Request, res: Response) {
    try {
      const query = req.query as unknown as MetricsTrendsQuery;
      const data = await getTrends(prisma, query);

      const response: ApiResponse<MetricsTrendsResponse> = {
        success: true,
        message: 'Trends retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'MetricsController.trends');
    }
  }

  /** Portfolio coverage map (1e). */
  public async coverage(req: Request, res: Response) {
    try {
      const query = req.query as unknown as MetricsRangeQuery;
      const data = await getCoverage(prisma, query);

      const response: ApiResponse<MetricsCoverageResponse> = {
        success: true,
        message: 'Coverage retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'MetricsController.coverage');
    }
  }

  /** Purchase-frequency histogram (1e). */
  public async purchaseFrequency(req: Request, res: Response) {
    try {
      const query = req.query as unknown as MetricsRangeQuery;
      const data = await getPurchaseFrequency(prisma, query);

      const response: ApiResponse<MetricsPurchaseFrequencyResponse> = {
        success: true,
        message: 'Purchase frequency retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'MetricsController.purchaseFrequency');
    }
  }
}
