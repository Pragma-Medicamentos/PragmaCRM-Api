import { Router } from 'express';
import { uploadJsonFile } from '../middleware/uploadJsonFile';
import { UploadsController } from './uploads.controller';

export class UploadsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new UploadsController();

    // Manual upload of the ERP sales JSON (RF-03, HU-02).
    // No validateBody here: the body is multipart, not JSON, and content
    // validation happens sale by sale inside the service.
    router.post('/sales', uploadJsonFile, controller.importSales);

    return router;
  }
}
