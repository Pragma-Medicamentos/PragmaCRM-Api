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
  active: boolean;
  clerk_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELLER_SELECT = {
  id: true,
  name: true,
  email: true,
  active: true,
  clerk_user_id: true,
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

// No valida contra Clerk: solo evita dos perfiles de vendedor activos con el
// mismo correo dentro del CRM. email no tiene UNIQUE en la base (7.2).
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

export const createSellerProfile = async (
  client: Client,
  data: CreateSellerInput
): Promise<SellerRecord> => {
  await assertEmailNotInUse(client, data.email);

  return client.app_user.create({
    data: {
      name: data.name,
      email: data.email,
      role: ROLES.SELLER,
      active: true,
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

  return client.app_user.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
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
