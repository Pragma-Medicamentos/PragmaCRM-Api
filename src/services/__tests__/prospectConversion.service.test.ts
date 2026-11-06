import { Client } from '../../lib/prisma';
import {
  convertProspectByName,
  convertProspectsByName,
} from '../prospectConversion.service';
import {
  findProspectNameMatches,
  linkProspectToCustomer,
} from '../../repositories/prospectConversion.repository';

jest.mock('../../repositories/prospectConversion.repository', () => ({
  findProspectNameMatches: jest.fn(),
  linkProspectToCustomer: jest.fn(),
}));

const findMatchesMock = findProspectNameMatches as jest.Mock;
const linkMock = linkProspectToCustomer as jest.Mock;

const NOW = new Date('2026-10-20T15:00:00Z');
const candidate = (n: number) => ({
  customer_id: `customer-${n}`,
  name: `Farmacia ${n}`,
  erp_customer_id: 1000 + n,
});
const match = (prospectId: string, customers: ReturnType<typeof candidate>[]) => ({
  prospect_id: prospectId,
  prospect_name: `Prospect ${prospectId}`,
  customers,
});

const clientWith = (prospect: unknown) =>
  ({ prospect: { findFirst: jest.fn().mockResolvedValue(prospect) } }) as unknown as Client;

beforeEach(() => {
  jest.clearAllMocks();
  linkMock.mockResolvedValue({ moved_stops: 1 });
});

describe('convertProspectsByName', () => {
  it('converts a single match and only alerts on a shared name', async () => {
    findMatchesMock.mockResolvedValue([
      match('p1', [candidate(1)]),
      match('p2', [candidate(2), candidate(3)]),
    ]);

    const summary = await convertProspectsByName({} as Client, NOW);

    expect(linkMock).toHaveBeenCalledTimes(1);
    expect(linkMock).toHaveBeenCalledWith(expect.anything(), 'p1', 'customer-1', '2026-10-20');
    expect(summary.converted).toEqual([
      {
        prospect_id: 'p1',
        prospect_name: 'Prospect p1',
        customer_id: 'customer-1',
        customer_name: 'Farmacia 1',
        moved_stops: 1,
      },
    ]);
    expect(summary.alerts).toEqual([
      { prospect_id: 'p2', prospect_name: 'Prospect p2', candidates: [candidate(2), candidate(3)] },
    ]);
  });

  it('skips a prospect converted concurrently (the link touched no row)', async () => {
    findMatchesMock.mockResolvedValue([match('p1', [candidate(1)])]);
    linkMock.mockResolvedValue(null);

    const summary = await convertProspectsByName({} as Client, NOW);

    expect(summary).toEqual({ converted: [], alerts: [] });
  });

  it('uses the local day: 23:30 in El Salvador is still the same date', async () => {
    findMatchesMock.mockResolvedValue([match('p1', [candidate(1)])]);

    await convertProspectsByName({} as Client, new Date('2026-10-21T05:30:00Z'));

    expect(linkMock).toHaveBeenCalledWith(expect.anything(), 'p1', 'customer-1', '2026-10-20');
  });
});

describe('convertProspectByName', () => {
  it('converts the only match', async () => {
    findMatchesMock.mockResolvedValue([match('p1', [candidate(1)])]);

    const result = await convertProspectByName(
      clientWith({ active: true, customer_id: null }),
      'p1',
      NOW
    );

    expect(result).toMatchObject({ prospect_id: 'p1', customer_id: 'customer-1', moved_stops: 1 });
    expect(findMatchesMock).toHaveBeenCalledWith(expect.anything(), 'p1');
  });

  it.each([
    ['missing', null, 404, undefined],
    ['already converted', { active: false, customer_id: 'customer-9' }, 409, 'PROSPECT_ALREADY_CONVERTED'],
    ['inactive', { active: false, customer_id: null }, 409, 'PROSPECT_INACTIVE'],
  ])('rejects a %s prospect', async (_label, prospect, statusCode, code) => {
    await expect(convertProspectByName(clientWith(prospect), 'p1', NOW)).rejects.toMatchObject({
      statusCode,
      code,
    });
    expect(linkMock).not.toHaveBeenCalled();
  });

  it('answers PROSPECT_NO_MATCHING_CUSTOMER without a match', async () => {
    findMatchesMock.mockResolvedValue([]);

    await expect(
      convertProspectByName(clientWith({ active: true, customer_id: null }), 'p1', NOW)
    ).rejects.toMatchObject({ statusCode: 409, code: 'PROSPECT_NO_MATCHING_CUSTOMER' });
  });

  it('answers PROSPECT_NAME_AMBIGUOUS naming every candidate, and links nothing', async () => {
    findMatchesMock.mockResolvedValue([match('p1', [candidate(2), candidate(3)])]);

    await expect(
      convertProspectByName(clientWith({ active: true, customer_id: null }), 'p1', NOW)
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROSPECT_NAME_AMBIGUOUS',
      message: expect.stringContaining('Farmacia 2 (ERP 1002), Farmacia 3 (ERP 1003)'),
    });
    expect(linkMock).not.toHaveBeenCalled();
  });

  it('answers PROSPECT_ALREADY_CONVERTED when it lost a race', async () => {
    findMatchesMock.mockResolvedValue([match('p1', [candidate(1)])]);
    linkMock.mockResolvedValue(null);

    await expect(
      convertProspectByName(clientWith({ active: true, customer_id: null }), 'p1', NOW)
    ).rejects.toMatchObject({ statusCode: 409, code: 'PROSPECT_ALREADY_CONVERTED' });
  });
});
