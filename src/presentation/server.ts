import express, {
  NextFunction,
  Request,
  Response,
  Router,
} from 'express';
import { clerkMiddleware } from '@clerk/express';
import { logger } from '../lib/adapters/logger';
import { handleError } from '../lib/handleError';
import { ApiResponse } from '../domain/interfaces';
import { requestMetadata } from './middleware/requestMetadata';
import { envs } from '../config/envs';

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
   * Monta middlewares, rutas y los handlers de 404/error. Esta separado de
   * start() para que los tests de integracion puedan construir la app sin
   * abrir un puerto.
   */
  setup() {
    //* Confia en un unico reverse proxy (Nginx) delante de la app para que el
    //* IP real del cliente se derive de X-Forwarded-For. Se usa un numero de
    //* saltos (no `true`) para que un cliente no pueda falsificar la cabecera.
    this.app.set('trust proxy', 1);

    //* Middlewares
    this.app.use(requestMetadata);
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    //* Verifica el JWT pero NO rechaza nada: quien exige sesion es requireAuth.
    this.app.use(
      clerkMiddleware({
        ...(envs.CLERK_AUTHORIZED_PARTIES.length > 0 && {
          authorizedParties: envs.CLERK_AUTHORIZED_PARTIES,
        }),
      })
    );

    //* Routes
    this.app.use(this.routes);

    //* 404 handler
    this.app.use((_req: Request, res: Response) => {
      res
        .status(404)
        .json({ success: false, message: 'Not found' } satisfies ApiResponse);
    });

    //* Error handler global — captura errores de middlewares
    //* (p. ej. un body JSON malformado) y de rutas asincronas.
    //* Express solo lo reconoce como error handler si declara los 4 argumentos,
    //* de ahi que `_next` este presente aunque no se use.
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
    this.serverListener = this.app.listen(this.port, () => {
      logger.info(`Server running on port ${this.port}`);
    });
  }

  public close() {
    this.serverListener?.close();
  }
}
