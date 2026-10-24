import { Request, Response } from 'express';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import { MetricsKpiParams, MetricsSellerParams } from '../../domain/schemas/metrics.schema';
import {
  ReportKpisQuery,
  ReportProductsQuery,
  ReportRangeQuery,
  ReportTrendsQuery,
} from '../../domain/schemas/report.schema';
import { RenderedReport } from '../../domain/types/report.types';
import {
  generateCoverageReport,
  generateKpiReport,
  generateKpisReport,
  generateProductsReport,
  generatePurchaseFrequencyReport,
  generateSellerDetailReport,
  generateSellersReport,
  generateTrendsReport,
} from '../../services/report.service';

/*
 * Report downloads. A success is the file itself, not an ApiResponse
 * envelope; errors still go through sendErrorResponse as JSON, so a client
 * tells them apart by status code (or Content-Type).
 */

export const sendReport = (res: Response, report: RenderedReport) => {
  res
    .status(200)
    .set({
      'Content-Type': report.contentType,
      'Content-Disposition': `attachment; filename="${report.filename}"`,
      'Content-Length': String(report.buffer.length),
      // Figures change with every upload and visit: never serve a stale file.
      'Cache-Control': 'no-store',
    })
    .send(report.buffer);
};

export class ReportsController {
  public async kpis(req: Request, res: Response) {
    try {
      const query = req.query as unknown as ReportKpisQuery;
      sendReport(res, await generateKpisReport(prisma, query));
    } catch (error) {
      sendErrorResponse(res, error, 'ReportsController.kpis');
    }
  }

  public async kpi(req: Request, res: Response) {
    try {
      const { name } = req.params as unknown as MetricsKpiParams;
      const query = req.query as unknown as ReportRangeQuery;
      sendReport(res, await generateKpiReport(prisma, name, query));
    } catch (error) {
      sendErrorResponse(res, error, 'ReportsController.kpi');
    }
  }

  public async sellers(req: Request, res: Response) {
    try {
      const query = req.query as unknown as ReportRangeQuery;
      sendReport(res, await generateSellersReport(prisma, query));
    } catch (error) {
      sendErrorResponse(res, error, 'ReportsController.sellers');
    }
  }

  public async sellerDetail(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as MetricsSellerParams;
      const query = req.query as unknown as ReportRangeQuery;
      sendReport(res, await generateSellerDetailReport(prisma, id, query));
    } catch (error) {
      sendErrorResponse(res, error, 'ReportsController.sellerDetail');
    }
  }

  public async trends(req: Request, res: Response) {
    try {
      const query = req.query as unknown as ReportTrendsQuery;
      sendReport(res, await generateTrendsReport(prisma, query));
    } catch (error) {
      sendErrorResponse(res, error, 'ReportsController.trends');
    }
  }

  public async coverage(req: Request, res: Response) {
    try {
      const query = req.query as unknown as ReportRangeQuery;
      sendReport(res, await generateCoverageReport(prisma, query));
    } catch (error) {
      sendErrorResponse(res, error, 'ReportsController.coverage');
    }
  }

  public async products(req: Request, res: Response) {
    try {
      const query = req.query as unknown as ReportProductsQuery;
      sendReport(res, await generateProductsReport(prisma, query));
    } catch (error) {
      sendErrorResponse(res, error, 'ReportsController.products');
    }
  }

  public async purchaseFrequency(req: Request, res: Response) {
    try {
      const query = req.query as unknown as ReportRangeQuery;
      sendReport(res, await generatePurchaseFrequencyReport(prisma, query));
    } catch (error) {
      sendErrorResponse(res, error, 'ReportsController.purchaseFrequency');
    }
  }
}
