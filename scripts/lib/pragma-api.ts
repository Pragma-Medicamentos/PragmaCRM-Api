import { Agent, fetch, FormData } from 'undici';

export interface PragmaApiConfig {
  baseUrl: string;
  apiKey: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  adminEmail: string;
  adminPassword: string;
}

export interface SalesSyncRange {
  from: string;
  to: string;
  oldest_pending_date: string | null;
  pending_sales: number;
  pending_outside_range: number;
  min_lookback_days: number;
  max_lookback_days: number;
}

export interface ImportInProgressStatus {
  in_progress: boolean;
  upload_id: string | null;
  status: string | null;
  updated_at: string | null;
}

export interface ImportSalesResponse {
  message: string;
  data: {
    upload_id: string;
    sales_received: number;
    accepted: number;
    rejected: number;
    inserted: number;
    updated: number;
    sync_failed: number;
    removed: { annulled: number; missing: number };
    sellers: { created_count: number; unmapped: unknown[] };
    rejections: { index: number; erp_sale_id: number | null; reason: string }[];
    warnings?: unknown[];
  };
}

export class PragmaApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(`PragmaCRM API responded ${status}: ${message}`);
  }
}

// The import answers only when it finishes, which can take longer than the
// 300 s undici waits for response headers by default.
const longRequestAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

/** Access token of the admin account the sync runs as (POST /uploads is admin-only). */
export const loginAdmin = async (config: PragmaApiConfig): Promise<string> => {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.adminEmail, password: config.adminPassword }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
    msg?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(
      `Supabase login failed (${response.status}): ${body.error_description ?? body.msg ?? 'no access token'}`
    );
  }
  return body.access_token;
};

const callApi = async <T>(
  config: PragmaApiConfig,
  token: string,
  path: string,
  init: { method?: string; body?: FormData; timeoutMs?: number } = {}
): Promise<{ message: string; data: T }> => {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'x-api-key': config.apiKey, Authorization: `Bearer ${token}` },
    body: init.body,
    dispatcher: longRequestAgent,
    signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string; data?: T };
  if (!response.ok) {
    throw new PragmaApiError(response.status, body.message ?? response.statusText);
  }
  return { message: body.message ?? '', data: body.data as T };
};

export const getSalesSyncRange = async (
  config: PragmaApiConfig,
  token: string
): Promise<SalesSyncRange> =>
  (await callApi<SalesSyncRange>(config, token, '/api/v1/uploads/sales/sync-range')).data;

export const getImportInProgress = async (
  config: PragmaApiConfig,
  token: string
): Promise<ImportInProgressStatus> =>
  (await callApi<ImportInProgressStatus>(config, token, '/api/v1/uploads/sales/in-progress')).data;

/** POST /api/v1/uploads/sales: multipart, field `file`, `.json` name (uploadJsonFile.ts). */
export const uploadSalesFile = async (
  config: PragmaApiConfig,
  token: string,
  json: Buffer,
  filename: string,
  timeoutMs: number
): Promise<ImportSalesResponse> => {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(json)], { type: 'application/json' }), filename);
  return callApi<ImportSalesResponse['data']>(config, token, '/api/v1/uploads/sales', {
    method: 'POST',
    body: form,
    timeoutMs,
  });
};
