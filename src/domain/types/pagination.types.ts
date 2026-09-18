/**
 * Page of results nested inside `ApiResponse.data`.
 *
 * The envelope stays untouched: paging metadata travels with the items instead
 * of adding a sibling `meta` field, so a client that already reads `data` keeps
 * working. First paginated endpoint in the API, so this is the shape every
 * listing should follow from here on.
 */
export interface Paginated<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export const buildPage = <T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number
): Paginated<T> => ({
  items,
  page,
  page_size: pageSize,
  total,
  total_pages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
});
