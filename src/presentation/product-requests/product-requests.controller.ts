import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import { CreateProductRequestInput } from '../../domain/schemas/product-request.schema';
import { CreatedProductRequest } from '../../domain/types/product-request.types';
import { createProductRequest } from '../../services/product-request.service';

export class ProductRequestsController {
  /** RF-11: register an off-catalog product requested during a visit. */
  public async create(req: Request, res: Response) {
    try {
      // requireAuth guarantees authUser on this route group.
      const sellerId = (req.authUser as NonNullable<Request['authUser']>).id;
      const data = req.body as CreateProductRequestInput;

      const productRequest = await prisma.$transaction((tx) =>
        createProductRequest(tx, sellerId, data)
      );

      const response: ApiResponse<CreatedProductRequest> = {
        success: true,
        message: 'Product request registered successfully',
        data: productRequest,
      };
      res.status(201).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ProductRequestsController.create');
    }
  }
}
