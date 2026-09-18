import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  CustomerParams,
  UpdateCustomerLocationInput,
} from '../../domain/schemas/customer.schema';
import {
  CustomerRecord,
  updateCustomerLocation,
} from '../../services/customer.service';

export class CustomersController {
  public async updateLocation(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as CustomerParams;
      const data = req.body as UpdateCustomerLocationInput;
      const customer = await updateCustomerLocation(prisma, id, data);

      const response: ApiResponse<CustomerRecord> = {
        success: true,
        message: 'Ubicación GPS del cliente actualizada correctamente',
        data: customer,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'CustomersController.updateLocation');
    }
  }
}
