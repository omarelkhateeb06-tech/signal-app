"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { searchStoriesRequest, type SearchParams } from "@/lib/api";
import type { SearchResponse, SearchSort } from "@/types/story";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export interface UseSearchInput {
  query: string;
  sectors: string[];
  fromDate: string;
  toDate: string;
  sort: SearchSort;
  limit?: number;
  offset?: number;
}

export function useDebounced<T>(value: T, delay = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

export interface UseSearchResult {
  debouncedQuery: string;
  query: UseQueryResult<SearchResponse, Error>;
  enabled: boolean;
}

export function useSearch(input: UseSearchInput): UseSearchResult {
  const debouncedQuery = useDebounced(input.query.trim());
  const debouncedFrom = useDebounced(input.fromDate);
  const debouncedTo = useDebounced(input.toDate);

  const enabled = debouncedQuery.length >= MIN_QUERY_LENGTH;
  const sector = input.sectors.length === 1 ? input.sectors[0] : undefined;

  const params: SearchParams = {
    q: debouncedQuery,
    sector,
    from_date: debouncedFrom || undefined,
    to_date: debouncedTo || undefined,
    sort: input.sort,
    limit: input.limit,
    offset: input.offset,
  };

  const query = useQuery<SearchResponse, Error>({
    queryKey: [
      "search",
      debouncedQuery,
      sector ?? null,
      debouncedFrom || null,
      debouncedTo || null,
      input.sort,
      input.limit ?? 20,
      input.offset ?? 0,
    ],
    queryFn: () => searchStoriesRequest(params),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  return { debouncedQuery, query, enabled };
}

const RECENT_KEY = "signal.recentSearches";
const MAX_RECENT = 5;

export function loadRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function saveRecentSearch(query: string): string[] {
  if (typeof window === "undefined") return [];
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return loadRecentSearches();
  const current = loadRecentSearches().filter(
    (q) => q.toLowerCase() !== trimmed.toLowerCase(),
  );
  const next = [trimmed, ...current].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
  return next;
}

export function clearRecentSearches(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_KEY);
  } catch {
    // ignore
  }
}
