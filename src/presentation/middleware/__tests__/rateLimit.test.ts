import request from 'supertest';
import { NextFunction, Request, Response, Router } from 'express';
import { Server } from '../../server';
import { ROLES } from '../../../domain/types/auth.types';
import {
  API_RATE_LIMITS,
  AUTH_RATE_LIMITS,
  createRateLimiter,
  userKey,
} from '../rateLimit';

// Server rather than a bare express() so the 429 goes through the global
// error handler and the real ApiResponse envelope is asserted.
// Stands in for requireAuth: the per-user limiters only run after it.
const fakeAuth = (req: Request, _res: Response, next: NextFunction) => {
  const id = req.header('x-test-user');
  if (id) {
    req.authUser = {
      id,
      authUserId: id,
      role: ROLES.ADMIN,
      name: 'Test',
      email: null,
      passwordSetAt: null,
    };
  }
  next();
};

const buildApp = (limit: number, keyGenerator?: (req: Request) => string) => {
  const router = Router();
  router.post(
    '/api/test/limited',
    fakeAuth,
    createRateLimiter('test', { limit, windowMs: 60_000, keyGenerator }),
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

describe('per-user limiters', () => {
  it('give each user behind the same IP their own budget', async () => {
    const app = buildApp(1, userKey);

    const first = await request(app)
      .post('/api/test/limited')
      .set('X-Forwarded-For', '203.0.113.1')
      .set('x-test-user', 'user-a');
    const other = await request(app)
      .post('/api/test/limited')
      .set('X-Forwarded-For', '203.0.113.1')
      .set('x-test-user', 'user-b');
    const repeat = await request(app)
      .post('/api/test/limited')
      .set('X-Forwarded-For', '203.0.113.2')
      .set('x-test-user', 'user-a');

    expect(first.status).toBe(200);
    expect(other.status).toBe(200);
    // Same user from another IP still shares its budget.
    expect(repeat.status).toBe(429);
  });
});

describe('API_RATE_LIMITS', () => {
  it('keeps the expensive endpoints well under the global budget', () => {
    const perMinute = ({ limit, windowMs }: { limit: number; windowMs: number }) =>
      limit / (windowMs / 60_000);

    expect(perMinute(API_RATE_LIMITS.uploads)).toBeLessThan(
      perMinute(API_RATE_LIMITS.reports)
    );
    expect(perMinute(API_RATE_LIMITS.reports)).toBeLessThan(
      perMinute(API_RATE_LIMITS.global)
    );
  });
});

describe('AUTH_RATE_LIMITS', () => {
  it('keeps /otp, which sends an email per call, the tightest', () => {
    expect(AUTH_RATE_LIMITS.otp.limit).toBeLessThan(AUTH_RATE_LIMITS.login.limit);
    expect(AUTH_RATE_LIMITS.login.limit).toBeLessThan(AUTH_RATE_LIMITS.refresh.limit);
  });
});
