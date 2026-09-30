import { StopType } from '../schemas/daily-route.schema';

/**
 * Response of POST /api/v1/sellers/:sellerId/daily-route/extra-stops
 * (PCRM-158): a one-off stop added by an Administrador for a single date,
 * outside the route's planned composition. `route_customer` / `route_user`
 * are never touched.
 */
export interface ExtraStop {
  id: string;
  seller_id: string;
  route_user_id: string;
  route_id: string;
  route_name: string;
  date: string;
  customer_id: string;
  customer_name: string;
  stop_type: StopType;
  reason: string | null;
  is_extra: true;
  created_at: Date;
}

export const EXTRA_STOP_ERROR_CODES = {
  EXTRA_STOP_PAST_DATE: 'EXTRA_STOP_PAST_DATE',
  SELLER_NOT_FOUND: 'SELLER_NOT_FOUND',
  SELLER_INACTIVE: 'SELLER_INACTIVE',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  CUSTOMER_NO_GPS: 'CUSTOMER_NO_GPS',
  SELLER_NO_ROUTE_ON_DATE: 'SELLER_NO_ROUTE_ON_DATE',
  ROUTE_ID_REQUIRED: 'ROUTE_ID_REQUIRED',
  ROUTE_NOT_ASSIGNED: 'ROUTE_NOT_ASSIGNED',
  EXTRA_STOP_DUPLICATE: 'EXTRA_STOP_DUPLICATE',
  EXTRA_STOP_NOT_FOUND: 'EXTRA_STOP_NOT_FOUND',
  EXTRA_STOP_HAS_CHECKIN: 'EXTRA_STOP_HAS_CHECKIN',
  EXTRA_STOP_DELETE_PAST: 'EXTRA_STOP_DELETE_PAST',
} as const;

export type ExtraStopErrorCode = (typeof EXTRA_STOP_ERROR_CODES)[keyof typeof EXTRA_STOP_ERROR_CODES];
