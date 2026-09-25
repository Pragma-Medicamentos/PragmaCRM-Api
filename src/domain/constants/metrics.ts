/**
 * Open-ended histogram of 1e "Frecuencia de compra por cliente": average days
 * between consecutive purchases. The SQL counts customers per bucket in this
 * order and the service labels the counts with it, so both must share it.
 */
export const PURCHASE_FREQUENCY_BUCKETS = [
  { label: '0-7', min_days: 0, max_days: 7 },
  { label: '8-15', min_days: 8, max_days: 15 },
  { label: '16-30', min_days: 16, max_days: 30 },
  { label: '31-60', min_days: 31, max_days: 60 },
  { label: '61+', min_days: 61, max_days: null },
] as const;
