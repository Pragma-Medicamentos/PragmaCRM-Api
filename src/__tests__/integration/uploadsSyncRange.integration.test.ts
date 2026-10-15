import { DateTime } from 'luxon';
import { ERP_TIMEZONE } from '../../lib/parseErpDate';
import { Client, prisma } from '../../lib/prisma';
import { getSalesSyncRange, SalesSyncRange } from '../../services/uploads.service';

/**
 * The pending-balance summary behind GET /uploads/sales/sync-range, against
 * real Postgres. Each case runs in a transaction that is rolled back, after
 * hiding whatever sales the database already had, so the global min/count only
 * sees the rows inserted here.
 */

class Rollback extends Error {}

const local = (iso: string) => DateTime.fromISO(iso, { zone: ERP_TIMEZONE }).toJSDate();

// 2026-10-15 in El Salvador: the 30..180-day window is 2026-04-18 .. 2026-09-15.
const now = DateTime.fromISO('2026-10-15T08:00:00', { zone: ERP_TIMEZONE });

const withSales = async (
  sales: { erp_sale_id: number; [key: string]: unknown }[]
): Promise<SalesSyncRange> => {
  let range: SalesSyncRange | undefined;
  await prisma
    .$transaction(async (tx: Client) => {
      await tx.sale.updateMany({ where: { deleted_at: null }, data: { deleted_at: new Date() } });
      await tx.sale.createMany({ data: sales });
      range = await getSalesSyncRange(tx, { now, minLookbackDays: 30, maxLookbackDays: 180 });
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  return range!;
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe('getSalesSyncRange against Postgres', () => {
  it('starts at the oldest quoted sale that still owes money', async () => {
    const range = await withSales([
      { erp_sale_id: 990001, erp_status: 2, pending_balance: 10, erp_quoted_at: local('2026-07-03T19:30:00') },
      // Paid, quotation, and removed sales do not count.
      { erp_sale_id: 990002, erp_status: 2, pending_balance: 0, erp_quoted_at: local('2026-05-01T09:00:00') },
      { erp_sale_id: 990003, erp_status: 1, pending_balance: 5, erp_quoted_at: local('2026-05-01T09:00:00') },
      {
        erp_sale_id: 990004,
        erp_status: 2,
        pending_balance: 5,
        erp_quoted_at: local('2026-05-01T09:00:00'),
        deleted_at: new Date(),
      },
    ]);

    expect(range).toMatchObject({
      from: '2026-07-03',
      to: '2026-10-15',
      oldest_pending_date: '2026-07-03',
      pending_sales: 1,
      pending_outside_range: 0,
    });
  });

  it('falls back to erp_created_at when erp_quoted_at is missing', async () => {
    const range = await withSales([
      { erp_sale_id: 990011, erp_status: 2, pending_balance: 10, erp_created_at: local('2026-08-20T10:00:00') },
    ]);

    expect(range.from).toBe('2026-08-20');
  });

  it('caps at the maximum lookback and counts the sales left out', async () => {
    const range = await withSales([
      { erp_sale_id: 990021, erp_status: 2, pending_balance: 10, erp_quoted_at: local('2025-12-01T10:00:00') },
      { erp_sale_id: 990022, erp_status: 2, pending_balance: 10, erp_quoted_at: local('2026-04-17T23:00:00') },
      { erp_sale_id: 990023, erp_status: 2, pending_balance: 10, erp_quoted_at: local('2026-04-18T00:00:00') },
    ]);

    expect(range).toMatchObject({
      from: '2026-04-18',
      oldest_pending_date: '2025-12-01',
      pending_sales: 3,
      pending_outside_range: 2,
    });
  });
});
