const sendMail = jest.fn().mockResolvedValue(undefined);
const createTransport = jest.fn().mockReturnValue({ sendMail });

jest.mock('nodemailer', () => ({ createTransport: (...args: unknown[]) => createTransport(...args) }));

import { DEFAULT_RECIPIENT, sendDailySalesEmail } from '../lib/send-daily-sales-email';

const SMTP_ENV = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'bot@pragmamed.com',
  SMTP_PASSWORD: 'secret',
  MAIL_FROM: 'bot@pragmamed.com',
};

describe('sendDailySalesEmail', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...SMTP_ENV };
    delete process.env.DAILY_SALES_EMAIL_TO;
    delete process.env.SMTP_SECURE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('sends to the default recipient with the given subject and body', async () => {
    await sendDailySalesEmail('Amoxicilina — 24', { subject: 'Ventas de ayer (20/09/2026)' });

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'bot@pragmamed.com', pass: 'secret' },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'bot@pragmamed.com',
      to: DEFAULT_RECIPIENT,
      subject: 'Ventas de ayer (20/09/2026)',
      text: 'Amoxicilina — 24',
    });
  });

  it('honors an explicit recipient over the default', async () => {
    await sendDailySalesEmail('body', { subject: 'subj', to: 'otro@pragmamed.com' });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'otro@pragmamed.com' }),
    );
  });

  it('honors DAILY_SALES_EMAIL_TO when no explicit recipient is given', async () => {
    process.env.DAILY_SALES_EMAIL_TO = 'env@pragmamed.com';

    await sendDailySalesEmail('body', { subject: 'subj' });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'env@pragmamed.com' }),
    );
  });

  it.each(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'])(
    'throws when %s is missing',
    async (missing) => {
      delete process.env[missing];

      await expect(sendDailySalesEmail('body', { subject: 'subj' })).rejects.toThrow(missing);
    },
  );
});
