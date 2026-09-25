import 'dotenv/config';
import { get } from 'env-var';
import { IANAZone } from 'luxon';

// Application-level environment. Different from NODE_ENV: this one describes
// the deployment (dev/staging/prod), NODE_ENV describes how Node runs and
// must only ever be development or production.
//
// Read before the object below because a couple of variables are only optional
// on a developer's machine.
const STAGE = get('STAGE').required().asEnum(['dev', 'staging', 'prod'] as const);
const isLocal = STAGE === 'dev';

// Business timezone (CLAUDE.md 5.7). ERP timestamps carry no offset and every
// local-day boundary (sales per day, visit day, metrics ranges) is computed in
// it. Validated at boot: luxon does not throw on an unknown zone, it silently
// yields invalid dates, and the metrics SQL inlines this value as a literal.
const BUSINESS_TIMEZONE = get('BUSINESS_TIMEZONE').default('America/El_Salvador').asString();
if (!IANAZone.isValidZone(BUSINESS_TIMEZONE)) {
  throw new Error(
    `env-var: "BUSINESS_TIMEZONE" should be a valid IANA timezone, but is set to "${BUSINESS_TIMEZONE}"`
  );
}

export const envs = {
  STAGE,
  PORT: get('PORT').required().asPortNumber(),

  // PostgreSQL connection string. Consumed by the Prisma adapter
  // (src/lib/prisma.ts) and by prisma.config.ts for migrations.
  DATABASE_URL: get('DATABASE_URL').required().asString(),

  LOG_LEVEL: get('LOG_LEVEL').default('info').asString(),

  // Changing it re-attributes the whole history to different local days
  // (sales per route, visit day checks, metrics periods). Not a tuning knob.
  BUSINESS_TIMEZONE,

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
  // MIND WHEN DEPLOYING: whatever proxy sits in front must allow a body this
  // large, or the user sees the proxy's HTML error instead of the ApiResponse
  // envelope. Traefik (what Dokploy runs on the VPS) has no body limit by
  // default; nginx caps at 1 MB and needs `client_max_body_size` raised.
  // See docs/DEPLOY_DOKPLOY.md.
  UPLOAD_MAX_FILE_SIZE_MB: get('UPLOAD_MAX_FILE_SIZE_MB').default('100').asIntPositive(),

  // Days without a visit (or without a purchase) after which a customer counts
  // as inactive. Drives "customers without visit" and "recovered customers" in
  // the metrics panel (RF-09). 30 days is provisional, taken from wireframe
  // 1f: the client has not signed a value yet (CLAUDE.md 5.8, Anexo B #4).
  // Each metrics request can still override it with `?inactivity_days=`.
  INACTIVITY_THRESHOLD_DAYS: get('INACTIVITY_THRESHOLD_DAYS').default('30').asIntPositive(),
  // Base URL of the Supabase project. Issuer and JWKS endpoint are derived
  // from it, so there is no point declaring three variables for one value.
  SUPABASE_URL: get('SUPABASE_URL').required().asUrlString(),

  // Full RLS bypass, usable over HTTP from anywhere: leaking it is worse than
  // leaking DATABASE_URL. Server only, never in web or mobile.
  SUPABASE_SERVICE_ROLE_KEY: get('SUPABASE_SERVICE_ROLE_KEY')
    .required()
    .asString(),

  // Comma-separated list of origins allowed to call this API from a browser
  // (the web dashboard's dev server and, later, its deployed origin). Not
  // needed by the Android app or server-to-server calls: those never send an
  // Origin header, so the browser-only CORS check does not apply to them.
  //
  // Required on a deployed environment: falling back to the Vite dev server
  // there would let the API boot and then reject the dashboard silently, which
  // reads as a frontend bug. Only `dev` keeps the default.
  CORS_ORIGIN: isLocal
    ? get('CORS_ORIGIN').default('http://localhost:5173').asString()
    : get('CORS_ORIGIN').required().asString(),

  // Browser session cookies (PCRM-109). `lax` is enough when the dashboard and
  // the API share a site (localhost ports, or subdomains of one registrable
  // domain). `none` is required when they do not: a cross-site credentialed
  // fetch drops Lax cookies. `none` forces Secure, which browsers reject on
  // plain HTTP except localhost.
  AUTH_COOKIE_SAMESITE: get('AUTH_COOKIE_SAMESITE')
    .default(isLocal ? 'lax' : 'none')
    .asEnum(['lax', 'strict', 'none'] as const),

  // Static shared secret sent in the `x-api-key` header. Every request to the
  // API except `/api/health` must present it (middleware/apiKey.ts). It is a
  // transport-level gate on top of the caller's own JWT auth: it carries no
  // identity, is not tied to any user or role, and grants nothing on its own.
  // Required: without it the server refuses to boot.
  API_KEY: get('API_KEY').required().asString(),
};
