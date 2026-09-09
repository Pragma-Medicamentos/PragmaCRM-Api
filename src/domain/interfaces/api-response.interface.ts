/**
 * API Response Interface
 *
 * Interfaz unica y simple para todas las respuestas de la API.
 * Los campos opcionales permiten usarla tanto para exito como para error.
 */

/**
 * Error de validacion individual
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Respuesta estandar de la API
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: ValidationError[];
}
