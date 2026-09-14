export interface ILogger {
  info(_message: string, _data?: object): void;
  warn(_message: string, _data?: object): void;
  error(_message: string, _data?: object): void;
  debug(_message: string, _data?: object): void;
}
