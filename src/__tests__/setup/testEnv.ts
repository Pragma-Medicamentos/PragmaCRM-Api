// Server importa envs, que corta si falta una requerida. La pk debe ser un pk_test_<base64> valido.
process.env.STAGE = process.env.STAGE ?? 'dev';
process.env.PORT = process.env.PORT ?? '3000';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.CLERK_PUBLISHABLE_KEY =
  process.env.CLERK_PUBLISHABLE_KEY ?? 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k';
process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? 'sk_test_fake';
