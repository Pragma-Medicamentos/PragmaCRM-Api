import { Request, Response, NextFunction } from 'express';
import { ZodType, ZodError } from 'zod';
import { ApiResponse, ValidationError } from '../../domain/interfaces';
import { logger } from '../../lib/adapters/logger';

const logValidationFailure = (
  req: Request,
  res: Response,
  source: 'body' | 'query' | 'params',
  errors: ValidationError[]
): void => {
  logger.warn('Request validation failed', {
    method: req.method,
    path: req.originalUrl.split('?')[0],
    source,
    errors,
    request_id: res.getHeader('X-Request-ID'),
  });
};

const buildValidator =
  <T>(
    schema: ZodType<T>,
    source: 'body' | 'query' | 'params',
    message: string
  ) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      // El valor parseado reemplaza al original: a partir de aqui el
      // controlador trabaja con datos ya tipados y normalizados por Zod.
      const parsed = schema.parse(req[source]);
      if (source === 'body') {
        req.body = parsed;
      } else if (source === 'query') {
        req.query = parsed as typeof req.query;
      } else {
        req.params = parsed as typeof req.params;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors: ValidationError[] = error.issues.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        logValidationFailure(req, res, source, formattedErrors);

        const response: ApiResponse = {
          success: false,
          message,
          errors: formattedErrors,
        };

        return res.status(400).json(response);
      }

      const response: ApiResponse = {
        success: false,
        message: 'Internal server error',
      };
      return res.status(500).json(response);
    }
  };

export const validateBody = <T>(schema: ZodType<T>) =>
  buildValidator(schema, 'body', 'Validation error in request body');

export const validateQuery = <T>(schema: ZodType<T>) =>
  buildValidator(schema, 'query', 'Validation error in query parameters');

export const validateParams = <T>(schema: ZodType<T>) =>
  buildValidator(schema, 'params', 'Validation error in route parameters');
