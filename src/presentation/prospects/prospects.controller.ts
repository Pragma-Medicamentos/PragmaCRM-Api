import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  CreateProspectAdminInput,
  CreateProspectInput,
  ListProspectsQuery,
  ProspectParams,
  UpdateProspectLocationInput,
} from '../../domain/schemas/prospect.schema';
import {
  CreatedProspect,
  ProspectListItem,
} from '../../domain/types/prospect.types';
import { Paginated } from '../../domain/types/pagination.types';
import {
  createProspect,
  createProspectAsAdmin,
  listProspects,
  updateProspectLocation,
} from '../../services/prospect.service';

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

  /**
   * PCRM-62 / PCRM-64: paginated prospect list for the admin web. Always 200.
   */
  public async list(req: Request, res: Response) {
    try {
      const query = req.query as unknown as ListProspectsQuery;
      const page = await listProspects(prisma, query);

      const response: ApiResponse<Paginated<ProspectListItem>> = {
        success: true,
        message: 'Prospects retrieved successfully',
        data: page,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ProspectsController.list');
    }
  }

  /**
   * PCRM-64: admin registers a prospect on behalf of a seller (phone lead,
   * walk-in, etc.). Always 201 on success.
   */
  public async createAdmin(req: Request, res: Response) {
    try {
      const data = req.body as CreateProspectAdminInput;

      const prospect = await prisma.$transaction((tx) =>
        createProspectAsAdmin(tx, data)
      );

      const response: ApiResponse<ProspectListItem> = {
        success: true,
        message: 'Prospect registered successfully',
        data: prospect,
      };
      res.status(201).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ProspectsController.createAdmin');
    }
  }

  /** PCRM-64: set or correct a prospect's GPS pin after creation. */
  public async updateLocation(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as ProspectParams;
      const data = req.body as UpdateProspectLocationInput;
      const prospect = await updateProspectLocation(prisma, id, data);

      const response: ApiResponse<ProspectListItem> = {
        success: true,
        message: 'Prospect location updated successfully',
        data: prospect,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'ProspectsController.updateLocation');
    }
  }
}
