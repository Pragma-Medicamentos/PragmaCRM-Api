import { config } from 'dotenv';
import { resolve } from 'path';

// Los tests de integracion golpean servicios reales (base de datos), asi que
// leen .env.test y no el .env de desarrollo — evita que una corrida de tests
// escriba por accidente sobre datos locales de trabajo.
config({ path: resolve(process.cwd(), '.env.test'), override: true });
