import request from 'supertest';
import { Router } from 'express';
import { Server } from '../../server';
import { requireApiKey } from '../apiKey';
import { envs } from '../../../config/envs';

// Server rather than a bare express() so responses go through the global
// error handler and the real ApiResponse envelope is asserted.
const buildApp = () => {
  const router = Router();
  router.get('/api/test/protected', requireApiKey, (_req, res) => {
    res.status(200).json({ success: true, message: 'ok' });
  });

  const server = new Server({ port: 0, routes: router });
  server.setup();
  return server.app;
};

const app = buildApp();

describe('requireApiKey', () => {
  it('responde 401 cuando falta el header x-api-key', async () => {
    const res = await request(app).get('/api/test/protected');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: 'Invalid or missing API key',
    });
  });

  it('responde 401 cuando la API key no coincide', async () => {
    const res = await request(app)
      .get('/api/test/protected')
      .set('x-api-key', 'clave-incorrecta');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('deja pasar cuando la API key coincide', async () => {
    const res = await request(app)
      .get('/api/test/protected')
      .set('x-api-key', envs.API_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'ok' });
  });

  it('acepta el header con mayúsculas (HTTP los normaliza a minúsculas)', async () => {
    const res = await request(app)
      .get('/api/test/protected')
      .set('X-API-Key', envs.API_KEY);

    expect(res.status).toBe(200);
  });
});