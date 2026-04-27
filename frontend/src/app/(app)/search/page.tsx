"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search as SearchIcon, X } from "lucide-react";
import {
  clearRecentSearches,
  loadRecentSearches,
  saveRecentSearch,
  useSearch,
} from "@/hooks/useSearch";
import { SearchFilters } from "@/components/search/SearchFilters";
import { SearchResultCard } from "@/components/search/SearchResultCard";
import { extractApiError } from "@/lib/api";
import { extractHighlightTerms } from "@/lib/highlight";
import { SECTORS } from "@/lib/onboarding";
import type { SearchSort } from "@/types/story";

const PAGE_SIZE = 20;

function normalizeSort(value: string | null): SearchSort {
  if (value === "newest" || value === "most_saved") return value;
  return "relevance";
}

export default function SearchPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQuery = searchParams?.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [sectors, setSectors] = useState<string[]>(() => {
    const raw = searchParams?.get("sector");
    return raw ? raw.split(",").filter(Boolean) : [];
  });
  const [fromDate, setFromDate] = useState<string>(
    searchParams?.get("from_date") ?? "",
  );
  const [toDate, setToDate] = useState<string>(searchParams?.get("to_date") ?? "");
  const [sort, setSort] = useState<SearchSort>(
    normalizeSort(searchParams?.get("sort")),
  );
  const [offset, setOffset] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setRecent(loadRecentSearches());
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setOffset(0);
  }, [query, sectors, fromDate, toDate, sort]);

  const { debouncedQuery, query: searchQuery, enabled } = useSearch({
    query,
    sectors,
    fromDate,
    toDate,
    sort,
    limit: PAGE_SIZE,
    offset,
  });

  useEffect(() => {
    if (!enabled) return;
    if (searchQuery.isSuccess && searchQuery.data?.query) {
      setRecent(saveRecentSearch(searchQuery.data.query));
    }
  }, [enabled, searchQuery.isSuccess, searchQuery.data?.query]);

  const terms = useMemo(() => extractHighlightTerms(debouncedQuery), [debouncedQuery]);
  const results = searchQuery.data;
  const total = results?.total ?? 0;
  const hasMore = results?.has_more ?? false;

  const resetFilters = (): void => {
    setSectors([]);
    setFromDate("");
    setToDate("");
    setSort("relevance");
  };

  const applyRecent = (term: string): void => {
    setQuery(term);
    inputRef.current?.focus();
  };

  const applySectorSuggestion = (value: string): void => {
    if (!sectors.includes(value)) {
      setSectors([...sectors, value]);
    }
    inputRef.current?.focus();
  };

  const clearQuery = (): void => {
    setQuery("");
    router.replace("/search");
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Search</h1>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stories by keyword or phrase..."
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            aria-label="Search stories"
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={clearQuery}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <SearchFilters
          sectors={sectors}
          onSectorsChange={setSectors}
          fromDate={fromDate}
          onFromDateChange={setFromDate}
          toDate={toDate}
          onToDateChange={setToDate}
          sort={sort}
          onSortChange={setSort}
          onReset={resetFilters}
        />

        <section className="space-y-4">
          {!enabled && (
            <div className="space-y-6">
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                Start typing to search. Use quotes for exact phrases, e.g.
                {" "}
                <span className="font-mono text-slate-700">&quot;reasoning models&quot;</span>.
              </div>

              {recent.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Recent searches
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        clearRecentSearches();
                        setRecent([]);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-900"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recent.map((term) => (
                      <button
                        key={term}
                        type="button"
                        onClick={() => applyRecent(term)}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Browse sectors
                </h2>
                <div className="flex flex-wrap gap-2">
                  {SECTORS.map((sector) => (
                    <button
                      key={sector.value}
                      type="button"
                      onClick={() => applySectorSuggestion(sector.value)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      {sector.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {enabled && searchQuery.isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-32 animate-pulse rounded-lg border border-slate-200 bg-white"
                />
              ))}
            </div>
          )}

          {enabled && searchQuery.error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              {extractApiError(searchQuery.error, "Search failed.")}
            </div>
          )}

          {enabled && !searchQuery.isLoading && !searchQuery.error && results && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">
                  Found {total} {total === 1 ? "story" : "stories"}
                  {results.query && (
                    <>
                      {" for "}
                      <span className="font-medium text-slate-900">
                        &ldquo;{results.query}&rdquo;
                      </span>
                    </>
                  )}
                </p>
              </div>

              {results.stories.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
                  No stories found. Try different keywords.
                </div>
              ) : (
                <div className="space-y-4">
                  {results.stories.map((story) => (
                    <SearchResultCard
                      key={story.id}
                      story={story}
                      terms={terms}
                    />
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 text-xs">
                <button
                  type="button"
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-slate-500">
                  Showing {results.stories.length > 0 ? offset + 1 : 0}–
                  {offset + results.stories.length} of {total}
                </span>
                <button
                  type="button"
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={!hasMore}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
