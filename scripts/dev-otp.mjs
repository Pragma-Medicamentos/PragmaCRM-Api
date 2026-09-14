#!/usr/bin/env node
/**
 * Imprime un codigo OTP valido sin enviar ningun correo.
 *
 * Existe porque el SMTP integrado de Supabase solo envia a direcciones de
 * miembros de la organizacion y admite 2 correos por hora; cualquier otro
 * destinatario responde 500 "Error sending magic link email". `generate_link`
 * produce el mismo codigo que habria viajado en ese correo, sin mandarlo.
 *
 * Uso:  node scripts/dev-otp.mjs vendedor@empresa.com
 *
 * Solo para desarrollo: usa la service role key, que jamas debe salir del
 * backend ni acercarse a la app movil.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const email = process.argv[2];
if (!email) {
  console.error('Uso: node scripts/dev-otp.mjs <correo>');
  process.exit(1);
}

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');

const readEnv = (key) => {
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`Falta ${key} en .env`);
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
};

const url = readEnv('SUPABASE_URL').replace(/\/+$/, '');
const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');

const response = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ type: 'magiclink', email }),
});

const body = await response.json().catch(() => null);

if (!response.ok) {
  console.error(`\n  Supabase respondio ${response.status}:`, body?.msg ?? body);
  if (response.status === 422) {
    console.error('  422 suele significar que ese correo no tiene cuenta en auth.users.');
  }
  process.exit(1);
}

const otp = body?.properties?.email_otp ?? body?.email_otp;

console.log(`\n  Codigo para ${email}:  ${otp}\n`);
console.log('  Valido 1 hora, un solo uso. No se envio ningun correo.\n');
