import {
  clipText,
  createYouTubeTranscriptGenerator,
  durationLabel,
  parseIsoDuration,
  timedtextToPlainText,
  youtubeExternalId,
  YOUTUBE_CHANNELS,
  type AuthorOutcome,
  type YouTubeChannelSpec,
  type YouTubeTranscriptDeps,
} from "../../src/jobs/ingestion/generators/youtubeTranscript";
import type { YouTubeDispatchInputs } from "../../src/llm/prompts/ingestion/youtubeTranscriptPrompt";
import type { NativeGeneratorContext } from "../../src/jobs/ingestion/generators/types";

const NOW = new Date("2026-06-10T12:00:00Z");

const CHANNEL: YouTubeChannelSpec = {
  slug: "youtube-dwarkesh-native",
  handle: "dwarkeshpatel",
  displayName: "Dwarkesh Patel",
  sector: "ai",
};

function makeCtx(): NativeGeneratorContext {
  return { now: () => NOW };
}

const AUTHORED_BODY =
  "Demis Hassabis told Dwarkesh Patel that frontier-lab compute budgets now double every nine months, and that the binding constraint has moved from chips to grid interconnects. " +
  "He argued the next capability jump comes from post-training, put a number on it, and named the bet his lab is making. " +
  "For practitioners the takeaway is to plan datacenter siting before model roadmaps. The full conversation is on Dwarkesh Patel.";

interface UploadSpec {
  videoId: string;
  title: string;
  publishedAt: string; // ISO
  durationIso: string;
  description?: string;
}

interface MockOptions {
  uploads: UploadSpec[];
  timedtextXml?: string | null; // null → fetchText throws (endpoint failure)
  author?: AuthorOutcome;
  existing?: Set<string>;
}

function buildDeps(opts: MockOptions): {
  deps: YouTubeTranscriptDeps;
  fetchJson: jest.Mock;
  fetchText: jest.Mock;
  authorCalls: YouTubeDispatchInputs[];
} {
  const byId = new Map(opts.uploads.map((u) => [u.videoId, u]));
  const fetchJson = jest.fn(async (url: string) => {
    if (url.includes("/channels?")) {
      return {
        items: [
          { contentDetails: { relatedPlaylists: { uploads: "UUdwarkesh" } } },
        ],
      };
    }
    if (url.includes("/playlistItems?")) {
      return {
        items: opts.uploads.map((u) => ({
          snippet: { title: u.title, description: u.description ?? "Episode notes." },
          contentDetails: { videoId: u.videoId, videoPublishedAt: u.publishedAt },
        })),
      };
    }
    if (url.includes("/videos?")) {
      const m = /[?&]id=([^&]+)/.exec(url);
      const u = m ? byId.get(decodeURIComponent(m[1]!)) : undefined;
      if (!u) return { items: [] };
      return {
        items: [
          {
            snippet: { description: u.description ?? "Full episode notes with guest details." },
            contentDetails: { duration: u.durationIso },
          },
        ],
      };
    }
    throw new Error(`unexpected url shape`);
  });

  const fetchText = jest.fn(async (_url: string) => {
    if (opts.timedtextXml === null) throw new Error("http_404");
    return opts.timedtextXml ?? defaultTimedtext();
  });

  const authorCalls: YouTubeDispatchInputs[] = [];
  const deps: YouTubeTranscriptDeps = {
    fetchJson: fetchJson as unknown as (url: string) => Promise<unknown>,
    fetchText: fetchText as unknown as (url: string) => Promise<string>,
    existingExternalIds: async () => opts.existing ?? new Set(),
    authorPost: async (inputs) => {
      authorCalls.push(inputs);
      return (
        opts.author ?? {
          status: "authored",
          output: { headline: "Hassabis puts a number on the compute wall", body: AUTHORED_BODY },
        }
      );
    },
  };
  return { deps, fetchJson, fetchText, authorCalls };
}

// A caption payload comfortably past MIN_TRANSCRIPT_CHARS (500).
function defaultTimedtext(): string {
  const line = `<text start="0" dur="4">compute budgets are doubling and the grid is the constraint</text>`;
  return `<transcript>${line.repeat(12)}</transcript>`;
}

describe("youtubeTranscript pure helpers", () => {
  it("parses ISO-8601 durations", () => {
    expect(parseIsoDuration("PT1H23M45S")).toBe(5025);
    expect(parseIsoDuration("PT47M")).toBe(2820);
    expect(parseIsoDuration("PT30S")).toBe(30);
    expect(parseIsoDuration("P1DT2H")).toBe(93600);
    expect(parseIsoDuration("garbage")).toBe(0);
    expect(parseIsoDuration("")).toBe(0);
  });

  it("formats duration labels", () => {
    expect(durationLabel(5025)).toBe("1h 24m");
    expect(durationLabel(2820)).toBe("47m");
  });

  it("converts timedtext XML to plain text with entity decoding", () => {
    const xml =
      `<transcript>` +
      `<text start="0" dur="2">Hello &amp;#39;world&amp;#39;</text>` +
      `<text start="2.1" dur="3">and &quot;quotes&quot;   collapse</text>` +
      `</transcript>`;
    expect(timedtextToPlainText(xml)).toBe(`Hello 'world' and "quotes" collapse`);
  });

  it("clips long text with an ellipsis", () => {
    expect(clipText("short", 10)).toBe("short");
    expect(clipText("0123456789ABC", 10)).toBe("0123456789…");
  });

  it("builds stable external ids", () => {
    expect(youtubeExternalId("abc123")).toBe("youtube:abc123");
  });

  it("registers all five roster channels with unique slugs", () => {
    expect(YOUTUBE_CHANNELS.length).toBe(5);
    expect(new Set(YOUTUBE_CHANNELS.map((c) => c.slug)).size).toBe(5);
  });
});

describe("createYouTubeTranscriptGenerator", () => {
  const ORIGINAL_KEY = process.env.YOUTUBE_API_KEY;

  beforeEach(() => {
    process.env.YOUTUBE_API_KEY = "yt-test-key";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = ORIGINAL_KEY;
  });

  it("authors a dispatch for the newest qualifying upload", async () => {
    const { deps, fetchJson, authorCalls } = buildDeps({
      uploads: [
        {
          videoId: "vid-new",
          title: "Demis Hassabis — Scaling, Compute, and the Grid",
          publishedAt: "2026-06-08T15:00:00Z",
          durationIso: "PT1H10M",
        },
        {
          videoId: "vid-old",
          title: "Older episode",
          publishedAt: "2026-05-20T15:00:00Z",
          durationIso: "PT1H",
        },
      ],
    });
    const gen = createYouTubeTranscriptGenerator(CHANNEL, deps);
    const out = await gen.generate(makeCtx());

    expect(out.length).toBe(1);
    const c = out[0]!;
    expect(c.externalId).toBe("youtube:vid-new");
    expect(c.url).toBe("https://www.youtube.com/watch?v=vid-new");
    expect(c.sector).toBe("ai");
    expect(c.headline).toBe("Hassabis puts a number on the compute wall");
    expect(c.summary).toContain("Dwarkesh Patel");
    expect(c.summary).toContain("Demis Hassabis — Scaling, Compute, and the Grid");
    expect(c.rawPayload.used_transcript).toBe(true);
    expect(c.rawPayload.video_id).toBe("vid-new");

    expect(authorCalls.length).toBe(1);
    expect(authorCalls[0]!.transcriptExcerpt).not.toBeNull();
    expect(authorCalls[0]!.durationLabel).toBe("1h 10m");
    expect(authorCalls[0]!.publishedLabel).toBe("June 8, 2026");
    // The key rides in the query string of every Data API request.
    expect(String(fetchJson.mock.calls[0]![0])).toContain("key=yt-test-key");
  });

  it("returns empty and makes no requests when YOUTUBE_API_KEY is unset", async () => {
    delete process.env.YOUTUBE_API_KEY;
    const { deps, fetchJson, authorCalls } = buildDeps({ uploads: [] });
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const gen = createYouTubeTranscriptGenerator(CHANNEL, deps);
    const out = await gen.generate(makeCtx());
    expect(out).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled();
    expect(authorCalls.length).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("YOUTUBE_API_KEY unset"),
    );
  });

  it("returns empty when no upload is inside the lookback window", async () => {
    const { deps, authorCalls } = buildDeps({
      uploads: [
        {
          videoId: "vid-old",
          title: "Older episode",
          publishedAt: "2026-05-20T15:00:00Z",
          durationIso: "PT1H",
        },
      ],
    });
    const gen = createYouTubeTranscriptGenerator(CHANNEL, deps);
    expect(await gen.generate(makeCtx())).toEqual([]);
    expect(authorCalls.length).toBe(0);
  });

  it("skips an already-posted episode without re-authoring", async () => {
    const { deps, authorCalls } = buildDeps({
      uploads: [
        {
          videoId: "vid-new",
          title: "Fresh but already posted",
          publishedAt: "2026-06-08T15:00:00Z",
          durationIso: "PT1H",
        },
      ],
      existing: new Set(["youtube:vid-new"]),
    });
    const gen = createYouTubeTranscriptGenerator(CHANNEL, deps);
    expect(await gen.generate(makeCtx())).toEqual([]);
    expect(authorCalls.length).toBe(0);
  });

  it("skips a Short via the duration floor and takes the next upload", async () => {
    const { deps } = buildDeps({
      uploads: [
        {
          videoId: "vid-short",
          title: "Clip: 90-second teaser",
          publishedAt: "2026-06-09T15:00:00Z",
          durationIso: "PT3M",
        },
        {
          videoId: "vid-episode",
          title: "Full conversation",
          publishedAt: "2026-06-07T15:00:00Z",
          durationIso: "PT2H5M",
        },
      ],
    });
    const gen = createYouTubeTranscriptGenerator(CHANNEL, deps);
    const out = await gen.generate(makeCtx());
    expect(out.length).toBe(1);
    expect(out[0]!.externalId).toBe("youtube:vid-episode");
  });

  it("falls back to description-only authoring when captions are unavailable", async () => {
    const { deps, authorCalls } = buildDeps({
      uploads: [
        {
          videoId: "vid-new",
          title: "Episode without captions",
          publishedAt: "2026-06-08T15:00:00Z",
          durationIso: "PT55M",
          description: "Guest X on chip packaging, with timestamps and links.",
        },
      ],
      timedtextXml: null, // timedtext endpoint fails outright
    });
    const gen = createYouTubeTranscriptGenerator(CHANNEL, deps);
    const out = await gen.generate(makeCtx());
    expect(out.length).toBe(1);
    expect(out[0]!.rawPayload.used_transcript).toBe(false);
    expect(authorCalls[0]!.transcriptExcerpt).toBeNull();
    expect(authorCalls[0]!.description).toContain("chip packaging");
  });

  it("returns no candidate when the model declines", async () => {
    const { deps } = buildDeps({
      uploads: [
        {
          videoId: "vid-new",
          title: "Thin episode",
          publishedAt: "2026-06-08T15:00:00Z",
          durationIso: "PT45M",
        },
      ],
      author: { status: "skipped", reason: "description-too-thin" },
    });
    const gen = createYouTubeTranscriptGenerator(CHANNEL, deps);
    expect(await gen.generate(makeCtx())).toEqual([]);
  });

  it("swallows Data API failures without throwing (shared run safety)", async () => {
    const failingDeps: YouTubeTranscriptDeps = {
      fetchJson: async () => {
        throw new Error("http_500");
      },
      fetchText: async () => "",
      existingExternalIds: async () => new Set(),
      authorPost: async () => {
        throw new Error("must not be reached");
      },
    };
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const gen = createYouTubeTranscriptGenerator(CHANNEL, failingDeps);
    await expect(gen.generate(makeCtx())).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("youtube-dwarkesh-native failed"),
      "http_500",
    );
  });
});
