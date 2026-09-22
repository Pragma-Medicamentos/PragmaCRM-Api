import nodemailer from 'nodemailer';

/** Fixed recipient for the daily sales summary, per CLAUDE.md's daily summary rule. */
export const DEFAULT_RECIPIENT = 'facturacion@pragmamed.com';

export interface SendDailySalesEmailOptions {
  to?: string;
  subject: string;
}

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set to send the daily sales email`);
  }
  return value;
};

/**
 * Sends the plain-text daily sales summary over SMTP. Fails loudly instead of
 * silently skipping the send when SMTP isn't configured, so an unattended
 * (cron/agent) run surfaces the missing setup rather than reporting success
 * without the email having gone out.
 */
export const sendDailySalesEmail = async (
  body: string,
  options: SendDailySalesEmailOptions,
): Promise<void> => {
  const host = requireEnv('SMTP_HOST');
  const port = requireEnv('SMTP_PORT');
  const user = requireEnv('SMTP_USER');
  const pass = requireEnv('SMTP_PASSWORD');
  const from = requireEnv('MAIL_FROM');

  const to = options.to ?? process.env.DAILY_SALES_EMAIL_TO ?? DEFAULT_RECIPIENT;

  const transporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });

  await transporter.sendMail({ from, to, subject: options.subject, text: body });
};
