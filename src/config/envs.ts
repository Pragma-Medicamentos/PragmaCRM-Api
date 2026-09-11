import 'dotenv/config';
import { get } from 'env-var';

export const envs = {
  // Entorno a nivel de aplicacion. Distinto de NODE_ENV: este describe el
  // despliegue (dev/staging/prod), NODE_ENV describe el modo de ejecucion de
  // Node y solo debe valer development o production.
  STAGE: get('STAGE').required().asEnum(['dev', 'staging', 'prod'] as const),
  PORT: get('PORT').required().asPortNumber(),

  // Cadena de conexion a PostgreSQL. La consume el adapter de Prisma
  // (src/lib/prisma.ts) y tambien prisma.config.ts para las migraciones.
  DATABASE_URL: get('DATABASE_URL').required().asString(),

  LOG_LEVEL: get('LOG_LEVEL').default('info').asString(),

  // Tamano maximo del JSON del ERP en la carga manual (RF-03).
  //
  // Medido sobre el export real: 5,13 MiB para 346 ventas en 29 dias, es decir
  // 15,5 KB por venta y ~11,9 ventas al dia con los dos vendedores actuales.
  // De ahi, 100 MiB cubren ~6.700 ventas: unos 18 meses al ritmo de hoy, o
  // ~7 meses si el equipo crece a los 5 vendedores que preve CLAUDE.md 7.9.
  // El requisito acordado era aguantar 5 meses de historial.
  //
  // El valor coincide con el limite de importacion de Salesforce (100 MB por
  // archivo), que es la referencia de mercado para cargas masivas de CRM.
  //
  // Es un techo, no una reserva: una carga normal de 5 MB consume ~17 MB de
  // memoria. El pico llega a ~330 MB solo si de verdad se sube un archivo de
  // 100 MB, algo que en la practica pasa una vez, en el backfill inicial.
  //
  // OJO AL DESPLEGAR: nginx corta en 1 MB por defecto y responde 413 antes de
  // que la peticion llegue aqui. Hay que subir `client_max_body_size` al mismo
  // valor en el VPS, o el usuario vera el error HTML de nginx en lugar del
  // ApiResponse en espanol.
  UPLOAD_MAX_FILE_SIZE_MB: get('UPLOAD_MAX_FILE_SIZE_MB').default('100').asIntPositive(),
};
