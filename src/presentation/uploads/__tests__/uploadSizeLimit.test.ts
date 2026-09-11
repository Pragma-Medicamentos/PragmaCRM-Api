import { Express } from 'express';
import request from 'supertest';

/**
 * The size limit is read from `envs` at import time, so this case lives in its
 * own file: it lowers the limit to 1 MB and loads the modules afterwards,
 * instead of generating a 50 MB file.
 *
 * It is worth testing separately because of a real trap: `handleError` treats
 * any object carrying `code` as a Prisma error, and a MulterError
 * (`code: 'LIMIT_FILE_SIZE'`) would surface as an opaque 500 if the middleware
 * did not translate it first.
 */

// Without the mock, importing the routes pulls in src/lib/prisma.ts and opens
// a connection pool that leaves Jest hanging.
const importSalesFileMock = jest.fn();
jest.mock('../../../use-cases/importSalesFile.use-case', () => ({
  importSalesFile: (...args: unknown[]) => importSalesFileMock(...args),
}));

describe('POST /api/v1/uploads/sales — size limit', () => {
  let app: Express;

  beforeAll(() => {
    jest.resetModules();
    process.env.UPLOAD_MAX_FILE_SIZE_MB = '1';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppRoutes } = require('../../routes') as typeof import('../../routes');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Server } = require('../../server') as typeof import('../../server');

    const server = new Server({ port: 0, routes: AppRoutes.routes });
    server.setup();
    app = server.app;
  });

  afterAll(() => {
    delete process.env.UPLOAD_MAX_FILE_SIZE_MB;
    jest.resetModules();
  });

  it('responds 413 and not 500 when the file exceeds the limit', async () => {
    const tooBig = Buffer.alloc(2 * 1024 * 1024, 'a');

    const res = await request(app)
      .post('/api/v1/uploads/sales')
      .attach('file', tooBig, 'sales.json');

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/exceeds the 1 MB limit/i);
    expect(importSalesFileMock).not.toHaveBeenCalled();
  });

  it('lets a file under the limit through', async () => {
    importSalesFileMock.mockResolvedValue({
      upload_id: 'u1',
      sales_received: 0,
      accepted: 0,
      rejected: 0,
      range: { from: null, to: null },
      rejections: [],
      rejections_truncated: 0,
      warnings: { sales_without_customer: 0, sales_without_user: 0 },
    });
    const small = Buffer.from(JSON.stringify([]), 'utf-8');

    const res = await request(app)
      .post('/api/v1/uploads/sales')
      .attach('file', small, 'sales.json');

    expect(res.status).toBe(201);
    expect(importSalesFileMock).toHaveBeenCalled();
  });
});
