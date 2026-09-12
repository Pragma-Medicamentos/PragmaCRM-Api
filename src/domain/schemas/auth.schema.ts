import { z } from 'zod';

export const requestOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalido'),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
