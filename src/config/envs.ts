import 'dotenv/config';
import { get } from 'env-var';

export const envs = {
  // Application-level environment. Different from NODE_ENV: this one describes
  // the deployment (dev/staging/prod), NODE_ENV describes how Node runs and
  // must only ever be development or production.
  STAGE: get('STAGE').required().asEnum(['dev', 'staging', 'prod'] as const),
  PORT: get('PORT').required().asPortNumber(),

  // PostgreSQL connection string. Consumed by the Prisma adapter
  // (src/lib/prisma.ts) and by prisma.config.ts for migrations.
  DATABASE_URL: get('DATABASE_URL').required().asString(),

  LOG_LEVEL: get('LOG_LEVEL').default('info').asString(),

  // Maximum size of the ERP sales JSON on manual upload (RF-03).
  //
  // Measured against the real export: 5.13 MiB for 346 sales over 29 days,
  // i.e. 15.5 KB per sale and ~11.9 sales per day with the two salespeople
  // currently active. From there, 100 MiB covers ~6,700 sales: about 18 months
  // at today's rate, or ~7 months if the team grows to the 5 salespeople
  // CLAUDE.md 7.9 anticipates. The agreed requirement was 5 months of history.
  //
  // The value matches Salesforce's import limit (100 MB per file), the market
  // reference for bulk CRM loads.
  //
  // It is a ceiling, not a reservation: a normal 5 MB upload uses ~17 MB of
  // memory. The peak only reaches ~330 MB if a 100 MB file is genuinely
  // uploaded, which in practice happens once, during the initial backfill.
  //
  // MIND WHEN DEPLOYING: nginx caps at 1 MB by default and answers 413 before
  // the request ever reaches here. `client_max_body_size` must be raised to
  // the same value on the VPS, or the user sees nginx's HTML error instead of
  // the ApiResponse envelope.
  UPLOAD_MAX_FILE_SIZE_MB: get('UPLOAD_MAX_FILE_SIZE_MB').default('100').asIntPositive(),
};
