import { Request, Response } from 'express';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  AbcReportParams,
  ManagementReportQuery,
  RankingsReportQuery,
  SalesReportParams,
} from '../../domain/schemas/report.schema';
import {
  generateAbcReport,
  generateCollectionsReport,
  generateCustomersWithoutPurchaseReport,
  generateGoalsReport,
  generateNewCustomersReport,
  generateOverduePortfolioReport,
  generatePlannedVsDoneReport,
  generateRankingsReport,
  generateRecoveredCustomersReport,
  generateSalesReport,
  generateSellersComparisonReport,
  generateVisitEffectivenessReport,
} from '../../services/managementReport.service';
import { sendReport } from './reports.controller';

/*
 * Management report downloads (PCRM-159). Same response contract as
 * ReportsController: a success is the file, an error is the JSON envelope.
 * The admin's name goes into the file header.
 */

const request = <Q extends ManagementReportQuery>(req: Request) => ({
  query: req.query as unknown as Q,
  generatedBy: req.authUser?.name,
});

export class ManagementReportsController {
  public async sales(req: Request, res: Response) {
    try {
      const { group } = req.params as unknown as SalesReportParams;
      sendReport(res, await generateSalesReport(prisma, group, request(req)));
    } catch (error) {
      sendErrorResponse(res, error, 'ManagementReportsController.sales');
    }
  }

  public async sellersComparison(req: Request, res: Response) {
    try {
      sendReport(res, await generateSellersComparisonReport(prisma, request(req)));
    } catch (error) {
      sendErrorResponse(res, error, 'ManagementReportsController.sellersComparison');
    }
  }

  public async abc(req: Request, res: Response) {
    try {
      const { entity } = req.params as unknown as AbcReportParams;
      sendReport(res, await generateAbcReport(prisma, entity, request(req)));
    } catch (error) {
      sendErrorResponse(res, error, 'ManagementReportsController.abc');
    }
  }

  public async rankings(req: Request, res: Response) {
    try {
      sendReport(res, await generateRankingsReport(prisma, request<RankingsReportQuery>(req)));
    } catch (error) {
      sendErrorResponse(res, error, 'ManagementReportsController.rankings');
    }
  }

  public async goals(req: Request, res: Response) {
    try {
      sendReport(res, await generateGoalsReport(prisma, request(req)));
    } catch (error) {
      sendErrorResponse(res, error, 'ManagementReportsController.goals');
    }
  }

  public async plannedVsDone(req: Request, res: Response) {
    try {
      sendReport(res, await generatePlannedVsDoneReport(prisma, request(req)));
    } catch (error) {
      sendErrorResponse(res, error, 'ManagementReportsController.plannedVsDone');
    }
  }

  public async visitEffectiveness(req: Request, res: Response) {
    try {
      sendReport(res, await generateVisitEffectivenessReport(prisma, request(req)));
    } catch (error) {
      sendErrorResponse(res, error, 'ManagementReportsController.visitEffectiveness');
    }
  }

  public async newCustomers(req: Request, res: Response) {
    try {
      sendReport(res, await generateNewCustomersReport(prisma, request(req)));
    } catch (error) {
      sendErrorResponse(res, error, 'ManagementReportsController.newCustomers');
    }
  }

  public async recoveredCustomers(req: Request, res: Response) {
    try {
      sendReport(res, await generateRecoveredCustomersReport(prisma, request(req)));
    } catch (error) {
      sendErrorResponse(res, error, 'ManagementReportsController.recoveredCustomers');
    }
  }

  public async customersWithoutPurchase(req: Request, res: Response) {
    try {
      sendReport(res, await generateCustomersWithoutPurchaseReport(prisma, request(req)));
    } catch (error) {
      sendErrorResponse(res, error, 'ManagementReportsController.customersWithoutPurchase');
    }
  }

  public async collections(req: Request, res: Response) {
    try {
      sendReport(res, await generateCollectionsReport(prisma, request(req)));
    } catch (error) {
      sendErrorResponse(res, error, 'ManagementReportsController.collections');
    }
  }

  public async overduePortfolio(req: Request, res: Response) {
    try {
      sendReport(res, await generateOverduePortfolioReport(prisma, request(req)));
    } catch (error) {
      sendErrorResponse(res, error, 'ManagementReportsController.overduePortfolio');
    }
  }
}
