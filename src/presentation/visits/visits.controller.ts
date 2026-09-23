import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import { ConfirmVisitInput } from '../../domain/schemas/visit.schema';
import { ConfirmedVisit } from '../../domain/types/visit.types';
import { confirmVisit } from '../../services/visit.service';

export class VisitsController {
  /**
   * RF-06: confirm a planned stop with GPS coordinates and the device
   * timestamp. 201 when the visit is created, 200 when the request repeats a
   * stop that was already confirmed (offline retry).
   */
  public async confirm(req: Request, res: Response) {
    try {
      // requireAuth guarantees authUser on this route group.
      const sellerId = (req.authUser as NonNullable<Request['authUser']>).id;
      const data = req.body as ConfirmVisitInput;

      const visit = await prisma.$transaction((tx) =>
        confirmVisit(tx, sellerId, data)
      );

      const response: ApiResponse<ConfirmedVisit> = {
        success: true,
        message: visit.replayed
          ? 'Stop was already confirmed'
          : 'Stop confirmed successfully',
        data: visit,
      };
      res.status(visit.replayed ? 200 : 201).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'VisitsController.confirm');
    }
  }
}
