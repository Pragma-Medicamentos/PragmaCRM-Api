import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  CustomerParams,
  ListCustomerCreditsQuery,
  ListCustomerSalesQuery,
  ListCustomersQuery,
  UpdateCustomerLocationInput,
} from '../../domain/schemas/customer.schema';
import {
  CustomerCore,
  CustomerCreditItem,
  CustomerCreditTotals,
  CustomerListItem,
  CustomerProfile,
  CustomerSaleItem,
} from '../../domain/types/customer.types';
import { Paginated } from '../../domain/types/pagination.types';
import {
  assertCustomerExists,
  getCreditStatus,
  getCustomerProfile,
  listCustomerSales,
  listCustomers,
  updateCustomerLocation,
} from '../../services/customer.service';

export class CustomersController {
  /** Customer list with filters. */
  public async list(req: Request, res: Response) {
    try {
      const query = req.query as unknown as ListCustomersQuery;
      const page = await listCustomers(prisma, query);

      const response: ApiResponse<Paginated<CustomerListItem>> = {
        success: true,
        message: 'Customers retrieved successfully',
        data: page,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'CustomersController.list');
    }
  }

  /** Customer profile: identity, commercial summary and field notes (RF-02 CA1). */
  public async getById(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as CustomerParams;
      const profile = await getCustomerProfile(prisma, id);

      const response: ApiResponse<CustomerProfile> = {
        success: true,
        message: 'Customer retrieved successfully',
        data: profile,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'CustomersController.getById');
    }
  }

  /** Historial tab: full sales history, quotes included behind `type`. */
  public async listSales(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as CustomerParams;
      const query = req.query as unknown as ListCustomerSalesQuery;

      await assertCustomerExists(prisma, id);
      const page = await listCustomerSales(prisma, id, query);

      const response: ApiResponse<Paginated<CustomerSaleItem>> = {
        success: true,
        message: 'Customer sales retrieved successfully',
        data: page,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'CustomersController.listSales');
    }
  }

  /** Créditos y cobros tab: outstanding invoices plus portfolio totals. */
  public async listCredits(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as CustomerParams;
      const query = req.query as unknown as ListCustomerCreditsQuery;
      const page = await getCreditStatus(prisma, id, query);

      const response: ApiResponse<
        Paginated<CustomerCreditItem> & { totals: CustomerCreditTotals }
      > = {
        success: true,
        message: 'Customer credits retrieved successfully',
        data: page,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'CustomersController.listCredits');
    }
  }

  /** RF-02: set the customer's exact GPS pin for routing. */
  public async updateLocation(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as CustomerParams;
      const data = req.body as UpdateCustomerLocationInput;
      const customer = await updateCustomerLocation(prisma, id, data);

      const response: ApiResponse<CustomerCore> = {
        success: true,
        message: 'Customer location updated successfully',
        data: customer,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'CustomersController.updateLocation');
    }
  }
}
