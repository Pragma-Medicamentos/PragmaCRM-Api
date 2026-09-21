// download-and-upload.js
const { chromium } = require('playwright');
const axios = require('axios');
const AdmZip = require('adm-zip');

require('dotenv').config();

const LOGIN_URL = 'https://distdemedicamentos.efactsoft.com/login'; // ajustá si es otra ruta
const SALES_URL = 'https://distdemedicamentos.efactsoft.com/iv/sales';

// PragmaCRM-Api: POST /api/v1/uploads/sales (RF-03), admin-only.
const PRAGMA_API_URL = process.env.PRAGMA_API_URL || 'http://localhost:3000';
const PRAGMA_UPLOAD_ENDPOINT = `${PRAGMA_API_URL}/api/v1/uploads/sales`;

// Token de Supabase Auth para un usuario con role = 'Administrador'.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function descargarJSON() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    // 1. Login
    await page.goto(LOGIN_URL);
    await page.fill('#usuario', process.env.CRM_USER);
    await page.fill('#password', process.env.CRM_PASSWORD);
    await page.click('button.auth-form-btn');
    await page.waitForLoadState('networkidle');

    // 2. Ir a la sección de ventas
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    // 3. Abrir filtros
    await page.click('a.btn-filtrar');

    // 4. Fecha
    const rango = '01/09/2026 - 18/09/2026';
    await page.fill('#datefilter', rango);
    await page.keyboard.press('Enter');

    // 5. Buscar
    await page.click('button:has-text("Buscar")');
    await page.waitForLoadState('networkidle');

    // 6. Esperar data-url
    await page.waitForFunction(() => {
      const btn = document.querySelector('#export-json2');
      return btn && btn.dataset.url && btn.dataset.url.length > 0;
    }, { timeout: 15000 });

    // 7. Descargar el ZIP
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-json2'),
    ]);

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const zipBuffer = Buffer.concat(chunks); // NO convertir a texto todavía, es binario

    // 8. Descomprimir en memoria y extraer el JSON
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    console.log('Archivos dentro del ZIP:', entries.map(e => e.entryName));

    const jsonEntry = entries.find(e => e.entryName.endsWith('.json'));
    if (!jsonEntry) {
      throw new Error('No se encontró ningún archivo .json dentro del ZIP');
    }

    // Se devuelve el buffer crudo del ZIP (lo que espera el endpoint) junto
    // con el JSON ya parseado, solo para poder validar su forma antes de subir.
    const jsonBuffer = jsonEntry.getData();
    const data = JSON.parse(jsonBuffer.toString('utf-8'));

    return { jsonBuffer, data };
  } finally {
    await browser.close();
  }
}

/** Pide un access token de Supabase Auth para un usuario Administrador. */
async function obtenerToken() {
  const resp = await axios.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    { email: process.env.PRAGMA_ADMIN_EMAIL, password: process.env.PRAGMA_ADMIN_PASSWORD },
    { headers: { apikey: SUPABASE_ANON_KEY }, timeout: 15000 }
  );
  return resp.data.access_token;
}

async function subirAPragma(jsonBuffer, token) {
  // El endpoint espera multipart/form-data, campo "file", extensión .json
  // (src/presentation/middleware/uploadJsonFile.ts). No enviar el JSON
  // como body plano: el body parser de la API no lo acepta en esta ruta.
  const form = new FormData();
  form.append('file', new Blob([jsonBuffer], { type: 'application/json' }), 'ventas.json');

  const resp = await axios.post(PRAGMA_UPLOAD_ENDPOINT, form, {
    headers: {
      'x-api-key': process.env.API_KEY,
      Authorization: `Bearer ${token}`,
    },
    timeout: 60000,
  });
  console.log('Subida exitosa:', resp.status, resp.data.message);
  return resp.data;
}

(async () => {
  try {
    const { jsonBuffer, data } = await descargarJSON();

    // El endpoint exige un array no vacío en la raíz (ver
    // src/services/salesStaging.service.ts, parseFile).
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(
        'El export de Efactsoft no tiene la forma esperada (array de ventas en la raíz)'
      );
    }
    console.log(`JSON descargado. ${data.length} ventas.`);

    const token = await obtenerToken();
    await subirAPragma(jsonBuffer, token);
  } catch (err) {
    console.error('Error en el flujo:', err.message);
    process.exit(1);
  }
})();