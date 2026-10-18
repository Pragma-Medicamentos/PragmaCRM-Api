import { Router } from 'express';
import { MetricsController } from './metrics.controller';
import { RouteMetricsController } from './routeMetrics.controller';
import { validateParams, validateQuery } from '../middleware/validate';
import {
  metricsKpiParamsSchema,
  metricsKpiValuesQuerySchema,
  metricsProductCustomersQuerySchema,
  metricsProductsQuerySchema,
  metricsRangeQuerySchema,
  metricsSellerParamsSchema,
  metricsTrendsQuerySchema,
} from '../../domain/schemas/metrics.schema';
import { metricsProductParamsSchema } from '../../domain/schemas/productMetrics.schema';
import { metricsRouteParamsSchema } from '../../domain/schemas/routeMetrics.schema';
import { ProductMetricsController } from './productMetrics.controller';
import { SalesComparisonController } from './salesComparison.controller';
import { salesComparisonQuerySchema } from '../../domain/schemas/salesComparison.schema';

export class MetricsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new MetricsController();
    const productController = new ProductMetricsController();
    const routeController = new RouteMetricsController();
    const salesController = new SalesComparisonController();

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

    // PCRM-177. '/products/no-movement' goes before '/products/:id' so it is
    // not read as a product id; '/products' (PCRM-172) stays an exact match
    // and is unaffected.
    router.get(
      '/products/no-movement',
      validateQuery(metricsRangeQuerySchema),
      productController.noMovement
    );
    router.get(
      '/products/:id',
      validateParams(metricsProductParamsSchema),
      validateQuery(metricsRangeQuerySchema),
      productController.detail
    );
    router.get(
      '/products/:id/customers',
      validateParams(metricsProductParamsSchema),
      validateQuery(metricsProductCustomersQuerySchema),
      productController.customers
    );

    // Sales against the previous period, by customer and seller (PCRM-187).
    router.get(
      '/sales/comparison',
      validateQuery(salesComparisonQuerySchema),
      salesController.comparison
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
