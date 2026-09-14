export class CustomError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, CustomError.prototype); // Required to extend Error correctly
  }

  // Factory methods for common errors
  static badRequest(message: string) {
    return new CustomError(message, 400);
  }

  static unauthorized(message = 'Unauthorized') {
    return new CustomError(message, 401);
  }

  static forbidden(message = 'Access denied') {
    return new CustomError(message, 403);
  }

  static notFound(message = 'Resource not found') {
    return new CustomError(message, 404);
  }

  static conflict(message: string) {
    return new CustomError(message, 409);
  }

  static unprocessable(message: string) {
    return new CustomError(message, 422);
  }

  static internal(message = 'Internal server error') {
    return new CustomError(message, 500);
  }
}
