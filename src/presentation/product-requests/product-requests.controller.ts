import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  CreateProductRequestInput,
  DemandedProductsQuery,
  OffCatalogDemandQuery,
  OffCatalogProductParams,
} from '../../domain/schemas/product-request.schema';
import {
  CreatedProductRequest,
  DemandedProduct,
  OffCatalogDemandDetailResponse,
  OffCatalogDemandResponse,
} from '../../domain/types/product-request.types';
import {
  createProductRequest,
  getOffCatalogDemand,
  getOffCatalogProductDemand,
  listDemandedProducts,
} from '../../services/product-request.service';

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

  public async demand(req: Request, res: Response) {
    try {
      const query = req.query as unknown as OffCatalogDemandQuery;
      const data = await getOffCatalogDemand(prisma, query);

      const response: ApiResponse<OffCatalogDemandResponse> = {
        success: true,
        message: 'Off-catalog demand retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ProductRequestsController.demand');
    }
  }

  public async demandDetail(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as OffCatalogProductParams;
      const query = req.query as unknown as OffCatalogDemandQuery;
      const data = await getOffCatalogProductDemand(prisma, id, query);

      const response: ApiResponse<OffCatalogDemandDetailResponse> = {
        success: true,
        message: 'Off-catalog product demand retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ProductRequestsController.demandDetail');
    }
  }

  public async demandedProducts(req: Request, res: Response) {
    try {
      const query = req.query as unknown as DemandedProductsQuery;
      const data = await listDemandedProducts(prisma, query);

      const response: ApiResponse<DemandedProduct[]> = {
        success: true,
        message: 'Demanded products retrieved successfully',
        data,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ProductRequestsController.demandedProducts');
    }
  }
}
