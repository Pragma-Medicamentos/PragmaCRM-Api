// pino writes to stdout, which drowns out Jest's own output. Unit tests do not
// assert on logs, so they are silenced by default. To debug a run:
// `LOG_LEVEL=debug npm test`.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
