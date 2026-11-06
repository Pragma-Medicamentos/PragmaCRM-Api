import { Client } from '../../lib/prisma';
import { deleteProspect } from '../prospect.service';
import { softDeleteProspect } from '../../repositories/prospect.repository';

jest.mock('../../repositories/prospect.repository', () => ({
  softDeleteProspect: jest.fn(),
}));

const softDeleteMock = softDeleteProspect as jest.Mock;

// 20:00 local on the 25th is already the 26th in UTC: the cut must use the business date.
const NOW = new Date('2026-10-26T02:00:00Z');
const PROSPECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('deleteProspect', () => {
  it('soft-deletes from the business date and reports the removed stops', async () => {
    softDeleteMock.mockResolvedValue({ removed_stops: 3 });

    const result = await deleteProspect({} as Client, PROSPECT_ID, NOW);

    expect(softDeleteMock).toHaveBeenCalledWith(expect.anything(), PROSPECT_ID, '2026-10-25');
    expect(result).toEqual({ id: PROSPECT_ID, deleted: true, removed_stops: 3 });
  });

  it('answers 404 when no row was touched (missing or already deleted)', async () => {
    softDeleteMock.mockResolvedValue(null);

    await expect(deleteProspect({} as Client, PROSPECT_ID, NOW)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
