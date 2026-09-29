/**
 * API Response Interface
 *
 * A single, simple envelope for every API response. The optional fields let it
 * serve both success and error cases.
 */

/**
 * A single validation error
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Standard API response
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: ValidationError[];
  code?: string; // Stable machine-readable error code for client to translate
}
