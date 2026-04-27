-- 0015 — Phase 12e.1: events, event_sources, ingestion_candidates.
--
-- Introduces the event-centric data model: one event in the world is
-- one row in `events`, with one or more linked sources in `event_sources`.
-- Replaces the single-row-per-article shape of `stories`. The existing
-- `stories` table is preserved untouched for backward compatibility
-- through 12e; feed/detail/v2 endpoints will dual-read across both.
-- Deprecation of `stories` is post-launch.
--
-- `events.embedding` ships as nullable bytea placeholder. Conversion
-- to vector(N) with the pgvector extension is deferred to 12e.6a once
-- the embedding model + dimensions are picked. Holding off on pgvector
-- here keeps stage 2 unblocked from a model-selection decision.
--
-- `events.facts` is a JSONB column rather than a separate table. Facts
-- are 1:1 with events; the schema is in flux during 12e.5a enrichment
-- iteration; cross-event fact queries are rare today. GIN-index the
-- column later if hot. Rationale captured in stage 1 audit and roadmap
-- §5.4.

-- Candidate status enum. Values reflect the pipeline stages added in
-- 12e.2–12e.6: discovered (raw row landed), heuristic_filtered (failed
-- length/recency/noise), llm_rejected (failed relevance gate),
-- enriching (passed gate, in tier-generation), published (event row
-- written), duplicate (clustered onto an existing event), failed
-- (terminal stage failure, dead-lettered).
CREATE TYPE ingestion_candidate_status AS ENUM (
  'discovered',
  'heuristic_filtered',
  'llm_rejected',
  'enriching',
  'published',
  'duplicate',
  'failed'
);--> statement-breakpoint

CREATE TABLE events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector                   varchar(50) NOT NULL,
  headline                 varchar(255) NOT NULL,
  context                  text NOT NULL,
  why_it_matters           text NOT NULL,
  -- TEXT-as-JSON of {accessible, briefed, technical} : {thesis, support}.
  -- Mirrors stories.why_it_matters_template; same parser
  -- (parseWhyItMattersTemplate at backend/src/utils/depthVariants.ts).
  why_it_matters_template  text,
  -- Convenience pointer to the primary event_sources row's URL/name —
  -- denormalized for read paths that don't need the full source list.
  -- Authoritative attribution lives in event_sources.
  primary_source_url       text NOT NULL,
  primary_source_name      varchar(255),
  author_id                uuid REFERENCES writers(id) ON DELETE SET NULL,
  -- 5–8 extracted facts produced by the 12e.5a fact-extraction worker;
  -- shared grounding for the three tier-generation calls in 12e.5b.
  facts                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Embedding placeholder — converted to vector(N) in 12e.6a.
  embedding                bytea,
  published_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX events_sector_published_at_idx
  ON events (sector, published_at);--> statement-breakpoint
CREATE INDEX events_created_at_idx
  ON events (created_at);--> statement-breakpoint

CREATE TABLE event_sources (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ingestion_source_id uuid REFERENCES ingestion_sources(id) ON DELETE SET NULL,
  url                 text NOT NULL,
  name                varchar(255),
  role                text NOT NULL DEFAULT 'alternate'
                      CHECK (role IN ('primary', 'alternate')),
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, url)
);--> statement-breakpoint

CREATE INDEX event_sources_event_idx
  ON event_sources (event_id);--> statement-breakpoint

-- Exactly one primary source per event. Partial unique index lets the
-- table hold any number of alternates; only role='primary' is uniqued.
CREATE UNIQUE INDEX event_sources_one_primary_per_event
  ON event_sources (event_id) WHERE role = 'primary';--> statement-breakpoint

CREATE TABLE ingestion_candidates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_source_id uuid NOT NULL REFERENCES ingestion_sources(id) ON DELETE CASCADE,
  -- Adapter-stable external identifier for the item: RSS guid, arXiv
  -- id, EDGAR accession number, HN item id, Reddit fullname. UNIQUE
  -- (ingestion_source_id, external_id) is the dedup target.
  external_id         text NOT NULL,
  url                 text NOT NULL,
  raw_title           text,
  raw_summary         text,
  raw_published_at    timestamptz,
  raw_payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              ingestion_candidate_status NOT NULL DEFAULT 'discovered',
  -- Free-text reason set when status advances to a rejection/failure
  -- state (e.g. 'banned-opener', 'off-sector', 'body-fetch-403').
  status_reason       text,
  resolved_event_id   uuid REFERENCES events(id) ON DELETE SET NULL,
  discovered_at       timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  UNIQUE (ingestion_source_id, external_id)
);--> statement-breakpoint

CREATE INDEX ingestion_candidates_status_discovered_idx
  ON ingestion_candidates (status, discovered_at);
