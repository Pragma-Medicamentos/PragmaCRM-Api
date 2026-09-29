import { envs } from './config/envs';
import { logger } from './lib/adapters/logger';
import { AppRoutes } from './presentation/routes';
import { Server } from './presentation/server';

// How long to wait for in-flight requests before quitting anyway. Docker sends
// SIGKILL ten seconds after SIGTERM, so this has to land first.
const SHUTDOWN_TIMEOUT_MS = 8_000;

(async () => {
  await main();
})();

async function main() {
  const server = new Server({
    port: envs.PORT,
    routes: AppRoutes.routes,
  });

  registerShutdownHandlers(server);

  try {
    await server.start();
  } catch (err) {
    logger.error('Server failed to start', { err });
    process.exit(1);
  }
}

/**
 * Without an explicit handler Node ignores SIGTERM when it runs as PID 1, which
 * is exactly how the container starts it: the orchestrator would wait out its
 * grace period and then SIGKILL, cutting requests in flight and leaving pg
 * connections behind on every redeploy.
 */
function registerShutdownHandlers(server: Server) {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    // A second Ctrl+C (or a repeated SIGTERM) must not start a second teardown.
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`${signal} received, shutting down`);

    // Unref'd so this timer never keeps the process alive on its own.
    const forceExit = setTimeout(() => {
      logger.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await server.close();
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { err });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Exit non-zero on an unexpected failure so the orchestrator restarts the
  // container instead of keeping a process in an unknown state.
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { err });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
    process.exit(1);
  });
}
