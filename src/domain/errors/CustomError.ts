export class CustomError extends Error {
  public statusCode: number;
  public code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, CustomError.prototype); // Required to extend Error correctly
  }

  // Factory methods for common errors
  static badRequest(message: string, code?: string) {
    return new CustomError(message, 400, code);
  }

  static unauthorized(message = 'Unauthorized', code?: string) {
    return new CustomError(message, 401, code);
  }

  static forbidden(message = 'Access denied', code?: string) {
    return new CustomError(message, 403, code);
  }

  static notFound(message = 'Resource not found', code?: string) {
    return new CustomError(message, 404, code);
  }

  static conflict(message: string, code?: string) {
    return new CustomError(message, 409, code);
  }

  static unprocessable(message: string, code?: string) {
    return new CustomError(message, 422, code);
  }

  static internal(message = 'Internal server error', code?: string) {
    return new CustomError(message, 500, code);
  }
}
