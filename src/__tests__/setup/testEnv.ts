// Server imports envs, which refuses to boot when a required variable is missing.
process.env.STAGE = process.env.STAGE ?? 'dev';
process.env.PORT = process.env.PORT ?? '3000';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'fake-service-role-key';
process.env.API_KEY = process.env.API_KEY ?? 'test-api-key';
