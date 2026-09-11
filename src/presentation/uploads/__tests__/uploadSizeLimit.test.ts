import { Express } from 'express';
import request from 'supertest';

/**
 * El limite de tamano se lee de `envs` en el momento del import, asi que este
 * caso vive en su propio archivo: baja el limite a 1 MB y carga los modulos
 * despues, en vez de generar un archivo de 50 MB.
 *
 * Vale la pena probarlo aparte porque es una trampa real: `handleError` trata
 * cualquier objeto con `code` como error de Prisma, y un MulterError
 * (`code: 'LIMIT_FILE_SIZE'`) saldria como 500 opaco si el middleware no lo
 * tradujera antes.
 */

// Sin el mock, importar las rutas arrastra src/lib/prisma.ts y abre un pool de
// conexiones que deja a Jest colgado al terminar.
const importSalesFileMock = jest.fn();
jest.mock('../../../use-cases/importSalesFile.use-case', () => ({
  importSalesFile: (...args: unknown[]) => importSalesFileMock(...args),
}));

describe('POST /api/v1/uploads/sales — limite de tamano', () => {
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

  it('responde 413 y no 500 cuando el archivo excede el limite', async () => {
    const tooBig = Buffer.alloc(2 * 1024 * 1024, 'a');

    const res = await request(app)
      .post('/api/v1/uploads/sales')
      .attach('file', tooBig, 'ventas.json');

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/supera el limite de 1 MB/i);
    expect(importSalesFileMock).not.toHaveBeenCalled();
  });

  it('deja pasar un archivo por debajo del limite', async () => {
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
      .attach('file', small, 'ventas.json');

    expect(res.status).toBe(201);
    expect(importSalesFileMock).toHaveBeenCalled();
  });
});
