import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import { CreateProspectInput } from '../../domain/schemas/prospect.schema';
import { CreatedProspect } from '../../domain/types/prospect.types';
import { createProspect } from '../../services/prospect.service';

export class ProspectsController {
  /**
   * PCRM-62: register a prospect from the seller app. Always 201 on success.
   * Seller id comes from the JWT (`req.authUser`), never from the body.
   */
  public async create(req: Request, res: Response) {
    try {
      // requireAuth guarantees authUser on this route group.
      const sellerId = (req.authUser as NonNullable<Request['authUser']>).id;
      const data = req.body as CreateProspectInput;

      const prospect = await prisma.$transaction((tx) =>
        createProspect(tx, sellerId, data)
      );

      const response: ApiResponse<CreatedProspect> = {
        success: true,
        message: 'Prospect registered successfully',
        data: prospect,
      };
      res.status(201).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ProspectsController.create');
    }
  }
}
