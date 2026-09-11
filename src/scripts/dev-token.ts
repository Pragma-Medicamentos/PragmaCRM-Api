/* eslint-disable no-console */
import 'dotenv/config';
import { createClerkClient } from '@clerk/express';

const HELP = `
Uso: npm run dev:token -- <email> [opciones]

  <email>              Email del usuario en Clerk (no en app_user)

Opciones:
  --expires <segundos> Vida del token. Por defecto 600. Clerk puede recortarlo
  --quiet              Imprime solo el token, para capturarlo en una variable
  --help               Esta ayuda
`;

interface Options {
  email: string;
  expiresInSeconds: number;
  quiet: boolean;
}

const parseArgs = (argv: string[]): Options => {
  if (argv.includes('--help') || argv.length === 0) {
    console.log(HELP);
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const quiet = argv.includes('--quiet');

  const expiresFlag = argv.indexOf('--expires');
  const expiresRaw = expiresFlag === -1 ? '600' : argv[expiresFlag + 1];
  const expiresInSeconds = Number(expiresRaw);
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    fail(`--expires debe ser un entero positivo de segundos, no "${expiresRaw}"`);
  }

  const email = argv.find(
    (arg, i) =>
      !arg.startsWith('--') && !(expiresFlag !== -1 && i === expiresFlag + 1)
  );
  if (!email) fail('Falta el email del usuario. Usa --help para ver el uso.');

  return { email, expiresInSeconds, quiet };
};

// `function` y no arrow: TS solo estrecha tipos tras un `never` si la firma esta en la declaracion.
function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const decodePayload = (jwt: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

const main = async () => {
  const { email, expiresInSeconds, quiet } = parseArgs(process.argv.slice(2));

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    fail('Falta CLERK_SECRET_KEY en el .env. Cópiala del dashboard de Clerk.');
  }

  if (secretKey.startsWith('sk_live_')) {
    fail('CLERK_SECRET_KEY es de producción (sk_live_). Este script es solo para desarrollo.');
  }
  if (process.env.STAGE === 'prod') {
    fail('STAGE=prod. Este script es solo para desarrollo.');
  }

  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    fail('Falta CLERK_PUBLISHABLE_KEY en el .env.');
  }

  const clerk = createClerkClient({ secretKey });

  const { data: users } = await clerk.users.getUserList({
    emailAddress: [email],
  });

  if (users.length === 0) {
    fail(
      `No hay ningún usuario con el email "${email}" en esta instancia de Clerk.\n` +
        '  Créalo en el dashboard de Clerk (Users → Create user).'
    );
  }
  if (users.length > 1) {
    fail(
      `Hay ${users.length} usuarios con ese email. Afina la búsqueda o usa el dashboard.`
    );
  }

  const user = users[0];

  // createSession del Backend API deja la sesion en 'pending' y Clerk trata las
  // pendientes como no autenticadas. Hay que pasar por el sign-in real: ticket
  // de un solo uso canjeado contra la Frontend API, igual que haria la app.
  const { token: ticket } = await clerk.signInTokens.createSignInToken({
    userId: user.id,
    expiresInSeconds: 600,
  });

  const frontendApi = Buffer.from(publishableKey.split('_')[2], 'base64')
    .toString()
    .replace(/\$$/, '');

  const signIn = await fetch(`https://${frontendApi}/v1/client/sign_ins?_is_native=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ strategy: 'ticket', ticket }),
  });
  if (!signIn.ok) {
    fail(`La Frontend API respondió ${signIn.status} al canjear el ticket.`);
  }

  const session = (await signIn.json())?.client?.sessions?.[0];
  if (!session?.id) fail('El sign-in no devolvió una sesión.');

  if (session.status === 'pending') {
    const tasks = (session.tasks ?? [])
      .map((t: { key: string }) => t.key)
      .join(', ');
    fail(
      `La sesión quedó en estado "pending" por tareas sin resolver: ${tasks || 'desconocidas'}.\n` +
        '  Clerk trata las sesiones pendientes como NO autenticadas, así que la API\n' +
        '  responderá 401 con este token — y lo mismo le pasará a web y móvil.\n' +
        '  Desactiva esa exigencia en el dashboard (Configure → Organizations).'
    );
  }

  const { jwt } = await clerk.sessions.getToken(
    session.id,
    undefined,
    expiresInSeconds
  );

  if (quiet) {
    console.log(jwt);
    return;
  }

  // Se informa el exp real y no expiresInSeconds porque Clerk puede recortarlo.
  const payload = decodePayload(jwt);
  const exp = Number(payload.exp);
  const seconds = exp - Math.floor(Date.now() / 1000);
  const port = process.env.PORT ?? '3000';

  console.log(`
Usuario de Clerk
  email            ${email}
  clerk_user_id    ${user.id}          ← el claim 'sub' del token
  sesión creada    ${session.id}

Token
  vigencia real    ${seconds} s  (exp ${new Date(exp * 1000).toISOString()})

${jwt}

1) Enlaza el usuario en tu base local (una sola vez):

   UPDATE public.app_user SET clerk_user_id = '${user.id}'
    WHERE email = '${email}';

2) Prueba el endpoint de sesión:

   curl http://localhost:${port}/api/v1/me \\
     -H "Authorization: Bearer ${jwt}"

   Sin el UPDATE de arriba la respuesta es 403 (token válido, usuario no
   enlazado). Con el UPDATE, 200 con tu usuario y tu rol.
`);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(`Clerk respondió con un error:\n  ${message}`);
});
