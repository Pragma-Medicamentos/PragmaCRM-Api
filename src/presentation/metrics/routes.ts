import { Router } from 'express';
import { MetricsController } from './metrics.controller';
import { validateParams, validateQuery } from '../middleware/validate';
import {
  metricsKpisQuerySchema,
  metricsRangeQuerySchema,
  metricsSellerParamsSchema,
  metricsTrendsQuerySchema,
} from '../../domain/schemas/metrics.schema';

export class MetricsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new MetricsController();

    // requireAuth + requireRole(ADMIN) are applied when the group is mounted
    // in presentation/routes.ts, not here (convention in CLAUDE.md 8.1).

    router.get('/kpis', validateQuery(metricsKpisQuerySchema), controller.kpis);
    router.get('/sellers', validateQuery(metricsRangeQuerySchema), controller.sellers);
    router.get(
      '/sellers/:id',
      validateParams(metricsSellerParamsSchema),
      validateQuery(metricsRangeQuerySchema),
      controller.sellerDetail
    );
    router.get('/trends', validateQuery(metricsTrendsQuerySchema), controller.trends);
    router.get('/coverage', validateQuery(metricsRangeQuerySchema), controller.coverage);
    router.get(
      '/purchase-frequency',
      validateQuery(metricsRangeQuerySchema),
      controller.purchaseFrequency
    );

    return router;
  }
}
