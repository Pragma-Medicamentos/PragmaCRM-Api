import { z } from 'zod';
import { CustomError } from '../../domain/errors/CustomError';
import { handleError } from '../handleError';

describe('handleError', () => {
  it('passes through a CustomError status and message', () => {
    expect(handleError(CustomError.notFound('Cliente no encontrado'))).toEqual({
      statusCode: 404,
      message: 'Cliente no encontrado',
    });
  });

  it('maps a ZodError to 400 listing every issue', () => {
    const schema = z.object({ nombre: z.string(), edad: z.number() });
    const result = schema.safeParse({ nombre: 1, edad: 'x' });

    const { statusCode, message } = handleError(
      (result as { error: unknown }).error
    );

    expect(statusCode).toBe(400);
    expect(message).toContain('nombre:');
    expect(message).toContain('edad:');
  });

  it('honours an Express `expose` error in the 4xx range', () => {
    const bodyParserError = Object.assign(new Error('Unexpected token }'), {
      expose: true,
      statusCode: 400,
    });

    expect(handleError(bodyParserError)).toEqual({
      statusCode: 400,
      message: 'Unexpected token }',
    });
  });

  it.each([
    ['P2002', 409, 'Duplicate record.'],
    ['P2003', 400, 'Reference error: one or more related records do not exist.'],
    ['P2025', 404, 'Record not found.'],
    [
      'P2028',
      504,
      'The import timed out while writing sales. Try a smaller file, or contact support if a single month fails.',
    ],
    [
      'P2034',
      409,
      'A database deadlock occurred during import. Wait until any running import finishes, then retry.',
    ],
  ])('maps the Prisma code %s', (code, statusCode, message) => {
    expect(handleError({ code })).toEqual({ statusCode, message });
  });

  it('falls back to an opaque 500 for anything unknown', () => {
    expect(handleError(new Error('detalle interno'))).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
  });
});
