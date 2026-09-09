import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../../lib/adapters/logger';

/**
 * Asigna un X-Request-ID a cada peticion y registra metodo, ruta, status y
 * duracion cuando la respuesta termina. Es el primer middleware de la cadena
 * para que el id este disponible en el resto de capas.
 */
export const requestMetadata = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requestId = randomUUID();
  const startAt = process.hrtime.bigint();

  res.setHeader('X-Request-ID', requestId);

  res.on('finish', () => {
    const elapsed = Number(process.hrtime.bigint() - startAt) / 1_000_000;
    logger.info('Request completed', {
      method: req.method,
      // originalUrl y no req.path: Express reescribe req.url al entrar en un
      // router montado, y este callback corre despues del enrutado — req.path
      // ya seria relativo al router ("/" en vez de "/api/health").
      // Se recorta el query string para no loguear datos sensibles.
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      duration_ms: elapsed.toFixed(2),
      request_id: requestId,
    });
  });

  next();
};
