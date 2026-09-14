export interface IValidator {
  parse<T>(_schema: unknown, _data: unknown): T;
  safeParse<T>(
    _schema: unknown,
    _data: unknown
  ): { success: true; data: T } | { success: false; errors: string[] };
}
