import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { AuthenticatedUser } from '../../domain/types/auth.types';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { CustomError } from '../../domain/errors/CustomError';

export class MeController {
  public async getSession(req: Request, res: Response) {
    try {
      // Va detras de requireAuth: la guarda es para el tipo, no para el flujo.
      if (!req.authUser) throw CustomError.unauthorized();

      const response: ApiResponse<AuthenticatedUser> = {
        success: true,
        message: 'Sesión válida',
        data: req.authUser,
      };

      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'MeController.getSession');
    }
  }
}
