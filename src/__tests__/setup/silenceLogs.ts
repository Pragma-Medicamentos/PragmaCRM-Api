// pino escribe a stdout, lo que ahoga la salida de Jest. Los tests unitarios no
// verifican logs, asi que se apagan por defecto. Para depurar una corrida:
// `LOG_LEVEL=debug npm test`.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
