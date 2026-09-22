import { Request, Response } from 'express';
import { ApiResponse } from '../../domain/interfaces';
import { sendErrorResponse } from '../../lib/sendErrorResponse';
import { prisma } from '../../lib/prisma';
import {
  AssignRouteInput,
  CreateRouteInput,
  CreateRouteStopInput,
  ListRoutesQuery,
  ReassignRouteInput,
  ReorderRouteStopsInput,
  RouteAssignmentParams,
  RouteParams,
  RouteStopParams,
  UpdateRouteInput,
  UpdateRouteStopInput,
} from '../../domain/schemas/route.schema';
import {
  RouteAssignmentRecord,
  RouteRecord,
  RouteStopRecord,
  addRouteStop,
  createRoute,
  getRouteById,
  listRouteAssignments,
  listRouteStops,
  listRoutes,
  softDeleteRouteStop,
  unassignRouteDay,
  updateRoute,
  updateRouteStop,
} from '../../services/route.service';
import { assignRoute } from '../../use-cases/assign-route.use-case';
import { reassignRoute } from '../../use-cases/reassign-route.use-case';
import { reorderRouteStops } from '../../use-cases/reorder-route-stops.use-case';

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

  public async listStops(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as RouteParams;
      await getRouteById(prisma, id);
      const stops = await listRouteStops(prisma, id);

      const response: ApiResponse<RouteStopRecord[]> = {
        success: true,
        message: 'Route stops retrieved successfully',
        data: stops,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.listStops');
    }
  }

  public async addStop(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as RouteParams;
      const data = req.body as CreateRouteStopInput;
      const stop = await addRouteStop(prisma, id, data);

      const response: ApiResponse<RouteStopRecord> = {
        success: true,
        message: 'Stop added to route successfully',
        data: stop,
      };
      res.status(201).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.addStop');
    }
  }

  public async updateStop(req: Request, res: Response) {
    try {
      const { id, stopId } = req.params as unknown as RouteStopParams;
      const data = req.body as UpdateRouteStopInput;
      const stop = await updateRouteStop(prisma, id, stopId, data);

      const response: ApiResponse<RouteStopRecord> = {
        success: true,
        message: 'Stop updated successfully',
        data: stop,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.updateStop');
    }
  }

  public async removeStop(req: Request, res: Response) {
    try {
      const { id, stopId } = req.params as unknown as RouteStopParams;
      await softDeleteRouteStop(prisma, id, stopId);

      const response: ApiResponse<null> = {
        success: true,
        message: 'Stop removed successfully',
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.removeStop');
    }
  }

  public async reorderStops(req: Request, res: Response) {
    try {
      const { id } = req.params as unknown as RouteParams;
      const { stop_ids } = req.body as ReorderRouteStopsInput;
      const stops = await reorderRouteStops(prisma, id, stop_ids);

      const response: ApiResponse<RouteStopRecord[]> = {
        success: true,
        message: 'Route stops reordered successfully',
        data: stops,
      };
      res.status(200).json(response);
    } catch (error) {
      sendErrorResponse(res, error, 'RoutesController.reorderStops');
    }
  }
}
