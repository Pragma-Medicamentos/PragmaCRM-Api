import { config } from 'dotenv';
import { resolve } from 'path';

// Integration tests hit real services (the database), so they read .env.test
// rather than the development .env — this keeps a test run from accidentally
// writing over local working data.
config({ path: resolve(process.cwd(), '.env.test'), override: true });
