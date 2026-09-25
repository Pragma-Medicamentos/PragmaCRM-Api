import { z } from 'zod';

const emailField = z.string().trim().toLowerCase().email('Invalid email');

export const requestOtpSchema = z.object({
  email: emailField,
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

// Password and OTP are alternate ways to open the same browser session.
// `.strict()` rejects a body that sends both, so one request cannot mix them.
export const loginSchema = z.union([
  z
    .object({
      email: emailField,
      password: z.string().min(1, 'Password is required'),
    })
    .strict(),
  z
    .object({
      email: emailField,
      otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be 6 digits'),
    })
    .strict(),
]);

export type LoginInput = z.infer<typeof loginSchema>;
