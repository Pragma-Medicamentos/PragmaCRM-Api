import { NextFunction, Request, Response } from 'express';
import multer, { MulterError, memoryStorage } from 'multer';
import { extname } from 'path';
import { envs } from '../../config/envs';
import { CustomError } from '../../domain/errors/CustomError';

/**
 * Recepcion del archivo JSON de Efactsoft (RF-03).
 *
 * Se usa multipart y no un body JSON por dos motivos: el limite de tamano
 * queda acotado a esta ruta en vez de subir `express.json({ limit })` para
 * toda la API, y permite rechazar por extension y peso antes de gastar
 * memoria parseando megabytes.
 *
 * El archivo vive en memoria: se parsea y se descarta, no se almacena.
 */

/** Nombre del campo multipart. El frontend debe usar exactamente este. */
export const UPLOAD_FIELD_NAME = 'file';

const upload = multer({
  storage: memoryStorage(),
  limits: {
    fileSize: envs.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (extname(file.originalname).toLowerCase() !== '.json') {
      callback(CustomError.badRequest('El archivo debe tener extension .json'));
      return;
    }
    callback(null, true);
  },
});

/**
 * Traduce los errores de multer a CustomError.
 *
 * Es necesario y no cosmetico: `handleError` tiene una rama que interpreta
 * cualquier objeto con `code` como error de Prisma. Un MulterError trae
 * `code: 'LIMIT_FILE_SIZE'`, no calzaria con P2002/P2003/P2025 y saldria como
 * un 500 opaco en vez del 413 que corresponde.
 */
const translateMulterError = (error: unknown): unknown => {
  if (!(error instanceof MulterError)) return error;

  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return new CustomError(
        `El archivo supera el limite de ${envs.UPLOAD_MAX_FILE_SIZE_MB} MB`,
        413
      );
    case 'LIMIT_FILE_COUNT':
      return CustomError.badRequest('Solo se puede subir un archivo a la vez');
    case 'LIMIT_UNEXPECTED_FILE':
      return CustomError.badRequest(
        `Campo de archivo inesperado. Se espera el campo "${UPLOAD_FIELD_NAME}"`
      );
    default:
      return CustomError.badRequest(`No se pudo leer el archivo: ${error.message}`);
  }
};

/**
 * Middleware que deja el archivo en `req.file`. Falla con 400 si no vino
 * ninguno, para que el controlador pueda asumir que existe.
 */
export const uploadJsonFile = (req: Request, res: Response, next: NextFunction): void => {
  upload.single(UPLOAD_FIELD_NAME)(req, res, (error: unknown) => {
    if (error) {
      next(translateMulterError(error));
      return;
    }

    if (!req.file) {
      next(
        CustomError.badRequest(
          `No se recibio ningun archivo. Envie el JSON en el campo "${UPLOAD_FIELD_NAME}" como multipart/form-data.`
        )
      );
      return;
    }

    next();
  });
};
