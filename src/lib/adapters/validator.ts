import { ZodType } from 'zod';
import { IValidator } from '../../domain/interfaces/validator.interface';

class ZodValidator implements IValidator {
  parse<T>(schema: ZodType<T>, data: unknown): T {
    return schema.parse(data);
  }

  safeParse<T>(
    schema: ZodType<T>,
    data: unknown
  ): { success: true; data: T } | { success: false; errors: string[] } {
    const result = schema.safeParse(data);

    if (result.success) {
      return { success: true, data: result.data };
    }

    return {
      success: false,
      errors: result.error.issues.map(
        (e) => `${e.path.join('.')}: ${e.message}`
      ),
    };
  }
}

export const validator: IValidator = new ZodValidator();
