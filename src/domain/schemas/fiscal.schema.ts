import { z } from 'zod';

/*
 * PCRM-185: fiscal and contact fields shared by prospects and customers
 * (sanitary registration, NRC, NIT, email). One definition so both tables
 * accept exactly the same formats.
 */

/**
 * Optional text field. Blank input becomes null instead of failing the format
 * check, because forms send "" for a field the user left empty. Omitted stays
 * undefined so a PATCH can tell "leave as is" from "clear".
 */
const optionalText = (schema: z.ZodString) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? null : value,
    schema.nullable().optional()
  );

/**
 * NIT: the 14-digit form (0614-250621-108-6) or, for natural persons, the DUI
 * homologated as NIT since 2021 (01234567-8). Many pharmacies are registered
 * to their owner, so rejecting the DUI form would block real records.
 */
const NIT_PATTERN = /^(\d{4}-\d{6}-\d{3}-\d|\d{8}-\d)$/;
/** NRC: registration digits, hyphen, check digit (230204-4). */
const NRC_PATTERN = /^\d{1,8}-\d$/;

/** Spread into any object schema that writes these four columns. */
export const fiscalFields = {
  sanitary_registration: optionalText(z.string().trim().max(100)),
  nrc: optionalText(
    z.string().trim().regex(NRC_PATTERN, 'Invalid NRC, expected 230204-4')
  ),
  nit: optionalText(
    z
      .string()
      .trim()
      .regex(
        NIT_PATTERN,
        'Invalid NIT, expected 0614-250621-108-6 or 01234567-8'
      )
  ),
  email: optionalText(
    z.string().trim().toLowerCase().max(254).email('Invalid email')
  ),
};
