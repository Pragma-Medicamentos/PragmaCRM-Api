import { NextFunction, Request, Response } from 'express';
import multer, { MulterError, memoryStorage } from 'multer';
import { extname } from 'path';
import { envs } from '../../config/envs';
import { CustomError } from '../../domain/errors/CustomError';

/**
 * Intake of the ERP sales JSON file (RF-03).
 *
 * Multipart is used instead of a JSON body for two reasons: the size limit
 * stays scoped to this route instead of raising `express.json({ limit })` for
 * the whole API, and it allows rejecting by extension and weight before
 * spending memory parsing megabytes.
 *
 * The file lives in memory: it is parsed and discarded, never stored.
 */

/** Multipart field name. The frontend must use exactly this one. */
export const UPLOAD_FIELD_NAME = 'file';

const upload = multer({
  storage: memoryStorage(),
  limits: {
    fileSize: envs.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (extname(file.originalname).toLowerCase() !== '.json') {
      callback(CustomError.badRequest('The file must have a .json extension.'));
      return;
    }
    callback(null, true);
  },
});

/**
 * Translates multer errors into CustomError.
 *
 * This is necessary, not cosmetic: `handleError` has a branch that treats any
 * object carrying `code` as a Prisma error. A MulterError arrives with
 * `code: 'LIMIT_FILE_SIZE'`, would not match P2002/P2003/P2025, and would
 * surface as an opaque 500 instead of the 413 it deserves.
 */
const translateMulterError = (error: unknown): unknown => {
  if (!(error instanceof MulterError)) return error;

  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return new CustomError(
        `The file exceeds the ${envs.UPLOAD_MAX_FILE_SIZE_MB} MB limit.`,
        413
      );
    case 'LIMIT_FILE_COUNT':
      return CustomError.badRequest('Only one file can be uploaded at a time.');
    case 'LIMIT_UNEXPECTED_FILE':
      return CustomError.badRequest(
        `Unexpected file field. The file must be sent in the "${UPLOAD_FIELD_NAME}" field.`
      );
    default:
      // Covers malformed multipart bodies, such as a part sent with no field
      // name, where busboy's own wording ("Field name missing") tells the
      // caller nothing actionable.
      return CustomError.badRequest(
        `The file could not be read. Send it as multipart/form-data in the "${UPLOAD_FIELD_NAME}" field.`
      );
  }
};

/**
 * Leaves the uploaded file in `req.file`. Fails with 400 when none arrived, so
 * the controller can assume it exists.
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
          `No file received. Send the JSON in the "${UPLOAD_FIELD_NAME}" field as multipart/form-data.`
        )
      );
      return;
    }

    next();
  });
};
