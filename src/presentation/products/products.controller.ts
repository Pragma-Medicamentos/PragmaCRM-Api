import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  ListProductsQuery,
  ProductParams,
} from '../../domain/schemas/product.schema';
import { ProductListItem } from '../../domain/types/product.types';
import { Paginated } from '../../domain/types/pagination.types';
import { getProductById, listProducts } from '../../services/product.service';

export class ProductsController {
  /** Catalog list, filterable by code/name. */
  public async list(req: Request, res: Response) {
    try {
      const query = req.query as unknown as ListProductsQuery;
      const page = await listProducts(prisma, query);

      const response: ApiResponse<Paginated<ProductListItem>> = {
        success: true,
        message: 'Products retrieved successfully',
        data: page,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ProductsController.list');
    }
  }

  /** Single catalog product by erp_product_id. */
  public async getById(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as ProductParams;
      const product = await getProductById(prisma, id);

      const response: ApiResponse<ProductListItem> = {
        success: true,
        message: 'Product retrieved successfully',
        data: product,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ProductsController.getById');
    }
  }
}
