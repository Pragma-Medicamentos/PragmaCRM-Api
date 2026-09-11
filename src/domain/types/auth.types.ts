export const ROLES = {
  ADMIN: 'Administrador',
  SELLER: 'Vendedor',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

const ROLE_VALUES: readonly string[] = Object.values(ROLES);

export const isRole = (value: string): value is Role =>
  ROLE_VALUES.includes(value);

export interface AuthenticatedUser {
  id: string;
  clerkUserId: string;
  role: Role;
  name: string;
  email: string | null;
}
