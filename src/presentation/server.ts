import cors from 'cors';
import express, {
  NextFunction,
  Request,
  Response,
  Router,
} from 'express';
import { logger } from '../lib/adapters/logger';
import { handleError } from '../lib/handleError';
import { ApiResponse } from '../domain/interfaces';
import { requestMetadata } from './middleware/requestMetadata';
import { warmUpJwks } from '../lib/supabaseJwt';
import { envs } from '../config/envs';
import { prisma } from '../lib/prisma';

// CORS_ORIGIN is comma-separated so one deploy can allow more than one origin
// (e.g. the web dashboard's own domain plus a preview deployment) without a
// second env var.
const corsOrigins = (): string[] =>
  envs.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

interface Options {
  port: number;
  routes: Router;
}

export class Server {
  public readonly app = express();
  private serverListener?: ReturnType<typeof this.app.listen>;
  private readonly port: number;
  private readonly routes: Router;

  constructor(options: Options) {
    const { port, routes } = options;
    this.port = port;
    this.routes = routes;
  }

  /**
   * Wires middlewares, routes and the 404/error handlers. Kept separate from
   * start() so integration tests can build the app without opening a port.
   */
  setup() {
    //* Trusts a single reverse proxy (Nginx) in front of the app so the real
    //* client IP is derived from X-Forwarded-For. A hop count is used instead
    //* of `true` so a client cannot forge the header.
    this.app.set('trust proxy', 1);

    //* Middlewares
    this.app.use(requestMetadata);
    // credentials: the browser will only attach the HttpOnly session cookies
    // (PCRM-109) when the response allows them and the web origin is echoed
    // back. `origin` is already an explicit list, never `*`.
    this.app.use(
      cors({
        origin: corsOrigins(),
        credentials: true,
      })
    );
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    //* Routes
    this.app.use(this.routes);

    //* 404 handler
    this.app.use((_req: Request, res: Response) => {
      res
        .status(404)
        .json({ success: false, message: 'Not found' } satisfies ApiResponse);
    });

    //* Global error handler — catches errors raised by middlewares (a
    //* malformed JSON body, for instance) and by async routes.
    //* Express only recognises it as an error handler if all four arguments
    //* are declared, which is why `_next` is present even though it is unused.
    this.app.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        const { statusCode, message } = handleError(err);
        if (statusCode === 500) logger.error('Unhandled error', { err });
        res
          .status(statusCode)
          .json({ success: false, message } satisfies ApiResponse);
      }
    );
  }

  async start() {
    this.setup();

    //* Pays the JWKS fetch at boot so the first request of the day does not.
    await warmUpJwks();

    //* Resolves once the port is actually bound and rejects if it cannot be
    //* (EADDRINUSE, for instance), so the caller decides what to do instead of
    //* the failure surfacing as an uncaught 'error' event.
    await new Promise<void>((resolve, reject) => {
      const listener = this.app.listen(this.port, () => {
        logger.info(`Server running on port ${this.port}`);
        resolve();
      });

      listener.once('error', reject);
      this.serverListener = listener;
    });
  }

  /**
   * Stops accepting connections, waits for the in-flight ones to finish and
   * releases the database pool. Awaited on SIGTERM (src/app.ts) so a redeploy
   * does not cut requests mid-flight.
   */
  public async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.serverListener) return resolve();
      this.serverListener.close(() => resolve());
    });

    await prisma.$disconnect();
  }
}
