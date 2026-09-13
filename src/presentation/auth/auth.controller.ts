import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { RequestOtpInput } from '../../domain/schemas/auth.schema';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import { requestLoginOtp } from '../../use-cases/request-login-otp.use-case';

export class AuthController {
  public async requestOtp(req: Request, res: Response) {
    try {
      const { email } = req.body as RequestOtpInput;
      await requestLoginOtp(prisma, email);

      const response: ApiResponse = {
        success: true,
        message: 'Codigo enviado al correo. Expira en 10 minutos',
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'AuthController.requestOtp');
    }
  }
}
