import { importSalesFile } from '../importSalesFile.use-case';
import { prisma } from '../../lib/prisma';
import { tryAcquireImportLock } from '../../repositories/uploads.repository';
import { stageSalesFile } from '../../services/salesStaging.service';
import {
  SYNC_CHUNK_SIZE,
  finalizeUploadSync,
  markUploadProcessing,
  syncStagedSalesChunk,
} from '../../services/salesSync.service';
import { deleteAuthUser } from '../../services/supabaseAdmin.service';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
  },
}));

jest.mock('../../repositories/uploads.repository', () => ({
  tryAcquireImportLock: jest.fn(),
}));

jest.mock('../../services/salesStaging.service', () => ({
  stageSalesFile: jest.fn(),
}));

jest.mock('../../services/salesSync.service', () => {
  const actual = jest.requireActual('../../services/salesSync.service');
  return {
    ...actual,
    syncStagedSalesChunk: jest.fn(),
    finalizeUploadSync: jest.fn(),
    markUploadProcessing: jest.fn(),
  };
});

jest.mock('../../services/supabaseAdmin.service', () => ({
  deleteAuthUser: jest.fn(),
}));

jest.mock('../../lib/adapters/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const prismaTransaction = prisma.$transaction as jest.Mock;
const tryLockMock = tryAcquireImportLock as jest.Mock;
const stageSalesFileMock = stageSalesFile as jest.Mock;
const syncChunkMock = syncStagedSalesChunk as jest.Mock;
const finalizeMock = finalizeUploadSync as jest.Mock;
const markProcessingMock = markUploadProcessing as jest.Mock;
const deleteAuthUserMock = deleteAuthUser as jest.Mock;

const stagingResult = {
  upload_id: 'upload-1',
  sales_received: 120,
  accepted: 120,
  rejected: 0,
  range: { from: new Date('2025-09-01'), to: new Date('2025-09-30') },
  rejections: [],
  rejections_truncated: 0,
  warnings: {
    sales_without_customer: 0,
    sales_without_user: 0,
    quotations_skipped: 0,
  },
};

describe('importSalesFile — chunked sync orchestration (PCRM-168)', () => {
  beforeEach(() => {
    prismaTransaction.mockReset();
    tryLockMock.mockReset();
    tryLockMock.mockResolvedValue(true);
    stageSalesFileMock.mockReset();
    syncChunkMock.mockReset();
    finalizeMock.mockReset();
    markProcessingMock.mockReset();
    markProcessingMock.mockResolvedValue(undefined);
    deleteAuthUserMock.mockReset();
    deleteAuthUserMock.mockResolvedValue(undefined);

    // Each $transaction call invokes its callback with a fake tx client.
    prismaTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ __fakeTx: true })
    );
  });

  it('stages once, syncs in multiple transactions when pending exceeds chunk size, then finalizes', async () => {
    stageSalesFileMock.mockResolvedValue(stagingResult);

    // Simulate ceil(120 / 50) = 3 sync chunks.
    syncChunkMock
      .mockResolvedValueOnce({ inserted: 50, updated: 0, sync_failed: 0, has_more: true })
      .mockResolvedValueOnce({ inserted: 50, updated: 0, sync_failed: 0, has_more: true })
      .mockResolvedValueOnce({ inserted: 20, updated: 0, sync_failed: 0, has_more: false });
    finalizeMock.mockResolvedValue(undefined);

    const result = await importSalesFile(Buffer.from('[]'), 'admin-1');

    // 1 lock + 1 stage + 1 mark-processing + 3 sync chunks + 1 finalize.
    expect(prismaTransaction).toHaveBeenCalledTimes(7);
    expect(markProcessingMock).toHaveBeenCalledWith(expect.anything(), 'upload-1');
    expect(stageSalesFileMock).toHaveBeenCalledTimes(1);
    expect(syncChunkMock).toHaveBeenCalledTimes(3);
    expect(syncChunkMock).toHaveBeenCalledWith(
      expect.anything(),
      'upload-1',
      expect.objectContaining({ createdAuthUserIds: [] }),
      SYNC_CHUNK_SIZE
    );
    expect(finalizeMock).toHaveBeenCalledTimes(1);
    expect(finalizeMock).toHaveBeenCalledWith(expect.anything(), 'upload-1', {
      inserted: 120,
      updated: 0,
      sync_failed: 0,
    });

    expect(result).toMatchObject({
      upload_id: 'upload-1',
      accepted: 120,
      processed: 120,
      inserted: 120,
      updated: 0,
      sync_failed: 0,
    });
  });

  it('uses a single sync transaction when one chunk drains everything', async () => {
    stageSalesFileMock.mockResolvedValue({ ...stagingResult, accepted: 10, sales_received: 10 });
    syncChunkMock.mockResolvedValue({
      inserted: 10,
      updated: 0,
      sync_failed: 0,
      has_more: false,
    });
    finalizeMock.mockResolvedValue(undefined);

    await importSalesFile(Buffer.from('[]'), 'admin-1');

    // 1 lock + 1 stage + 1 mark-processing + 1 sync + 1 finalize.
    expect(prismaTransaction).toHaveBeenCalledTimes(5);
    expect(syncChunkMock).toHaveBeenCalledTimes(1);
    expect(finalizeMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back auth users when a sync chunk throws, without swallowing the error', async () => {
    stageSalesFileMock.mockResolvedValue(stagingResult);

    // First chunk commits (in the real world); second throws. Orchestrator
    // still runs auth cleanup for any ids recorded on the shared provisioning.
    syncChunkMock
      .mockResolvedValueOnce({ inserted: 50, updated: 0, sync_failed: 0, has_more: true })
      .mockImplementationOnce(async (_tx, _uploadId, provisioning) => {
        provisioning.createdAuthUserIds.push('auth-orphan-1');
        throw Object.assign(new Error('Transaction API error'), { code: 'P2028' });
      });

    await expect(importSalesFile(Buffer.from('[]'), 'admin-1')).rejects.toMatchObject({
      code: 'P2028',
    });

    expect(deleteAuthUserMock).toHaveBeenCalledWith('auth-orphan-1');
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  describe('import advisory lock (PCRM-169)', () => {
    it('takes the lock before staging anything', async () => {
      stageSalesFileMock.mockResolvedValue({ ...stagingResult, accepted: 1, sales_received: 1 });
      syncChunkMock.mockResolvedValue({
        inserted: 1,
        updated: 0,
        sync_failed: 0,
        has_more: false,
      });
      finalizeMock.mockResolvedValue(undefined);

      await importSalesFile(Buffer.from('[]'), 'admin-1');

      expect(tryLockMock).toHaveBeenCalledTimes(1);
      expect(tryLockMock.mock.invocationCallOrder[0]).toBeLessThan(
        stageSalesFileMock.mock.invocationCallOrder[0]
      );
    });

    it('rejects with a 409 CustomError and stages nothing when the lock is taken', async () => {
      tryLockMock.mockResolvedValue(false);

      await expect(importSalesFile(Buffer.from('[]'), 'admin-1')).rejects.toMatchObject({
        statusCode: 409,
        message: 'An import is already in progress. Wait until it finishes before uploading again.',
      });

      expect(stageSalesFileMock).not.toHaveBeenCalled();
      expect(syncChunkMock).not.toHaveBeenCalled();
      expect(finalizeMock).not.toHaveBeenCalled();
      // Only the lock transaction ran.
      expect(prismaTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
