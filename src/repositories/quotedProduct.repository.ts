import { Client } from '../lib/prisma';

export interface QuotedProductRow {
  id: string;
  name: string;
}

// Same key as the suggestions search: "Pediátrico" and "pediatrico" are one product.
export const findQuotedProductByName = async (
  client: Client,
  name: string
): Promise<QuotedProductRow | undefined> => {
  const rows = await client.$queryRaw<QuotedProductRow[]>`
    SELECT id, name
    FROM   quoted_product
    WHERE  deleted_at IS NULL
      AND  public.normalize_name(name) = public.normalize_name(${name})
    ORDER  BY created_at
    LIMIT  1
  `;
  return rows[0];
};
