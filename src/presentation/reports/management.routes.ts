import { Router } from 'express';
import { ManagementReportsController } from './managementReports.controller';
import { validateParams, validateQuery } from '../middleware/validate';
import {
  abcReportParamsSchema,
  managementReportQuerySchema,
  rankingsReportQuerySchema,
  salesReportParamsSchema,
} from '../../domain/schemas/report.schema';

/*
 * Management reports (PCRM-159), mounted inside ReportsRoutes, so they share
 * /api/v1/reports and its requireAuth + requireRole(ADMIN) guard. Every route
 * takes ?format=xlsx|pdf plus from / to / zone / user_id / route_id.
 *
 * Paths avoid the prefixes of the PCRM-162 reports (/sellers/:id would
 * swallow /sellers/comparison), and '/sales/sellers-comparison' is
 * registered before '/sales/:group' so it is not read as a group.
 */
export class ManagementReportsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new ManagementReportsController();
    const query = validateQuery(managementReportQuerySchema);

    router.get('/sales/sellers-comparison', query, controller.sellersComparison);
    router.get('/sales/:group', validateParams(salesReportParamsSchema), query, controller.sales);
    router.get('/abc/:entity', validateParams(abcReportParamsSchema), query, controller.abc);
    router.get('/rankings', validateQuery(rankingsReportQuerySchema), controller.rankings);
    router.get('/goals', query, controller.goals);
    router.get('/visits/planned-vs-done', query, controller.plannedVsDone);
    router.get('/visits/effectiveness', query, controller.visitEffectiveness);
    router.get('/customers/new', query, controller.newCustomers);
    router.get('/customers/recovered', query, controller.recoveredCustomers);
    router.get('/customers/no-purchase', query, controller.customersWithoutPurchase);
    router.get('/collections', query, controller.collections);
    router.get('/overdue-portfolio', query, controller.overduePortfolio);

    return router;
  }
}
