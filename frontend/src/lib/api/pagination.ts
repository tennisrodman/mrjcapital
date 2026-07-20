import { apiRequest } from '@/config/api';
import type { Paginated } from '@/types/deal';

export const API_PAGE_SIZE = 50;
const PAGE_BATCH_SIZE = 10;

/** Load a complete DRF paginated collection without silently truncating large datasets. */
export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const separator = path.includes('?') ? '&' : '?';
  const first = await apiRequest<Paginated<T>>(`${path}${separator}page=1`);
  const totalPages = Math.ceil(first.count / API_PAGE_SIZE);
  if (totalPages <= 1) return first.results;

  const results = [...first.results];
  for (let firstPage = 2; firstPage <= totalPages; firstPage += PAGE_BATCH_SIZE) {
    const lastPage = Math.min(firstPage + PAGE_BATCH_SIZE - 1, totalPages);
    const batch = await Promise.all(
      Array.from({ length: lastPage - firstPage + 1 }, (_, index) =>
        apiRequest<Paginated<T>>(`${path}${separator}page=${firstPage + index}`),
      ),
    );
    results.push(...batch.flatMap((page) => page.results));
  }
  return results;
}
