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
import { useTier } from "@/hooks/useTier";
import { SearchFilters } from "@/components/search/SearchFilters";
import { SearchResultCard } from "@/components/search/SearchResultCard";
import { SearchLimitModal } from "@/components/search/SearchLimitModal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { extractApiError } from "@/lib/api";
import { extractHighlightTerms } from "@/lib/highlight";
import { SECTORS } from "@/lib/onboarding";
import { isGatePayload, type SearchSort } from "@/types/story";

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

  const tierQuery = useTier();
  const isFree = tierQuery.data?.tier === "free";

  const gate = isGatePayload(searchQuery.data) ? searchQuery.data : null;
  const [dismissedGate, setDismissedGate] = useState(false);
  useEffect(() => {
    if (gate) setDismissedGate(false);
  }, [gate]);

  useEffect(() => {
    if (!enabled || gate) return;
    const data = searchQuery.data;
    if (searchQuery.isSuccess && data && !isGatePayload(data) && data.query) {
      setRecent(saveRecentSearch(data.query));
    }
  }, [enabled, searchQuery.isSuccess, searchQuery.data, gate]);

  const terms = useMemo(() => extractHighlightTerms(debouncedQuery), [debouncedQuery]);
  const results =
    searchQuery.data && !isGatePayload(searchQuery.data) ? searchQuery.data : null;
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
    <div className="space-y-6 pb-12 pt-2">
      <header className="space-y-3">
        <div className="border-b-2 border-line pb-4">
          <h1 className="font-display text-[26px] font-semibold leading-none tracking-tight text-ink md:text-[30px]">
            Search
          </h1>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">
            Across your briefing
          </p>
        </div>
        <Input
          ref={inputRef}
          inputSize="lg"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your briefing…"
          aria-label="Search stories"
          autoFocus
          leadingIcon={<SearchIcon className="h-4 w-4" />}
          trailingSlot={
            query ? (
              <button
                type="button"
                onClick={clearQuery}
                aria-label="Clear search"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-line/60 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null
          }
        />
        {/* Phase 12g — free-tier search counter. Hidden for pro and
            during the initial useTier fetch to avoid flashing chrome. */}
        {isFree && tierQuery.data && (
          <p className="text-xs text-ink-muted">
            {/* Counter is a UI affordance only — the server enforces the
                actual cap (chunk 4). At present we don't surface a
                per-day usage number from the API, so we show the cap
                as guidance. */}
            3 free searches per day.
          </p>
        )}
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
              <div className="rounded-md border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-muted">
                Start typing to search. Use quotes for exact phrases, e.g.{" "}
                <span className="font-mono text-ink">&quot;reasoning models&quot;</span>.
              </div>

              {recent.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                      Recent searches
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        clearRecentSearches();
                        setRecent([]);
                      }}
                      className="text-xs text-ink-muted transition-colors hover:text-ink"
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
                        className="rounded-pill border border-line bg-surface px-3 py-1 text-xs text-ink-muted transition-colors hover:border-ink-muted hover:text-ink"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                  Browse sectors
                </h2>
                <div className="flex flex-wrap gap-2">
                  {SECTORS.map((sector) => (
                    <button
                      key={sector.value}
                      type="button"
                      onClick={() => applySectorSuggestion(sector.value)}
                      className="rounded-pill border border-line bg-surface px-3 py-1 text-xs text-ink-muted transition-colors hover:border-ink-muted hover:text-ink"
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
                <div key={i} className="skeleton h-32 rounded-md border border-line" />
              ))}
            </div>
          )}

          {enabled && searchQuery.error && (
            <div className="rounded-md border border-err/40 bg-err/5 p-4 text-sm text-err">
              {extractApiError(searchQuery.error, "Search failed.")}
            </div>
          )}

          {enabled && !searchQuery.isLoading && !searchQuery.error && results && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-ink-muted">
                  Found {total} {total === 1 ? "story" : "stories"}
                  {results.query && (
                    <>
                      {" for "}
                      <span className="font-medium text-ink">
                        &ldquo;{results.query}&rdquo;
                      </span>
                    </>
                  )}
                </p>
              </div>

              {results.stories.length === 0 ? (
                <div className="rounded-md border border-dashed border-line bg-surface p-12 text-center text-sm text-ink-muted">
                  No stories found. Try different keywords.
                </div>
              ) : (
                <div className="space-y-4">
                  {results.stories.map((story, i) => (
                    <SearchResultCard
                      key={story.id}
                      story={story}
                      terms={terms}
                      index={i}
                    />
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 text-xs">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                >
                  Previous
                </Button>
                <span className="text-ink-muted">
                  Showing {results.stories.length > 0 ? offset + 1 : 0}–
                  {offset + results.stories.length} of {total}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={!hasMore}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </section>
      </div>

      {gate && !dismissedGate && (
        <SearchLimitModal gate={gate} onDismiss={() => setDismissedGate(true)} />
      )}
    </div>
  );
}
