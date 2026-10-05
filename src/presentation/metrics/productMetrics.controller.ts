import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import { MetricsRangeQuery } from '../../domain/schemas/metrics.schema';
import { MetricsProductParams } from '../../domain/schemas/productMetrics.schema';
import {
  MetricsProductDetailResponse,
  MetricsProductsNoMovementResponse,
} from '../../domain/types/productMetrics.types';
import {
  getProductDetail,
  getProductsWithoutMovement,
} from '../../services/productMetrics.service';

/** Product metrics of the panel (PCRM-177), on top of the ranking of PCRM-172. */
export class ProductMetricsController {
  /** Sheet of one product. Unknown or deleted product: 404. */
  public async detail(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as MetricsProductParams;
      const query = req.query as unknown as MetricsRangeQuery;
      const data = await getProductDetail(prisma, id, query);

      const response: ApiResponse<MetricsProductDetailResponse> = {
        success: true,
        message: 'Product metrics retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ProductMetricsController.detail');
    }
  }

  /** Active products with no confirmed sale in the period. */
  public async noMovement(req: Request, res: Response) {
    try {
      const query = req.query as unknown as MetricsRangeQuery;
      const data = await getProductsWithoutMovement(prisma, query);

      const response: ApiResponse<MetricsProductsNoMovementResponse> = {
        success: true,
        message: 'Products without movement retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ProductMetricsController.noMovement');
    }
  }
}
