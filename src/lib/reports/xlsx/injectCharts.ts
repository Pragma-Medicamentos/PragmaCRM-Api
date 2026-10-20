import JSZip from 'jszip';
import { ReportChart } from '../../../domain/types/report.types';
import {
  ChartAnchor,
  ChartBinding,
  buildChartXml,
  buildDrawingXml,
  escapeXml,
} from './chartXml';

/*
 * Adds native charts to a workbook written by exceljs, which has no chart
 * support. Takes the finished .xlsx, opens it as the zip it is, and adds per
 * chart sheet:
 *
 *   xl/charts/chartN.xml                       one per chart
 *   xl/drawings/drawingN.xml (+ its .rels)     the anchors, pointing at the charts
 *   xl/worksheets/_rels/sheetN.xml.rels        sheet -> drawing
 *   <drawing r:id> inside the sheet            so Excel renders the drawing
 *   [Content_Types].xml overrides              for every new part
 *
 * The chart sheet must not carry images: exceljs would give it a drawing of
 * its own and the sheet can hold only one.
 */

export interface ChartSheetPlan {
  sheetName: string;
  charts: ReportChart[];
  bindings: ChartBinding[];
  anchors: ChartAnchor[];
}

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAWING_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const CHART_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
const DRAWING_CT = 'application/vnd.openxmlformats-officedocument.drawing+xml';
const CHART_CT = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';

const readText = async (zip: JSZip, path: string): Promise<string> => {
  const file = zip.file(path);
  if (!file) throw new Error(`Workbook part not found: ${path}`);
  return file.async('string');
};

/** `xl/worksheets/sheetN.xml` of the sheet with this name. */
const findSheetPath = async (zip: JSZip, sheetName: string): Promise<string> => {
  const workbook = await readText(zip, 'xl/workbook.xml');
  const rels = await readText(zip, 'xl/_rels/workbook.xml.rels');

  const sheet = [...workbook.matchAll(/<sheet\b[^>]*>/g)]
    .map((match) => match[0])
    .find((tag) => tag.includes(`name="${escapeXml(sheetName)}"`));
  const relId = sheet?.match(/r:id="([^"]+)"/)?.[1];
  const target = rels.match(new RegExp(`<Relationship[^>]*Id="${relId}"[^>]*Target="([^"]+)"`))?.[1];

  if (!relId || !target) throw new Error(`Sheet not found in workbook: ${sheetName}`);
  return `xl/${target.replace(/^\/?xl\//, '')}`;
};

/** First free N for `${prefix}N.xml` inside `folder`. */
const nextIndex = (zip: JSZip, folder: string, prefix: string): number => {
  const pattern = new RegExp(`^${folder}/${prefix}(\\d+)\\.xml$`);
  const used = Object.keys(zip.files)
    .map((path) => Number(path.match(pattern)?.[1] ?? 0))
    .filter((n) => n > 0);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
};

/**
 * `<drawing>` must precede these siblings in CT_Worksheet; exceljs emits
 * none of them on a sheet without tables or comments, but the check keeps
 * the order right if that ever changes.
 */
const insertDrawingTag = (sheetXml: string, relId: string): string => {
  const tag = `<drawing r:id="${relId}"/>`;
  const before = sheetXml.search(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/);
  if (before !== -1) return sheetXml.slice(0, before) + tag + sheetXml.slice(before);
  return sheetXml.replace('</worksheet>', `${tag}</worksheet>`);
};

const addOverrides = (contentTypes: string, overrides: { part: string; type: string }[]) =>
  contentTypes.replace(
    '</Types>',
    overrides
      .map(({ part, type }) => `<Override PartName="/${part}" ContentType="${type}"/>`)
      .join('') + '</Types>'
  );

export const injectCharts = async (xlsx: Buffer, plans: ChartSheetPlan[]): Promise<Buffer> => {
  const withCharts = plans.filter((plan) => plan.charts.length > 0);
  if (withCharts.length === 0) return xlsx;

  const zip = await JSZip.loadAsync(new Uint8Array(xlsx));
  let contentTypes = await readText(zip, '[Content_Types].xml');

  for (const plan of withCharts) {
    const sheetPath = await findSheetPath(zip, plan.sheetName);
    const sheetFile = sheetPath.split('/').pop() as string;
    const sheetRelsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
    const drawingIndex = nextIndex(zip, 'xl/drawings', 'drawing');
    const drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
    const overrides = [{ part: drawingPath, type: DRAWING_CT }];

    const chartRels: string[] = [];
    let chartIndex = nextIndex(zip, 'xl/charts', 'chart');
    plan.charts.forEach((chart, i) => {
      const chartPath = `xl/charts/chart${chartIndex}.xml`;
      zip.file(chartPath, buildChartXml(chart, plan.bindings[i]));
      overrides.push({ part: chartPath, type: CHART_CT });
      chartRels.push(
        `<Relationship Id="rId${i + 1}" Type="${CHART_REL}" Target="../charts/chart${chartIndex}.xml"/>`
      );
      chartIndex += 1;
    });

    zip.file(drawingPath, buildDrawingXml(plan.anchors, plan.charts));
    zip.file(
      `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}">${chartRels.join('')}</Relationships>`
    );

    // The sheet may already have relationships (hyperlinks); append to them.
    const drawingRelId = 'rIdPcrmDrawing';
    const drawingRel = `<Relationship Id="${drawingRelId}" Type="${DRAWING_REL}" Target="../drawings/drawing${drawingIndex}.xml"/>`;
    const existingRels = zip.file(sheetRelsPath);
    zip.file(
      sheetRelsPath,
      existingRels
        ? (await existingRels.async('string')).replace('</Relationships>', `${drawingRel}</Relationships>`)
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}">${drawingRel}</Relationships>`
    );

    zip.file(sheetPath, insertDrawingTag(await readText(zip, sheetPath), drawingRelId));
    contentTypes = addOverrides(contentTypes, overrides);
  }

  zip.file('[Content_Types].xml', contentTypes);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
