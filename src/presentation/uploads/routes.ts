import { Router } from 'express';
import { uploadJsonFile } from '../middleware/uploadJsonFile';
import { UploadsController } from './uploads.controller';

export class UploadsRoutes {
  static get routes(): Router {
    const router = Router();
    const controller = new UploadsController();

    // Carga manual del JSON de Efactsoft (RF-03, HU-02).
    // No lleva validateBody: el cuerpo es multipart, no JSON, y la validacion
    // del contenido ocurre venta por venta dentro del service.
    router.post('/sales', uploadJsonFile, controller.importSales);

    return router;
  }
}
