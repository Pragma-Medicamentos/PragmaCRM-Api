import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import { SalesComparisonQuery } from '../../domain/schemas/salesComparison.schema';
import { SalesComparisonResponse } from '../../domain/types/salesComparison.types';
import { getSalesComparison } from '../../services/salesComparison.service';

/** Sales of the period against the previous one, by customer and seller (PCRM-187). */
export class SalesComparisonController {
  /** Unknown customer_id or user_id: 404. */
  public async comparison(req: Request, res: Response) {
    try {
      const query = req.query as unknown as SalesComparisonQuery;
      const data = await getSalesComparison(prisma, query);

      const response: ApiResponse<SalesComparisonResponse> = {
        success: true,
        message: 'Sales comparison retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'SalesComparisonController.comparison');
    }
  }
}
