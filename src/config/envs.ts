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
};
