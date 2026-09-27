import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { ROLES } from '../domain/types/auth.types';
import {
  CreateSellerInput,
  UpdateSellerInput,
} from '../domain/schemas/seller.schema';

export interface SellerRecord {
  id: string;
  name: string;
  email: string | null;
  erp_user_id: number | null;
  active: boolean;
  auth_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELLER_SELECT = {
  id: true,
  name: true,
  email: true,
  erp_user_id: true,
  active: true,
  auth_user_id: true,
  created_at: true,
  updated_at: true,
} as const;

export const listSellers = (
  client: Client,
  filters: { active?: boolean }
): Promise<SellerRecord[]> =>
  client.app_user.findMany({
    where: {
      role: ROLES.SELLER,
      deleted_at: null,
      ...(filters.active !== undefined ? { active: filters.active } : {}),
    },
    select: SELLER_SELECT,
    orderBy: { name: 'asc' },
  });

export const getSellerById = async (
  client: Client,
  id: string
): Promise<SellerRecord> => {
  const seller = await client.app_user.findFirst({
    where: { id, role: ROLES.SELLER, deleted_at: null },
    select: SELLER_SELECT,
  });

  if (!seller) throw CustomError.notFound('Vendedor no encontrado');

  return seller;
};

// Only guards against two active seller profiles sharing an email inside the
// CRM: email has no UNIQUE constraint in the database (7.2).
const assertEmailNotInUse = async (
  client: Client,
  email: string,
  excludeId?: string
): Promise<void> => {
  const existing = await client.app_user.findFirst({
    where: {
      email,
      deleted_at: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw CustomError.conflict('Ya existe un usuario con este correo');
  }
};

// Explicit check instead of waiting for the partial unique index (P2002): it
// gives the admin a message that names the field.
const assertErpUserIdNotInUse = async (
  client: Client,
  erpUserId: number,
  excludeId?: string
): Promise<void> => {
  const existing = await client.app_user.findFirst({
    where: {
      erp_user_id: erpUserId,
      deleted_at: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw CustomError.conflict('Ya existe un vendedor con este ID de Efactsoft');
  }
};

export const createSellerProfile = async (
  client: Client,
  data: CreateSellerInput,
  authUserId: string
): Promise<SellerRecord> => {
  await assertEmailNotInUse(client, data.email);
  if (data.erp_user_id !== undefined) {
    await assertErpUserIdNotInUse(client, data.erp_user_id);
  }

  return client.app_user.create({
    data: {
      name: data.name,
      email: data.email,
      erp_user_id: data.erp_user_id,
      role: ROLES.SELLER,
      active: true,
      auth_user_id: authUserId,
    },
    select: SELLER_SELECT,
  });
};

export const deleteSellerProfile = (client: Client, id: string): Promise<void> =>
  client.app_user.delete({ where: { id } }).then(() => undefined);

export const updateSeller = async (
  client: Client,
  id: string,
  data: UpdateSellerInput
): Promise<SellerRecord> => {
  await getSellerById(client, id);

  if (data.email !== undefined) {
    await assertEmailNotInUse(client, data.email, id);
  }
  if (data.erp_user_id !== undefined && data.erp_user_id !== null) {
    await assertErpUserIdNotInUse(client, data.erp_user_id, id);
  }

  return client.app_user.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.erp_user_id !== undefined ? { erp_user_id: data.erp_user_id } : {}),
      updated_at: new Date(),
    },
    select: SELLER_SELECT,
  });
};

export const setSellerStatus = async (
  client: Client,
  id: string,
  active: boolean
): Promise<SellerRecord> => {
  await getSellerById(client, id);

  return client.app_user.update({
    where: { id },
    data: { active, updated_at: new Date() },
    select: SELLER_SELECT,
  });
};
