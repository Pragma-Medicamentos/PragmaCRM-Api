import { ReportChart } from '../../../domain/types/report.types';
import { ResolvedChartData } from '../chartData';
import { REPORT_COLORS, formatAxisValue, formatValueLabel } from '../theme';

/*
 * Vector drawing of a report chart for the PDF. pdfmake embeds SVG as vector
 * paths, so the chart stays sharp when printed or zoomed. Same kinds, colors
 * and rows as the native Excel chart (chartData.ts decides the rows).
 *
 * The chart title is not drawn here: the PDF renderer sets it as text above,
 * where it shares the document's typography.
 */

const FONT = 'Helvetica';
const AXIS_FONT_SIZE = 8;
const LABEL_FONT_SIZE = 7.5;
/** Average glyph width of Helvetica relative to its size, for truncation. */
const CHAR_WIDTH = 0.52;
const CORNER = 4;

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const truncate = (text: string, maxWidth: number, fontSize: number) => {
  const maxChars = Math.max(3, Math.floor(maxWidth / (fontSize * CHAR_WIDTH)));
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
};

const text = (
  x: number,
  y: number,
  content: string,
  options: { size?: number; anchor?: 'start' | 'middle' | 'end'; color?: string; bold?: boolean } = {}
) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FONT}" font-size="${
    options.size ?? AXIS_FONT_SIZE
  }" text-anchor="${options.anchor ?? 'start'}" fill="${options.color ?? REPORT_COLORS.inkSecondary}"${
    options.bold ? ' font-weight="bold"' : ''
  }>${esc(content)}</text>`;

/** Round tick step: 1, 2 or 5 times a power of ten. */
const niceScale = (min: number, max: number, ticks = 5) => {
  const low = Math.min(0, min);
  const high = max <= low ? low + 1 : max;
  const rough = (high - low) / ticks;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? rough;
  const start = Math.floor(low / step) * step;
  const end = Math.ceil(high / step) * step;
  const values: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) values.push(Number(v.toFixed(10)));
  return { min: start, max: end, values };
};

/**
 * A bar whose data end is rounded and whose baseline end stays square, so the
 * bar reads as anchored to the axis.
 */
const barPath = (
  x: number,
  y: number,
  width: number,
  height: number,
  dataEnd: 'top' | 'right' | 'none'
) => {
  if (width <= 0 || height <= 0) return '';
  const r = Math.min(CORNER, width / 2, height / 2);
  if (dataEnd === 'top') {
    return `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
  }
  if (dataEnd === 'right') {
    return `M${x},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height - r} Q${x + width},${y + height} ${x + width - r},${y + height} L${x},${y + height} Z`;
  }
  return `M${x},${y} h${width} v${height} h${-width} Z`;
};

const legend = (chart: ReportChart) => {
  if (chart.series.length < 2) return { svg: '', height: 0 };
  let x = 0;
  const items = chart.series.map((serie) => {
    const item =
      `<rect x="${x}" y="2" width="9" height="9" rx="2" fill="${serie.color}"/>` +
      text(x + 13, 10, serie.name, { color: REPORT_COLORS.inkSecondary });
    x += 13 + serie.name.length * AXIS_FONT_SIZE * CHAR_WIDTH + 16;
    return item;
  });
  return { svg: items.join(''), height: 20 };
};

interface Frame {
  width: number;
  height: number;
}

const columnChart = (chart: ReportChart, data: ResolvedChartData, frame: Frame) => {
  const { svg: legendSvg, height: legendHeight } = legend(chart);
  const totals = data.categories.map((_, i) =>
    chart.stacked
      ? data.values.reduce((sum, serie) => sum + Math.max(0, serie[i] ?? 0), 0)
      : Math.max(...data.values.map((serie) => serie[i] ?? 0))
  );
  const scale = niceScale(
    Math.min(0, ...data.values.flat().map((v) => v ?? 0)),
    Math.max(...totals)
  );

  const left = 46;
  const top = legendHeight + 14;
  const bottom = 30;
  const plotWidth = frame.width - left - 6;
  const plotHeight = frame.height - top - bottom;
  const y = (value: number) => top + plotHeight - ((value - scale.min) / (scale.max - scale.min)) * plotHeight;

  const parts: string[] = [legendSvg];
  for (const tick of scale.values) {
    parts.push(
      `<line x1="${left}" x2="${left + plotWidth}" y1="${y(tick)}" y2="${y(tick)}" stroke="${REPORT_COLORS.grid}" stroke-width="0.5"/>`,
      text(left - 6, y(tick) + 3, formatAxisValue(tick, chart.valueFormat), {
        anchor: 'end',
        color: REPORT_COLORS.inkMuted,
      })
    );
  }

  const slot = plotWidth / data.categories.length;
  const groupWidth = slot * 0.68;
  const barCount = chart.stacked ? 1 : chart.series.length;
  const gap = barCount > 1 ? 1.5 : 0;
  const barWidth = (groupWidth - gap * (barCount - 1)) / barCount;
  const showLabels = chart.series.length === 1 && data.categories.length <= 12;

  data.categories.forEach((category, i) => {
    const groupX = left + slot * i + (slot - groupWidth) / 2;
    let stackBase = 0;
    chart.series.forEach((serie, s) => {
      const value = data.values[s][i];
      if (value === null) return;
      if (chart.stacked) {
        const top0 = y(stackBase + value);
        const isTop = s === chart.series.length - 1 || data.values.slice(s + 1).every((v) => !v[i]);
        // A surface-colored hairline separates stacked segments.
        parts.push(
          `<path d="${barPath(groupX, top0, groupWidth, y(stackBase) - top0, isTop ? 'top' : 'none')}" fill="${serie.color}" stroke="${REPORT_COLORS.surface}" stroke-width="1"/>`
        );
        stackBase += value;
      } else {
        const x = groupX + s * (barWidth + gap);
        const top0 = y(Math.max(0, value));
        parts.push(
          `<path d="${barPath(x, top0, barWidth, Math.abs(y(0) - y(value)), value >= 0 ? 'top' : 'none')}" fill="${serie.color}"/>`
        );
        if (showLabels) {
          parts.push(
            text(x + barWidth / 2, top0 - 3, formatValueLabel(value, chart.valueFormat), {
              anchor: 'middle',
              size: LABEL_FONT_SIZE,
              color: REPORT_COLORS.inkPrimary,
            })
          );
        }
      }
    });

    // Thin out the category labels when they would collide.
    const every = Math.ceil((data.categories.length * 46) / plotWidth);
    if (i % every === 0) {
      parts.push(
        text(left + slot * i + slot / 2, top + plotHeight + 13, truncate(category, slot * every - 4, AXIS_FONT_SIZE), {
          anchor: 'middle',
        })
      );
    }
  });

  parts.push(
    `<line x1="${left}" x2="${left + plotWidth}" y1="${y(0)}" y2="${y(0)}" stroke="${REPORT_COLORS.axis}" stroke-width="1"/>`
  );
  return parts.join('');
};

const barChart = (chart: ReportChart, data: ResolvedChartData, frame: Frame) => {
  const { svg: legendSvg, height: legendHeight } = legend(chart);
  const totals = data.categories.map((_, i) =>
    chart.stacked
      ? data.values.reduce((sum, serie) => sum + Math.max(0, serie[i] ?? 0), 0)
      : Math.max(...data.values.map((serie) => serie[i] ?? 0))
  );
  const scale = niceScale(0, Math.max(...totals));

  const labelWidth = Math.min(170, frame.width * 0.32);
  const left = labelWidth + 8;
  const top = legendHeight + 4;
  const bottom = 18;
  const valueRoom = 62;
  const plotWidth = frame.width - left - valueRoom;
  const plotHeight = frame.height - top - bottom;
  const x = (value: number) => left + (value / scale.max) * plotWidth;

  const parts: string[] = [legendSvg];
  for (const tick of scale.values) {
    parts.push(
      `<line x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${top + plotHeight}" stroke="${REPORT_COLORS.grid}" stroke-width="0.5"/>`,
      text(x(tick), top + plotHeight + 12, formatAxisValue(tick, chart.valueFormat), {
        anchor: 'middle',
        color: REPORT_COLORS.inkMuted,
      })
    );
  }

  const slot = plotHeight / data.categories.length;
  const barCount = chart.stacked ? 1 : chart.series.length;
  const barHeight = Math.min(16, slot * 0.68) / barCount;
  data.categories.forEach((category, i) => {
    const centerY = top + slot * i + slot / 2;
    parts.push(
      text(labelWidth, centerY + 3, truncate(category, labelWidth, AXIS_FONT_SIZE), {
        anchor: 'end',
        color: REPORT_COLORS.inkPrimary,
      })
    );
    let stackBase = 0;
    chart.series.forEach((serie, s) => {
      const value = data.values[s][i];
      if (value === null) return;
      if (chart.stacked) {
        const isEnd = s === chart.series.length - 1 || data.values.slice(s + 1).every((v) => !v[i]);
        // A surface-colored hairline separates stacked segments.
        parts.push(
          `<path d="${barPath(x(stackBase), centerY - barHeight / 2, x(stackBase + value) - x(stackBase), barHeight - 1, isEnd ? 'right' : 'none')}" fill="${serie.color}" stroke="${REPORT_COLORS.surface}" stroke-width="1"/>`
        );
        stackBase += value;
        return;
      }
      const barY = centerY - (barHeight * chart.series.length) / 2 + s * barHeight;
      parts.push(
        `<path d="${barPath(left, barY, x(value) - left, barHeight - 1, 'right')}" fill="${serie.color}"/>`
      );
      if (chart.series.length === 1) {
        parts.push(
          text(x(value) + 4, barY + barHeight / 2 + 2.5, formatValueLabel(value, chart.valueFormat), {
            size: LABEL_FONT_SIZE,
            color: REPORT_COLORS.inkPrimary,
          })
        );
      }
    });
  });

  parts.push(
    `<line x1="${left}" x2="${left}" y1="${top}" y2="${top + plotHeight}" stroke="${REPORT_COLORS.axis}" stroke-width="1"/>`
  );
  return parts.join('');
};

const lineChart = (chart: ReportChart, data: ResolvedChartData, frame: Frame) => {
  const { svg: legendSvg, height: legendHeight } = legend(chart);
  const all = data.values.flat().filter((v): v is number => v !== null);
  const scale = niceScale(Math.min(0, ...all), Math.max(...all));

  const left = 46;
  const right = 14;
  const top = legendHeight + 12;
  const bottom = 30;
  const plotWidth = frame.width - left - right;
  const plotHeight = frame.height - top - bottom;
  const count = data.categories.length;
  const x = (i: number) => left + (count === 1 ? plotWidth / 2 : (i / (count - 1)) * plotWidth);
  const y = (value: number) => top + plotHeight - ((value - scale.min) / (scale.max - scale.min)) * plotHeight;

  const parts: string[] = [legendSvg];
  for (const tick of scale.values) {
    parts.push(
      `<line x1="${left}" x2="${left + plotWidth}" y1="${y(tick)}" y2="${y(tick)}" stroke="${REPORT_COLORS.grid}" stroke-width="0.5"/>`,
      text(left - 6, y(tick) + 3, formatAxisValue(tick, chart.valueFormat), {
        anchor: 'end',
        color: REPORT_COLORS.inkMuted,
      })
    );
  }
  parts.push(
    `<line x1="${left}" x2="${left + plotWidth}" y1="${y(scale.min)}" y2="${y(scale.min)}" stroke="${REPORT_COLORS.axis}" stroke-width="1"/>`
  );

  const every = Math.max(1, Math.ceil((count * 52) / plotWidth));
  data.categories.forEach((category, i) => {
    if (i % every === 0 || i === count - 1) {
      parts.push(
        text(x(i), top + plotHeight + 13, truncate(category, 52 * every, AXIS_FONT_SIZE), {
          anchor: 'middle',
        })
      );
    }
  });

  chart.series.forEach((serie, s) => {
    const values = data.values[s];
    // A null breaks the line instead of being drawn as zero.
    let path = '';
    let pen = false;
    values.forEach((value, i) => {
      if (value === null) {
        pen = false;
        return;
      }
      path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(value).toFixed(1)} `;
      pen = true;
    });
    parts.push(
      `<path d="${path}" fill="none" stroke="${serie.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    );
    values.forEach((value, i) => {
      if (value === null) return;
      parts.push(
        `<circle cx="${x(i)}" cy="${y(value)}" r="3.5" fill="${serie.color}" stroke="${REPORT_COLORS.surface}" stroke-width="1.5"/>`
      );
    });

    // Label only the last point of each series: the latest figure is the one
    // read first; the table carries the rest.
    const lastIndex = values.map((v) => v !== null).lastIndexOf(true);
    if (lastIndex >= 0) {
      parts.push(
        text(x(lastIndex), y(values[lastIndex] as number) - 7, formatValueLabel(values[lastIndex] as number, chart.valueFormat), {
          anchor: lastIndex === count - 1 && count > 1 ? 'end' : 'middle',
          size: LABEL_FONT_SIZE,
          color: REPORT_COLORS.inkPrimary,
        })
      );
    }
  });

  return parts.join('');
};

const doughnutChart = (chart: ReportChart, data: ResolvedChartData, frame: Frame) => {
  const values = data.values[0].map((v) => Math.max(0, v ?? 0));
  const total = values.reduce((sum, v) => sum + v, 0);
  const colors = chart.categoryColors ?? [...REPORT_COLORS.series];

  const radius = Math.min(frame.height / 2 - 6, frame.width / 4);
  const inner = radius * 0.58;
  const cx = radius + 10;
  const cy = frame.height / 2;
  const parts: string[] = [];

  let angle = -Math.PI / 2;
  values.forEach((value, i) => {
    if (total === 0 || value === 0) return;
    const sweep = (value / total) * Math.PI * 2;
    const end = angle + sweep - (sweep >= Math.PI * 2 ? 0.0001 : 0);
    const large = sweep > Math.PI ? 1 : 0;
    const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    parts.push(
      `<path d="M${p(radius, angle)} A${radius},${radius} 0 ${large} 1 ${p(radius, end)} L${p(inner, end)} A${inner},${inner} 0 ${large} 0 ${p(inner, angle)} Z" fill="${colors[i % colors.length]}" stroke="${REPORT_COLORS.surface}" stroke-width="2"/>`
    );
    angle += sweep;
  });

  parts.push(
    text(cx, cy + 2, formatValueLabel(total, chart.valueFormat), {
      anchor: 'middle',
      size: 14,
      bold: true,
      color: REPORT_COLORS.inkPrimary,
    }),
    text(cx, cy + 14, 'total', { anchor: 'middle', color: REPORT_COLORS.inkMuted })
  );

  // Legend with value and share: identity never rests on color alone.
  const legendX = cx + radius + 28;
  const rowHeight = 18;
  const legendTop = cy - (data.categories.length * rowHeight) / 2;
  data.categories.forEach((category, i) => {
    const rowY = legendTop + i * rowHeight;
    const share = total === 0 ? 0 : (values[i] / total) * 100;
    parts.push(
      `<rect x="${legendX}" y="${rowY}" width="10" height="10" rx="2" fill="${colors[i % colors.length]}"/>`,
      text(legendX + 16, rowY + 8.5, category, { color: REPORT_COLORS.inkPrimary, size: 9 }),
      text(
        frame.width - 4,
        rowY + 8.5,
        `${formatValueLabel(values[i], chart.valueFormat)}  ·  ${formatValueLabel(share, 'percent')}`,
        { anchor: 'end', size: 9 }
      )
    );
  });

  return parts.join('');
};

/** SVG markup of a chart, `width` x `height` points. */
export const renderChartSvg = (
  chart: ReportChart,
  data: ResolvedChartData,
  width: number,
  height: number
): string => {
  const frame = { width, height };
  const body =
    chart.kind === 'bar'
      ? barChart(chart, data, frame)
      : chart.kind === 'line'
        ? lineChart(chart, data, frame)
        : chart.kind === 'doughnut'
          ? doughnutChart(chart, data, frame)
          : columnChart(chart, data, frame);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
};

/** Height that fits a horizontal bar chart's categories without crowding. */
export const chartHeightFor = (chart: ReportChart, data: ResolvedChartData): number => {
  if (chart.kind === 'bar') return Math.max(140, Math.min(520, 28 + data.rowCount * 20));
  if (chart.kind === 'doughnut') return 170;
  return 220;
};
