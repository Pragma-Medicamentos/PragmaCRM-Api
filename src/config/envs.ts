import 'dotenv/config';
import { get } from 'env-var';

export const envs = {
  // Entorno a nivel de aplicacion. Distinto de NODE_ENV: este describe el
  // despliegue (dev/staging/prod), NODE_ENV describe el modo de ejecucion de
  // Node y solo debe valer development o production.
  STAGE: get('STAGE').required().asEnum(['dev', 'staging', 'prod'] as const),
  PORT: get('PORT').required().asPortNumber(),

  // Cadena de conexion a PostgreSQL. La consume el adapter de Prisma
  // (src/lib/prisma.ts) y tambien prisma.config.ts para las migraciones.
  DATABASE_URL: get('DATABASE_URL').required().asString(),

  LOG_LEVEL: get('LOG_LEVEL').default('info').asString(),

  // Las tres CLERK_* las lee @clerk/express de process.env; aqui solo se validan.
  CLERK_PUBLISHABLE_KEY: get('CLERK_PUBLISHABLE_KEY').required().asString(),
  CLERK_SECRET_KEY: get('CLERK_SECRET_KEY').required().asString(),
  // Opcional: con ella la verificacion de firma es local, sin descargar el JWKS.
  CLERK_JWT_KEY: get('CLERK_JWT_KEY').asString(),
  // Claim `azp`: sin esta lista sirve aqui un token emitido para otra app.
  CLERK_AUTHORIZED_PARTIES: get('CLERK_AUTHORIZED_PARTIES')
    .default('')
    .asArray(','),
};
