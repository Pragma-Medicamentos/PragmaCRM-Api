import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  AssignRouteInput,
  CreateRouteInput,
  ListRoutesQuery,
  ReassignRouteInput,
  RouteAssignmentParams,
  RouteParams,
  UpdateRouteInput,
} from '../../domain/schemas/route.schema';
import {
  RouteAssignmentRecord,
  RouteRecord,
  createRoute,
  getRouteById,
  listRouteAssignments,
  listRoutes,
  unassignRouteDay,
  updateRoute,
} from '../../services/route.service';
import { assignRoute } from '../../use-cases/assign-route.use-case';
import { reassignRoute } from '../../use-cases/reassign-route.use-case';

export class RoutesController {
  public async list(req: Request, res: Response) {
    try {
      const { active } = req.query as unknown as ListRoutesQuery;
      const routes = await listRoutes(prisma, { active });

      const response: ApiResponse<RouteRecord[]> = {
        success: true,
        message: 'Routes retrieved successfully',
        data: routes,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.list');
    }
  }

  public async getById(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as RouteParams;
      const route = await getRouteById(prisma, id);

      const response: ApiResponse<RouteRecord> = {
        success: true,
        message: 'Route retrieved successfully',
        data: route,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.getById');
    }
  }

  public async create(req: Request, res: Response) {
    try {
      const data = req.body as CreateRouteInput;
      const route = await createRoute(prisma, data);

      const response: ApiResponse<RouteRecord> = {
        success: true,
        message: 'Route created successfully',
        data: route,
      };
      res.status(201).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.create');
    }
  }

  public async update(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as RouteParams;
      const data = req.body as UpdateRouteInput;
      const route = await updateRoute(prisma, id, data);

      const response: ApiResponse<RouteRecord> = {
        success: true,
        message: 'Route updated successfully',
        data: route,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.update');
    }
  }

  public async listAssignments(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as RouteParams;
      const assignments = await listRouteAssignments(prisma, id);

      const response: ApiResponse<RouteAssignmentRecord[]> = {
        success: true,
        message: 'Route assignments retrieved successfully',
        data: assignments,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.listAssignments');
    }
  }

  public async assign(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as RouteParams;
      const data = req.body as AssignRouteInput;
      const assignment = await assignRoute(prisma, id, data);

      const response: ApiResponse<RouteAssignmentRecord> = {
        success: true,
        message: 'Vendor assigned to route successfully',
        data: assignment,
      };
      res.status(201).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.assign');
    }
  }

  public async reassign(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as RouteParams;
      const data = req.body as ReassignRouteInput;
      const assignment = await reassignRoute(prisma, id, data);

      const response: ApiResponse<RouteAssignmentRecord> = {
        success: true,
        message: 'Route reassigned successfully',
        data: assignment,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.reassign');
    }
  }

  public async unassign(req: Request, res: Response) {
    try {
      const { id, day } = req.params as unknown as RouteAssignmentParams;
      await unassignRouteDay(prisma, id, day);

      const response: ApiResponse<null> = {
        success: true,
        message: 'Assignment removed successfully',
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.unassign');
    }
  }
}
