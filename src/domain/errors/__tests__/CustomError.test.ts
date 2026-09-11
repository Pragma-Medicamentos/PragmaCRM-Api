import { CustomError } from '../CustomError';

describe('CustomError', () => {
  it('is an instance of Error and of CustomError', () => {
    const error = new CustomError('boom', 500);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CustomError);
  });

  it.each([
    ['badRequest', CustomError.badRequest('bad'), 400, 'bad'],
    ['unauthorized', CustomError.unauthorized(), 401, 'Unauthorized'],
    ['forbidden', CustomError.forbidden(), 403, 'Access denied'],
    ['notFound', CustomError.notFound(), 404, 'Resource not found'],
    ['conflict', CustomError.conflict('dup'), 409, 'dup'],
    ['unprocessable', CustomError.unprocessable('nope'), 422, 'nope'],
    ['internal', CustomError.internal(), 500, 'Internal server error'],
  ])('%s builds the expected status and message', (_name, error, status, message) => {
    expect(error.statusCode).toBe(status);
    expect(error.message).toBe(message);
  });

  it('lets the caller override the default message', () => {
    expect(CustomError.notFound('Cliente no encontrado').message).toBe(
      'Cliente no encontrado'
    );
  });
});
