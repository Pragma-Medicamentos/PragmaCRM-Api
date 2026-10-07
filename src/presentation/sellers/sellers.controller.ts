import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  CreateSellerInput,
  ListSellersQuery,
  SellerParams,
  UpdateSellerInput,
  UpdateSellerStatusInput,
} from '../../domain/schemas/seller.schema';
import {
  getSellerById,
  listSellers,
  SellerRecord,
} from '../../services/seller.service';
import { createSeller } from '../../use-cases/create-seller.use-case';
import { resendSellerOtp } from '../../use-cases/resend-seller-otp.use-case';
import {
  AccessEmailStatus,
  updateSellerEverywhere,
} from '../../use-cases/update-seller.use-case';
import { setSellerStatusEverywhere } from '../../use-cases/set-seller-status.use-case';

const UPDATE_MESSAGES: Record<NonNullable<AccessEmailStatus> | 'none', string> = {
  none: 'Vendedor actualizado correctamente',
  sent: 'Vendedor actualizado y habilitado. Se envio un codigo de acceso al correo (expira en 10 minutos)',
  failed:
    'Vendedor actualizado, pero no se pudo enviar el correo de acceso. Reenvie el codigo desde el listado',
};

export class SellersController {
  public async list(req: Request, res: Response) {
    try {
      const { active } = req.query as unknown as ListSellersQuery;
      const sellers = await listSellers(prisma, { active });

      const response: ApiResponse<SellerRecord[]> = {
        success: true,
        message: 'Vendedores obtenidos correctamente',
        data: sellers,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'SellersController.list');
    }
  }

  public async getById(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as SellerParams;
      const seller = await getSellerById(prisma, id);

      const response: ApiResponse<SellerRecord> = {
        success: true,
        message: 'Vendedor obtenido correctamente',
        data: seller,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'SellersController.getById');
    }
  }

  public async create(req: Request, res: Response) {
    try {
      const data = req.body as CreateSellerInput;
      const { seller } = await createSeller(prisma, data);

      const response: ApiResponse<SellerRecord> = {
        success: true,
        message:
          'Vendedor creado. Se envio un codigo de acceso al correo (expira en 10 minutos)',
        data: seller,
      };
      res.status(201).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'SellersController.create');
    }
  }

  public async update(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as SellerParams;
      const data = req.body as UpdateSellerInput;
      const { seller, accessEmail } = await updateSellerEverywhere(prisma, id, data);

      // The email is saved even when the access email fails, so this stays a
      // 200: `access_email` is what tells the dashboard to warn the admin.
      const response: ApiResponse<SellerRecord & { access_email: AccessEmailStatus }> = {
        success: true,
        message: UPDATE_MESSAGES[accessEmail ?? 'none'],
        data: { ...seller, access_email: accessEmail },
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'SellersController.update');
    }
  }

  public async resendOtp(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as SellerParams;
      const seller = await resendSellerOtp(prisma, id);

      const response: ApiResponse<SellerRecord> = {
        success: true,
        message: 'Codigo reenviado al correo del vendedor. Expira en 10 minutos',
        data: seller,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'SellersController.resendOtp');
    }
  }

  public async updateStatus(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as SellerParams;
      const { active } = req.body as UpdateSellerStatusInput;
      const seller = await setSellerStatusEverywhere(prisma, id, active);

      const response: ApiResponse<SellerRecord> = {
        success: true,
        message: active ? 'Vendedor habilitado' : 'Vendedor deshabilitado',
        data: seller,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'SellersController.updateStatus');
    }
  }
}
