import { Router } from 'express';
import { ReportsController } from './reports.controller';
import { ManagementReportsRoutes } from './management.routes';
import { validateParams, validateQuery } from '../middleware/validate';
import {
  metricsKpiParamsSchema,
  metricsSellerParamsSchema,
} from '../../domain/schemas/metrics.schema';
import {
  reportKpisQuerySchema,
  reportProductsQuerySchema,
  reportRangeQuerySchema,
  reportTrendsQuerySchema,
} from '../../domain/schemas/report.schema';

export class ReportsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new ReportsController();

    // requireAuth + requireRole(ADMIN) are applied when the group is mounted
    // in presentation/routes.ts. Paths mirror /api/v1/metrics one to one;
    // every route takes ?format=xlsx|pdf (default xlsx).
    router.get('/kpis', validateQuery(reportKpisQuerySchema), controller.kpis);
    router.get(
      '/kpis/:name',
      validateParams(metricsKpiParamsSchema),
      validateQuery(reportRangeQuerySchema),
      controller.kpi
    );
    router.get('/sellers', validateQuery(reportRangeQuerySchema), controller.sellers);
    router.get(
      '/sellers/:id',
      validateParams(metricsSellerParamsSchema),
      validateQuery(reportRangeQuerySchema),
      controller.sellerDetail
    );
    router.get('/trends', validateQuery(reportTrendsQuerySchema), controller.trends);
    router.get('/coverage', validateQuery(reportRangeQuerySchema), controller.coverage);
    router.get('/products', validateQuery(reportProductsQuerySchema), controller.products);
    router.get(
      '/purchase-frequency',
      validateQuery(reportRangeQuerySchema),
      controller.purchaseFrequency
    );

    // Management reports (PCRM-159): their own SQL and filters.
    router.use(ManagementReportsRoutes.routes);

    return router;
  }
}
