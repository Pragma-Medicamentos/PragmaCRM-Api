import pino from 'pino';
import { ILogger } from '../../domain/interfaces/logger.interface';

class PinoLogger implements ILogger {
  private readonly logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

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
