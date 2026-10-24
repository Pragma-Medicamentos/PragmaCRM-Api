import { DateTime } from 'luxon';
import { ManagementReportContext } from '../../../domain/types/managementReport.types';
import { ReportDefinition, ReportParameter } from '../../../domain/types/report.types';
import { ERP_TIMEZONE } from '../../../lib/parseErpDate';

/*
 * Helpers shared by the management report builders (PCRM-159). Like the rest
 * of services/reports/, report content is in Spanish: the file is what the
 * client reads.
 */

/** What every table shows when the filters leave nothing (PCRM-159 CA). */
export const EMPTY_PERIOD = 'Sin datos para el período.';

export const ROUTE_ATTRIBUTION_NOTE =
  'La ruta, su zona y su municipio son los de la ruta a la que se atribuye la venta o la visita: venta ligada a una visita de la agenda de esa ruta. Una venta sin visita no tiene ruta atribuible.';

export const FILTERS_NOTE =
  'Los filtros de zona, vendedor y ruta se combinan (todos deben cumplirse).';

/** Local day (`YYYY-MM-DD`) of an instant, for `date` cells. */
export const localDayOf = (instant: Date | null): string | null =>
  instant ? (DateTime.fromJSDate(instant, { zone: ERP_TIMEZONE }).toISODate() as string) : null;

/** Share of `part` in `total`, in points with one decimal; null without total. */
export const shareOf = (part: number, total: number): number | null =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : null;

/** Money rounded to cents after adding floats. */
export const cents = (value: number): number => Math.round(value * 100) / 100;

/** Applied filters, or a single "Sin filtros" line. */
export const filterParameters = (context: ManagementReportContext): ReportParameter[] =>
  context.filters.length > 0
    ? context.filters
    : [{ label: 'Filtros', value: 'Sin filtros (todo el equipo)' }];

/**
 * The fields every management report shares: period, generation stamp,
 * filters first among the parameters.
 */
export const baseDefinition = (
  context: ManagementReportContext,
  extraParameters: ReportParameter[] = []
): Pick<ReportDefinition, 'period' | 'generatedAt' | 'generatedBy' | 'parameters'> => ({
  period: context.period,
  generatedAt: context.generatedAt,
  generatedBy: context.generatedBy,
  parameters: [...filterParameters(context), ...extraParameters],
});
