import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';

// setup() wires middlewares and routes without opening a port, so supertest
// can hit the real app without starting the server.
const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

describe('GET /api/health', () => {
  it('responds 200 with the ApiResponse envelope', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'API is healthy',
      data: {
        uptime: expect.any(Number),
        version: expect.any(String),
      },
    });
  });

  it('sets an X-Request-ID header', async () => {
    const res = await request(app).get('/api/health');

    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });
});

describe('unknown routes', () => {
  it('responds 404 with the ApiResponse envelope', async () => {
    const res = await request(app)
      .get('/non-existent-route')
      .set('x-api-key', envs.API_KEY);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Not found' });
  });
});

describe('malformed JSON body', () => {
  it('is translated to a 400 by the global error handler', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
