import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  MetricsKpiParams,
  MetricsKpiValuesQuery,
  MetricsRangeQuery,
  MetricsSellerParams,
  MetricsTrendsQuery,
} from '../../domain/schemas/metrics.schema';
import {
  MetricsCoverageResponse,
  MetricsKpiCatalogResponse,
  MetricsKpiResponse,
  MetricsKpiValuesResponse,
  MetricsPurchaseFrequencyResponse,
  MetricsSellerDetailResponse,
  MetricsSellersResponse,
  MetricsTrendsResponse,
} from '../../domain/types/metrics.types';
import {
  getKpi,
  getKpiValues,
  getCoverage,
  getPurchaseFrequency,
  getSellerDetail,
  getTrends,
  listKpiCatalog,
  listSellerPerformance,
} from '../../services/metrics.service';

export class MetricsController {
  /** KPI catalog: names, units and threshold tags. Computes nothing. */
  public async kpiCatalog(_req: Request, res: Response) {
    try {
      const response: ApiResponse<MetricsKpiCatalogResponse> = {
        success: true,
        message: 'KPI catalog retrieved successfully',
        data: listKpiCatalog(),
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'MetricsController.kpiCatalog');
    }
  }

  /** Batch of KPIs for a screen (1a, 1d, 1v); only the requested ones run. */
  public async kpiValues(req: Request, res: Response) {
    try {
      const query = req.query as unknown as MetricsKpiValuesQuery;
      const data = await getKpiValues(prisma, query);

      const response: ApiResponse<MetricsKpiValuesResponse> = {
        success: true,
        message: 'KPIs retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'MetricsController.kpiValues');
    }
  }

  /** A single KPI, to refresh one card. */
  public async kpi(req: Request, res: Response) {
    try {
      const { name } = req.params as unknown as MetricsKpiParams;
      const query = req.query as unknown as MetricsRangeQuery;
      const data = await getKpi(prisma, name, query);

      const response: ApiResponse<MetricsKpiResponse> = {
        success: true,
        message: 'KPI retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'MetricsController.kpi');
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
