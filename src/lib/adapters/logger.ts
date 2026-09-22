import pino from 'pino';
import { ILogger } from '../../domain/interfaces/logger.interface';
import { envs } from '../../config/envs';

class PinoLogger implements ILogger {
  private readonly logger = pino({ level: envs.LOG_LEVEL });

  info(message: string, data?: object): void {
    this.logger.info(data ?? {}, message);
  }

  warn(message: string, data?: object): void {
    this.logger.warn(data ?? {}, message);
  }

  error(message: string, data?: object): void {
    this.logger.error(data ?? {}, message);
  }

  debug(message: string, data?: object): void {
    this.logger.debug(data ?? {}, message);
  }
}

export const logger: ILogger = new PinoLogger();
