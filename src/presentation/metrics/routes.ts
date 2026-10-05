import { Router } from 'express';
import { MetricsController } from './metrics.controller';
import { RouteMetricsController } from './routeMetrics.controller';
import { validateParams, validateQuery } from '../middleware/validate';
import {
  metricsKpiParamsSchema,
  metricsKpiValuesQuerySchema,
  metricsProductsQuerySchema,
  metricsRangeQuerySchema,
  metricsSellerParamsSchema,
  metricsTrendsQuerySchema,
} from '../../domain/schemas/metrics.schema';
import { metricsRouteParamsSchema } from '../../domain/schemas/routeMetrics.schema';

export class MetricsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new MetricsController();
    const routeController = new RouteMetricsController();

    // requireAuth + requireRole(ADMIN) are applied when the group is mounted
    // in presentation/routes.ts, not here (convention in CLAUDE.md 8.1).

    // KPI cards. '/kpis/values' is registered before '/kpis/:name' so it is
    // not captured as a KPI called "values".
    router.get('/kpis', controller.kpiCatalog);
    router.get('/kpis/values', validateQuery(metricsKpiValuesQuerySchema), controller.kpiValues);
    router.get(
      '/kpis/:name',
      validateParams(metricsKpiParamsSchema),
      validateQuery(metricsRangeQuerySchema),
      controller.kpi
    );
    router.get('/sellers', validateQuery(metricsRangeQuerySchema), controller.sellers);
    router.get(
      '/sellers/:id',
      validateParams(metricsSellerParamsSchema),
      validateQuery(metricsRangeQuerySchema),
      controller.sellerDetail
    );
    router.get('/trends', validateQuery(metricsTrendsQuerySchema), controller.trends);
    router.get('/coverage', validateQuery(metricsRangeQuerySchema), controller.coverage);
    router.get('/products', validateQuery(metricsProductsQuerySchema), controller.products);
    router.get(
      '/purchase-frequency',
      validateQuery(metricsRangeQuerySchema),
      controller.purchaseFrequency
    );

    // Per-route metrics (PCRM-178). Registered last so they do not shadow any
    // of the paths above; '/routes/:id' is a route.id, the same uuid the
    // routes API uses.
    router.get('/routes', validateQuery(metricsRangeQuerySchema), routeController.routes);
    router.get(
      '/routes/:id',
      validateParams(metricsRouteParamsSchema),
      validateQuery(metricsRangeQuerySchema),
      routeController.routeDetail
    );

    return router;
  }
}
