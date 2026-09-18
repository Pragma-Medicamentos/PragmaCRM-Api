import { z } from 'zod';

export const customerParamsSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export type CustomerParams = z.infer<typeof customerParamsSchema>;

// RF-02: el administrador establece la ubicación GPS exacta del cliente para
// el ruteo. WGS84 (SRID 4326), igual que `customer.location`.
export const updateCustomerLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type UpdateCustomerLocationInput = z.infer<
  typeof updateCustomerLocationSchema
>;
