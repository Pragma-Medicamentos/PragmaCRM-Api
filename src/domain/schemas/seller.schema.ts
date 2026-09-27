import { z } from 'zod';

// The seller's id in Efactsoft (`venta.id_usuario`): the key the import uses
// to map sales to this user.
const erpUserIdSchema = z.number().int().positive('ID de Efactsoft inválido');

export const createSellerSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(255),
  email: z.string().trim().toLowerCase().email('Email inválido'),
  erp_user_id: erpUserIdSchema.optional(),
});

export type CreateSellerInput = z.infer<typeof createSellerSchema>;

export const updateSellerSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es requerido').max(255).optional(),
    email: z.string().trim().toLowerCase().email('Email inválido').optional(),
    // null clears the link.
    erp_user_id: erpUserIdSchema.nullable().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.email !== undefined ||
      data.erp_user_id !== undefined,
    { message: 'Debe enviar al menos un campo para actualizar' }
  );

  export type UpdateSellerInput = z.infer<typeof updateSellerSchema>;

export const updateSellerStatusSchema = z.object({
  active: z.boolean(),
});

export type UpdateSellerStatusInput = z.infer<typeof updateSellerStatusSchema>;

export const sellerParamsSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export type SellerParams = z.infer<typeof sellerParamsSchema>;

export const listSellersQuerySchema = z.object({
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type ListSellersQuery = z.infer<typeof listSellersQuerySchema>;