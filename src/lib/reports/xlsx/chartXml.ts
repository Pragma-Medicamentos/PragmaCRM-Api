import { ReportChart } from '../../../domain/types/report.types';
import { REPORT_COLORS, XLSX_VALUE_FORMATS } from '../theme';

/*
 * DrawingML for native Excel charts. exceljs writes cells, styles and images
 * but not charts, so injectCharts.ts adds these parts to the package it
 * produces. Element order inside each node follows the OOXML schema
 * (ECMA-376 part 1, dml-chart.xsd): Excel refuses to open a file whose chart
 * children are out of order, so do not reorder them.
 *
 * Every series is bound to a cell range (`<c:f>`) and also carries a cache of
 * its values, so the chart renders before any recalculation and in viewers
 * that never recalculate.
 */

/** Where the plotted data lives in the workbook. */
export interface ChartBinding {
  sheetName: string;
  /** 1-based row of the first data row. */
  firstRow: number;
  /** 1-based row of the last plotted row. */
  lastRow: number;
  /** 1-based column of the category labels. */
  categoryColumn: number;
  /** 1-based column of each series, same order as chart.series. */
  seriesColumns: number[];
  categories: string[];
  /** One array per series; null leaves a gap. */
  values: (number | null)[][];
}

const CAT_AX_ID = 50010;
const VAL_AX_ID = 50020;

export const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const hex = (color: string) => color.replace('#', '').toUpperCase();

export const columnLetter = (column: number): string => {
  let letters = '';
  let n = column;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
};

/** `'Ventas por vendedor'!$B$2:$B$9`, quotes doubled as Excel requires. */
const rangeRef = (sheetName: string, column: number, firstRow: number, lastRow: number) => {
  const letter = columnLetter(column);
  return `'${sheetName.replace(/'/g, "''")}'!$${letter}$${firstRow}:$${letter}$${lastRow}`;
};

const solidFill = (color: string) =>
  `<a:solidFill><a:srgbClr val="${hex(color)}"/></a:solidFill>`;

/** Text properties: size in hundredths of a point. */
const textProps = (size: number, color: string = REPORT_COLORS.inkSecondary, bold = false) =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}">${solidFill(color)}<a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="es-SV"/></a:p></c:txPr>`;

const title = (text: string) =>
  `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="es-SV" sz="1200" b="1">${solidFill(REPORT_COLORS.inkPrimary)}<a:latin typeface="Calibri"/></a:rPr><a:t>${escapeXml(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;

const categoryRef = (binding: ChartBinding) => {
  const points = binding.categories
    .map((label, idx) => `<c:pt idx="${idx}"><c:v>${escapeXml(label)}</c:v></c:pt>`)
    .join('');
  return `<c:cat><c:strRef><c:f>${escapeXml(
    rangeRef(binding.sheetName, binding.categoryColumn, binding.firstRow, binding.lastRow)
  )}</c:f><c:strCache><c:ptCount val="${binding.categories.length}"/>${points}</c:strCache></c:strRef></c:cat>`;
};

const valueRef = (binding: ChartBinding, seriesIndex: number) => {
  const values = binding.values[seriesIndex];
  const points = values
    .map((value, idx) => (value === null ? '' : `<c:pt idx="${idx}"><c:v>${value}</c:v></c:pt>`))
    .join('');
  return `<c:val><c:numRef><c:f>${escapeXml(
    rangeRef(
      binding.sheetName,
      binding.seriesColumns[seriesIndex],
      binding.firstRow,
      binding.lastRow
    )
  )}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${points}</c:numCache></c:numRef></c:val>`;
};

const seriesName = (name: string) => `<c:tx><c:v>${escapeXml(name)}</c:v></c:tx>`;

/**
 * Value labels on the marks. Only for a single unstacked series with few
 * categories: a number on every mark of a busy chart is noise.
 */
const valueLabels = (chart: ReportChart, categoryCount: number, position: string) => {
  if (chart.series.length > 1 || chart.stacked || categoryCount > 12) return '';
  return `<c:dLbls><c:numFmt formatCode="${escapeXml(
    XLSX_VALUE_FORMATS[chart.valueFormat]
  )}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${textProps(
    900
  )}<c:dLblPos val="${position}"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`;
};

const axes = (chart: ReportChart, horizontal: boolean) => {
  const valueFormat = escapeXml(XLSX_VALUE_FORMATS[chart.valueFormat]);
  // Horizontal bars list the first row at the top: the category axis runs
  // max-to-min and the value axis crosses at the max category, i.e. at the
  // bottom of the plot.
  const catOrientation = horizontal ? 'maxMin' : 'minMax';
  const valCrosses = horizontal ? 'max' : 'autoZero';

  return (
    `<c:catAx><c:axId val="${CAT_AX_ID}"/><c:scaling><c:orientation val="${catOrientation}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525">${solidFill(REPORT_COLORS.axis)}</a:ln></c:spPr>${textProps(900)}<c:crossAx val="${VAL_AX_ID}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="${VAL_AX_ID}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'b' : 'l'}"/><c:majorGridlines><c:spPr><a:ln w="6350">${solidFill(REPORT_COLORS.grid)}</a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${valueFormat}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${textProps(900, REPORT_COLORS.inkMuted)}<c:crossAx val="${CAT_AX_ID}"/><c:crosses val="${valCrosses}"/><c:crossBetween val="between"/></c:valAx>`
  );
};

const barChart = (chart: ReportChart, binding: ChartBinding) => {
  const horizontal = chart.kind === 'bar';
  const series = chart.series
    .map(
      (serie, i) =>
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${seriesName(serie.name)}<c:spPr>${solidFill(
          serie.color
        )}<a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative val="0"/>${valueLabels(
          chart,
          binding.categories.length,
          'outEnd'
        )}${categoryRef(binding)}${valueRef(binding, i)}</c:ser>`
    )
    .join('');

  const grouping = chart.stacked ? 'stacked' : 'clustered';
  // Stacked segments share the slot; clustered bars sit side by side with a
  // hairline gap.
  const overlap = chart.stacked ? 100 : -8;

  return `<c:barChart><c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${series}<c:gapWidth val="70"/><c:overlap val="${overlap}"/><c:axId val="${CAT_AX_ID}"/><c:axId val="${VAL_AX_ID}"/></c:barChart>${axes(
    chart,
    horizontal
  )}`;
};

const lineChart = (chart: ReportChart, binding: ChartBinding) => {
  const series = chart.series
    .map(
      (serie, i) =>
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${seriesName(serie.name)}<c:spPr><a:ln w="22225" cap="rnd">${solidFill(
          serie.color
        )}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr>${solidFill(
          serie.color
        )}<a:ln w="9525">${solidFill(REPORT_COLORS.surface)}</a:ln></c:spPr></c:marker>${categoryRef(
          binding
        )}${valueRef(binding, i)}<c:smooth val="0"/></c:ser>`
    )
    .join('');

  return `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="${CAT_AX_ID}"/><c:axId val="${VAL_AX_ID}"/></c:lineChart>${axes(
    chart,
    false
  )}`;
};

const doughnutChart = (chart: ReportChart, binding: ChartBinding) => {
  const colors = chart.categoryColors ?? [...REPORT_COLORS.series];
  // A white outline is the surface gap between adjacent slices.
  const points = binding.categories
    .map(
      (_, idx) =>
        `<c:dPt><c:idx val="${idx}"/><c:bubble3D val="0"/><c:spPr>${solidFill(
          colors[idx % colors.length]
        )}<a:ln w="19050">${solidFill(REPORT_COLORS.surface)}</a:ln></c:spPr></c:dPt>`
    )
    .join('');
  const labels = `<c:dLbls><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${textProps(
    1000,
    REPORT_COLORS.inkPrimary,
    true
  )}<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="1"/></c:dLbls>`;
  const serie = chart.series[0];

  return `<c:doughnutChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${seriesName(
    serie.name
  )}${points}${labels}${categoryRef(binding)}${valueRef(
    binding,
    0
  )}</c:ser><c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
};

/** The `xl/charts/chartN.xml` part for one chart. */
export const buildChartXml = (chart: ReportChart, binding: ChartBinding): string => {
  const plot =
    chart.kind === 'line'
      ? lineChart(chart, binding)
      : chart.kind === 'doughnut'
        ? doughnutChart(chart, binding)
        : barChart(chart, binding);

  // A legend is needed only when color has to tell series (or slices) apart;
  // a single series is named by the title.
  const legend =
    chart.series.length > 1 || chart.kind === 'doughnut'
      ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${textProps(900)}</c:legend>`
      : '';

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<c:roundedCorners val="0"/>' +
    `<c:chart>${title(chart.title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr>${solidFill(REPORT_COLORS.surface)}<a:ln w="9525">${solidFill(REPORT_COLORS.grid)}</a:ln></c:spPr>` +
    '</c:chartSpace>'
  );
};

/** Cell-anchored position of a chart on the sheet, 0-based. */
export interface ChartAnchor {
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
}

/** The `xl/drawings/drawingN.xml` part holding every chart of a sheet. */
export const buildDrawingXml = (anchors: ChartAnchor[], charts: ReportChart[]): string => {
  const frames = anchors
    .map(
      (anchor, i) =>
        `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${anchor.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${anchor.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="${escapeXml(
          charts[i].title
        )}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${
          i + 1
        }"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
    )
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${frames}</xdr:wsDr>`
  );
};
