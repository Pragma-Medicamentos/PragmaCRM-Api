import request from 'supertest';
import { Router } from 'express';
import { Server } from '../../server';
import { AUTH_RATE_LIMITS, createRateLimiter } from '../rateLimit';

// Server rather than a bare express() so the 429 goes through the global
// error handler and the real ApiResponse envelope is asserted.
const buildApp = (limit: number) => {
  const router = Router();
  router.post(
    '/api/test/limited',
    createRateLimiter('test', { limit, windowMs: 60_000 }),
    (_req, res) => {
      res.status(200).json({ success: true, message: 'ok' });
    }
  );

  const server = new Server({ port: 0, routes: router });
  server.setup();
  return server.app;
};

describe('createRateLimiter', () => {
  it('lets requests through up to the limit', async () => {
    const app = buildApp(2);

    for (let i = 0; i < 2; i++) {
      const res = await request(app).post('/api/test/limited');
      expect(res.status).toBe(200);
    }
  });

  it('answers 429 with the ApiResponse envelope once the limit is exceeded', async () => {
    const app = buildApp(2);

    await request(app).post('/api/test/limited');
    await request(app).post('/api/test/limited');
    const res = await request(app).post('/api/test/limited');

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      success: false,
      message: 'Too many requests, try again later',
    });
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('counts each client IP separately', async () => {
    const app = buildApp(1);

    // trust proxy = 1: the last X-Forwarded-For hop is the client IP.
    const first = await request(app)
      .post('/api/test/limited')
      .set('X-Forwarded-For', '203.0.113.1');
    const other = await request(app)
      .post('/api/test/limited')
      .set('X-Forwarded-For', '203.0.113.2');
    const repeat = await request(app)
      .post('/api/test/limited')
      .set('X-Forwarded-For', '203.0.113.1');

    expect(first.status).toBe(200);
    expect(other.status).toBe(200);
    expect(repeat.status).toBe(429);
  });
});

describe('AUTH_RATE_LIMITS', () => {
  it('keeps /otp, which sends an email per call, the tightest', () => {
    expect(AUTH_RATE_LIMITS.otp.limit).toBeLessThan(AUTH_RATE_LIMITS.login.limit);
    expect(AUTH_RATE_LIMITS.login.limit).toBeLessThan(AUTH_RATE_LIMITS.refresh.limit);
  });
});
