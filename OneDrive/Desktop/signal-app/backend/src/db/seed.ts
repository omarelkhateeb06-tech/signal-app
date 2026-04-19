import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "./index";

// Deterministic PRNG so reruns produce the same mix.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x516e414c); // "SIGN AL"
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

// ---------- Writers ----------

const writerSeeds: Array<typeof schema.writers.$inferInsert> = [
  {
    name: "Maya Chen",
    email: "maya.chen@signal.so",
    bio: "Former research engineer at DeepMind. Writes the AI desk — covers frontier models, inference infra, and the economics of scale.",
    twitterHandle: "mayachen_ai",
    sectors: ["ai"],
  },
  {
    name: "David Ortiz",
    email: "david.ortiz@signal.so",
    bio: "Ex-Goldman credit strategist turned journalist. Covers macro, rates, and the plumbing behind capital flows.",
    twitterHandle: "dortiz_macro",
    sectors: ["finance"],
  },
  {
    name: "Priya Ramanathan",
    email: "priya.r@signal.so",
    bio: "Former process engineer at TSMC Arizona. Covers the semiconductor supply chain — lithography, packaging, and foundry economics.",
    twitterHandle: "priya_fab",
    sectors: ["semiconductors"],
  },
];

// ---------- Story templates ----------

interface StoryTemplate {
  sector: "ai" | "finance" | "semiconductors";
  headline: string;
  context: string;
  whyItMatters: string;
  sourceUrl: string;
  sourceName: string;
}

const aiStories: StoryTemplate[] = [
  {
    sector: "ai",
    headline: "Anthropic releases Claude Opus 4.7 with expanded 500K context window",
    context:
      "Anthropic shipped Claude Opus 4.7, extending the effective context to 500K tokens and cutting long-context inference cost by roughly 35%. The release includes prompt-cache improvements that keep large system prompts warm across sessions, and a new structured-output mode aimed at agent workloads.",
    whyItMatters:
      "Long-context economics were the main thing stopping teams from feeding whole codebases or multi-doc corpora into a model per request. A 35% cut moves agent pipelines from experimental to defensible in production budgets.",
    sourceUrl: "https://www.anthropic.com/news/claude-opus-4-7",
    sourceName: "Anthropic",
  },
  {
    sector: "ai",
    headline: "Meta open-sources Llama 4.5 with native mixture-of-experts routing",
    context:
      "Meta released Llama 4.5 under its community license. The 400B-parameter model uses a 16-expert MoE with 45B active parameters per token, and Meta published the router weights — a first for a major open release.",
    whyItMatters:
      "Open MoE routers let downstream teams fine-tune the routing itself, not just the experts. That closes most of the quality gap open models have had against frontier labs on reasoning tasks.",
    sourceUrl: "https://ai.meta.com/blog/llama-4-5",
    sourceName: "Meta AI",
  },
  {
    sector: "ai",
    headline: "OpenAI signs $12B inference capacity deal with Oracle",
    context:
      "OpenAI committed to $12B of reserved inference capacity on Oracle Cloud over five years, covering roughly 400K H200-equivalent GPUs. The contract is structured as a pay-for-capacity floor with overage pricing, not pure on-demand.",
    whyItMatters:
      "This is the first major inference contract priced like a long-term power purchase agreement. Expect every hyperscaler deal to move to capacity-floor pricing by year-end — it changes how you model AI gross margins.",
    sourceUrl: "https://www.wsj.com/tech/ai/openai-oracle-inference-deal",
    sourceName: "Wall Street Journal",
  },
  {
    sector: "ai",
    headline: "Google DeepMind's Gemini 3 achieves 92% on SWE-bench Verified",
    context:
      "Gemini 3 posted 92.4% on SWE-bench Verified, up from 76% for Gemini 2.5. DeepMind credits a new trace-based RL training loop that rewards the model for minimal diffs and successful test runs rather than token-level similarity.",
    whyItMatters:
      "SWE-bench is the best proxy we have for 'can this model actually close tickets.' Crossing 90% means junior-engineer-level refactors are now a commodity capability, not a demo.",
    sourceUrl: "https://deepmind.google/research/gemini-3-swe",
    sourceName: "Google DeepMind",
  },
  {
    sector: "ai",
    headline: "Hugging Face acquires inference-optimization startup Relace for $340M",
    context:
      "Hugging Face acquired Relace, which builds speculative-decoding runtimes that cut inference latency 40-60% on open-weight models. Relace's 22-person team joins Hugging Face's inference platform group.",
    whyItMatters:
      "Speculative decoding is about to go from a research trick to table stakes. If you're shipping open models in prod, your per-token cost is about to drop without you doing anything.",
    sourceUrl: "https://huggingface.co/blog/relace-acquisition",
    sourceName: "Hugging Face",
  },
  {
    sector: "ai",
    headline: "Mistral raises €900M Series D at €8B valuation",
    context:
      "French AI lab Mistral closed a €900M Series D led by General Catalyst and the French sovereign wealth fund. The round values the company at €8B post-money, roughly 2x its previous round 14 months ago.",
    whyItMatters:
      "Mistral is the only European lab with a real claim to sovereignty-grade AI. This round is less about market competition and more about EU capital flowing to keep a domestic option alive.",
    sourceUrl: "https://mistral.ai/news/series-d",
    sourceName: "Mistral AI",
  },
  {
    sector: "ai",
    headline: "NIST publishes final AI red-teaming framework for federal procurement",
    context:
      "NIST released AI RMF 2.0 with mandatory red-team procedures for any model used in federal procurement above $10M. The framework covers prompt injection, training-data extraction, and supply-chain attacks on model weights.",
    whyItMatters:
      "Federal procurement sets the floor for enterprise. Within 18 months expect every RFP above seven figures to cite NIST RMF 2.0 — start collecting red-team artifacts now if you sell to enterprise.",
    sourceUrl: "https://www.nist.gov/itl/ai-rmf-2-final",
    sourceName: "NIST",
  },
  {
    sector: "ai",
    headline: "Cohere pivots entirely to enterprise search, shuts down public API",
    context:
      "Cohere announced it will sunset its public API by October and focus exclusively on on-premise and VPC-deployed enterprise search. CEO Aidan Gomez framed the move as 'we're not in the consumer race.'",
    whyItMatters:
      "Cohere was the first frontier lab to publicly concede the general-purpose API layer is a commodity. Expect Inflection, Character, and at least one other name-brand lab to make similar moves before year-end.",
    sourceUrl: "https://cohere.com/blog/enterprise-focus",
    sourceName: "Cohere",
  },
  {
    sector: "ai",
    headline: "EU AI Act Article 50 enforcement begins with €14M Scale AI fine",
    context:
      "The European Commission levied its first Article 50 fine — €14M against Scale AI — for inadequate documentation of data-labeling pipelines used to train a Tier-2 foundation model supplied to a European customer.",
    whyItMatters:
      "The fine is small; the precedent isn't. Scale was targeted because its data provenance docs didn't meet the 'sufficiently detailed summary' bar. If you train models, your data-provenance story just became a compliance artifact.",
    sourceUrl: "https://ec.europa.eu/commission/ai-act/enforcement-scale",
    sourceName: "European Commission",
  },
  {
    sector: "ai",
    headline: "Perplexity launches Deep Research API priced at $0.04 per query",
    context:
      "Perplexity opened its Deep Research product as an API at $0.04 per query, bundling web retrieval, multi-hop reasoning, and citation verification. The endpoint is rate-limited to 10 RPS on the default tier.",
    whyItMatters:
      "This undercuts rolling-your-own retrieval stack by roughly 10x once you factor in engineering time. For any product where search quality is load-bearing, build vs. buy just flipped.",
    sourceUrl: "https://docs.perplexity.ai/deep-research-api",
    sourceName: "Perplexity",
  },
  {
    sector: "ai",
    headline: "Tesla's FSD v13 drops human intervention rate below 1 per 10,000 miles",
    context:
      "Tesla reported FSD v13 achieved 0.8 human interventions per 10,000 highway miles in its latest fleet telemetry, down from 4.2 in v12. City driving remains higher at 6.1 per 10K miles.",
    whyItMatters:
      "Highway FSD is now statistically safer than median human drivers on highways. That's the threshold where insurance and regulatory conversations shift from 'if' to 'when' — watch state DMV rulings in Q3.",
    sourceUrl: "https://www.tesla.com/vehicle-safety-report",
    sourceName: "Tesla",
  },
  {
    sector: "ai",
    headline: "Databricks open-sources DBRX-Next, a 480B MoE tuned for SQL and analytics",
    context:
      "Databricks released DBRX-Next, a 480B-parameter MoE model fine-tuned on synthetic SQL and pandas transcripts. Early benchmarks show it beats GPT-4o on text-to-SQL by 8-11 points depending on dialect.",
    whyItMatters:
      "Analytics copilots have been held back by SQL dialect drift. A model this strong on Snowflake/BigQuery/Postgres nuance collapses the moat most analytics-assistant startups were relying on.",
    sourceUrl: "https://www.databricks.com/blog/dbrx-next",
    sourceName: "Databricks",
  },
  {
    sector: "ai",
    headline: "Cursor raises $500M Series C at $9B valuation, crosses 2M paying developers",
    context:
      "Cursor closed a $500M Series C led by Thrive Capital at a $9B valuation. The company disclosed 2.1M paying developers and $340M ARR, up from $100M a year ago.",
    whyItMatters:
      "Cursor is now a top-5 developer tool by paid seats. The interesting line isn't the valuation — it's that VS Code's distribution moat didn't hold once the product on top was 10x better at one workflow.",
    sourceUrl: "https://www.cursor.sh/blog/series-c",
    sourceName: "Cursor",
  },
  {
    sector: "ai",
    headline: "MIT study: 68% of knowledge workers now use AI tools daily, up from 21% in 2024",
    context:
      "MIT's 2026 Future of Work survey (n=18,400 across 22 countries) found 68% of knowledge workers use AI tools daily, with median time savings self-reported at 5.4 hours per week. Management still sees much lower adoption rates than individual contributors.",
    whyItMatters:
      "The perception gap between ICs and managers is the real story. If your pricing assumes seat-based AI purchase decisions flow through managers, you're underpricing — bottom-up adoption is running 2-3x ahead of procurement.",
    sourceUrl: "https://cisr.mit.edu/publication/2026-future-of-work",
    sourceName: "MIT CISR",
  },
  {
    sector: "ai",
    headline: "xAI's Colossus 2 cluster reaches 1M H200-equivalent GPUs online",
    context:
      "xAI confirmed Colossus 2 in Memphis is now operating at 1M H200-equivalent GPUs, making it the largest publicly disclosed training cluster. Power draw is roughly 1.4GW, supplied partly by on-site gas turbines.",
    whyItMatters:
      "Training cluster size is turning into an energy-siting problem, not a silicon problem. The teams that locked in power purchase agreements in 2024 are now the ones with real optionality on next-gen training runs.",
    sourceUrl: "https://x.ai/blog/colossus-2",
    sourceName: "xAI",
  },
  {
    sector: "ai",
    headline: "Stanford HAI index: inference costs drop 89% year-over-year at constant quality",
    context:
      "Stanford's 2026 AI Index reports that achieving GPT-4-equivalent output quality now costs 11% of what it did 12 months ago, driven by smaller distilled models, speculative decoding, and hardware improvements.",
    whyItMatters:
      "If you built an AI feature on last year's cost envelope, you probably over-engineered around token budgets. The teams that assume another 5-10x drop over the next year are making better product decisions than the ones optimizing for today's prices.",
    sourceUrl: "https://hai.stanford.edu/ai-index-2026",
    sourceName: "Stanford HAI",
  },
  {
    sector: "ai",
    headline: "Anthropic and Palantir announce classified-workload deployment for DoD",
    context:
      "Anthropic and Palantir announced a joint deployment of Claude within Palantir's IL6-accredited environments for DoD customers. The offering covers up to Secret-level classified workloads with on-prem inference.",
    whyItMatters:
      "IL6 accreditation takes 18+ months and was the moat keeping defense spend inside legacy integrators. Anthropic just compressed that timeline via Palantir's existing footprint — expect other labs to follow the same path rather than build it themselves.",
    sourceUrl: "https://www.palantir.com/newsroom/anthropic-il6",
    sourceName: "Palantir",
  },
];

const financeStories: StoryTemplate[] = [
  {
    sector: "finance",
    headline: "Fed holds rates at 4.25%, signals two cuts by year-end",
    context:
      "The FOMC held the federal funds target at 4.25-4.50% and updated its dot plot to show a median of two 25bp cuts by December. Chair Powell cited moderating services inflation and a softening jobs report as the main inputs.",
    whyItMatters:
      "Two-cut pricing was already 70% priced in, so the immediate market move is small. The signal matters more for 2027 corporate refinancing windows — CFOs should pull forward term-out decisions before the cut cycle compresses credit spreads.",
    sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomcpresconf20260312.htm",
    sourceName: "Federal Reserve",
  },
  {
    sector: "finance",
    headline: "Blackstone buys $4.2B portfolio of distressed office loans at 42 cents on the dollar",
    context:
      "Blackstone Real Estate Credit closed a $4.2B transaction acquiring a portfolio of senior office loans from a consortium of US regional banks at 42 cents on the dollar. The portfolio covers 38 assets primarily in secondary markets.",
    whyItMatters:
      "This is the first big mark-to-market event for regional bank CRE books in 2026. Expect auditors to reference the 42-cent print when pressuring other holders — bank CRE writedowns are likely to step down in sync over the next two quarters.",
    sourceUrl: "https://www.ft.com/content/blackstone-cre-portfolio",
    sourceName: "Financial Times",
  },
  {
    sector: "finance",
    headline: "Citadel's Wellington fund returns 38% in 2025, widens gap with multi-strat peers",
    context:
      "Citadel's flagship Wellington fund returned 38.1% net in 2025, its best year since 2008. Equities and commodities drove most of the performance; fixed-income relative value contributed less than 5%.",
    whyItMatters:
      "The dispersion between top-quartile and median multi-strat is the widest it's been in a decade. LPs are increasingly willing to pay 3-and-30 at the top — which changes the negotiating leverage of every platform hiring PMs this year.",
    sourceUrl: "https://www.bloomberg.com/news/citadel-wellington-2025",
    sourceName: "Bloomberg",
  },
  {
    sector: "finance",
    headline: "SEC approves spot Ethereum ETF staking, triggers $2.8B in inflows in first week",
    context:
      "The SEC approved an amendment letting spot Ethereum ETFs stake their underlying holdings and distribute yield to shareholders. In the first week post-approval, the eight approved funds saw $2.8B in net inflows.",
    whyItMatters:
      "Staking yield is what fund sponsors needed to put ETH ETFs on par with fixed-income sleeves in 60/40 portfolios. If the yield holds above 3.5% annualized, expect pension allocators to take their first serious digital asset positions this cycle.",
    sourceUrl: "https://www.sec.gov/news/press-release/2026-staking-approval",
    sourceName: "SEC",
  },
  {
    sector: "finance",
    headline: "JPMorgan launches $25B private credit fund for middle-market borrowers",
    context:
      "JPMorgan Asset Management launched a $25B evergreen private credit vehicle targeting middle-market direct lending, with a 9-11% unlevered target return. The fund will deploy over 18 months and includes a sleeve co-managed with Cliffwater.",
    whyItMatters:
      "Banks are quietly re-entering private credit through fund wrappers rather than balance sheets. For middle-market borrowers, this means marginal loan pricing stays tight even if public credit widens — a structural change from the 2022-2024 pattern.",
    sourceUrl: "https://www.jpmorgan.com/insights/private-credit-fund",
    sourceName: "JPMorgan",
  },
  {
    sector: "finance",
    headline: "Stripe reports $1.8T in 2025 payment volume, confirms 2026 IPO plans",
    context:
      "Stripe disclosed $1.8T in total payment volume for 2025, up 36% YoY, and confirmed it has filed confidentially for an IPO targeting H2 2026. Gross revenue landed at $22B with a 16% operating margin.",
    whyItMatters:
      "If Stripe prices anywhere near its last private round ($70B), it will reset comparables for every remaining late-stage fintech. The more interesting number is the 16% operating margin — it shows payments infra can still scale profitably at $1T+ volume.",
    sourceUrl: "https://stripe.com/newsroom/2025-recap",
    sourceName: "Stripe",
  },
  {
    sector: "finance",
    headline: "Basel IV final capital rules released, US implementation delayed to 2028",
    context:
      "The Basel Committee finalized the last Basel IV amendments, but US regulators announced a phased implementation pushing full compliance to 2028. The EU and UK remain on the 2027 timeline.",
    whyItMatters:
      "US banks now have a 12-month capital arbitrage window against European peers. Expect US G-SIBs to lean into trading book exposures and leveraged lending through 2027 before the rules bind.",
    sourceUrl: "https://www.bis.org/bcbs/publ/basel-iv-final.htm",
    sourceName: "Bank for International Settlements",
  },
  {
    sector: "finance",
    headline: "Apollo closes $30B flagship private equity fund, largest of 2026 so far",
    context:
      "Apollo Global Management closed its tenth flagship buyout fund at $30B, hitting its hard cap. The fundraise took 14 months — roughly half the sector median — helped by reups from Canadian and Gulf sovereigns.",
    whyItMatters:
      "Fundraising is bifurcating: brand-name megafunds are sailing, everyone else is stuck. If you're an LP, the question isn't whether to cut commitments but where to recycle the capital — secondaries continue to be the cleanest expression of that.",
    sourceUrl: "https://www.apollo.com/news/flagship-x-close",
    sourceName: "Apollo",
  },
  {
    sector: "finance",
    headline: "US Treasury auctions $67B in 10-year notes at 3.94%, bid-to-cover hits 2.62x",
    context:
      "The Treasury sold $67B in 10-year notes at a 3.94% yield with a 2.62x bid-to-cover ratio and 18% indirect bidders — the strongest takedown since October. Dealers absorbed only 10%, the lowest share in two years.",
    whyItMatters:
      "Strong indirect participation without meaningful dealer support is the shape of a healthy auction, not a stressed one. For any thesis betting on a Treasury supply indigestion trade, this prints against you.",
    sourceUrl: "https://treasurydirect.gov/auctions/results",
    sourceName: "US Treasury",
  },
  {
    sector: "finance",
    headline: "Sequoia spins out growth arm as standalone $18B Heritage Partners",
    context:
      "Sequoia Capital completed the spin-out of its growth and crossover business into a new firm called Heritage Partners, managing roughly $18B in committed capital. The split formalizes the early/growth separation Sequoia began telegraphing in 2024.",
    whyItMatters:
      "The message to founders: series C+ rounds will now be led by a purpose-built, career-incentivized growth team, not an early partner stretching up. Expect faster decisions and harder-nosed terms on late-stage rounds led by Heritage.",
    sourceUrl: "https://www.sequoiacap.com/article/heritage-partners-spinout",
    sourceName: "Sequoia Capital",
  },
  {
    sector: "finance",
    headline: "China cuts RRR by 50bps, injects estimated ¥1.2T into banking system",
    context:
      "The PBOC cut the reserve requirement ratio for major banks by 50bps, releasing an estimated ¥1.2T in liquidity. The cut was paired with a 10bp MLF rate reduction.",
    whyItMatters:
      "RRR cuts have become mechanical in China; the rate cut is the real signal. A 10bp MLF move tells you Beijing is easing but still rationing — don't read this as the 'big bazooka' some China bulls are reaching for.",
    sourceUrl: "https://www.reuters.com/markets/asia/pboc-rrr-cut",
    sourceName: "Reuters",
  },
  {
    sector: "finance",
    headline: "Visa and Mastercard settle merchant interchange lawsuit for $30B combined",
    context:
      "Visa and Mastercard agreed to a combined $30B settlement resolving two decades of merchant interchange litigation. The deal includes permanent interchange rate caps and lifts merchant surcharge restrictions in 38 states.",
    whyItMatters:
      "Surcharge liberalization is the sleeper story. If even 10% of large merchants start charging card users explicit fees, card-rewards economics break — watch co-brand card portfolios and travel points valuations for follow-on effects.",
    sourceUrl: "https://www.wsj.com/finance/visa-mastercard-settlement",
    sourceName: "Wall Street Journal",
  },
  {
    sector: "finance",
    headline: "Japan's 10-year JGB yield crosses 1.75%, highest since 2009",
    context:
      "The benchmark 10-year JGB yield closed at 1.76% after a weaker-than-expected auction, marking the highest level since 2009. The BOJ declined to intervene and reiterated its commitment to gradual normalization.",
    whyItMatters:
      "A 1.75% JGB changes the math for every yen-funded carry trade. If the BOJ really does let yields drift, expect sustained yen strength and meaningful outflows from US credit funded by Japanese lifers.",
    sourceUrl: "https://www.nikkei.com/article/jgb-10y-1-75",
    sourceName: "Nikkei",
  },
  {
    sector: "finance",
    headline: "Robinhood acquires Bitstamp for $900M, enters European regulated crypto market",
    context:
      "Robinhood completed its $900M acquisition of Bitstamp, gaining a MiCA-regulated European exchange and its institutional custody arm. The combined platform now serves 32M retail customers across the US and EU.",
    whyItMatters:
      "MiCA licenses are hard to get and harder to recreate — Robinhood just bought regulatory ground rather than applying for it. For US-centric crypto platforms, this is the template: acquire, don't apply, if you want to cross into Europe this year.",
    sourceUrl: "https://www.robinhood.com/newsroom/bitstamp-close",
    sourceName: "Robinhood",
  },
  {
    sector: "finance",
    headline: "Moody's downgrades commercial real estate CLO sector to negative",
    context:
      "Moody's revised its outlook for commercial real estate CLOs to negative from stable, citing rising interest-only loan extension rates and softening multifamily rents in sunbelt markets. Eight of 64 rated CRE CLOs were placed on watch.",
    whyItMatters:
      "CRE CLOs were the last piece of structured CRE that rating agencies hadn't formally turned on. Expect forced selling from ratings-constrained holders over the next two quarters, which creates actual entry points for credit funds with dry powder.",
    sourceUrl: "https://www.moodys.com/research/cre-clo-negative-outlook",
    sourceName: "Moody's",
  },
  {
    sector: "finance",
    headline: "Goldman Sachs AI-assisted research cuts equity analyst headcount by 14%",
    context:
      "Goldman Sachs confirmed a 14% reduction in global equity research headcount over the past 12 months, attributing the cut to AI-driven coverage expansion. The firm now covers 1,200 more names with fewer analysts than it did in 2023.",
    whyItMatters:
      "Sell-side research has been the canary for AI-driven white-collar restructuring. The pattern — fewer people, broader coverage, same revenue — is the playbook; expect the same shape to land on M&A support, compliance, and middle-office ops within 18 months.",
    sourceUrl: "https://www.bloomberg.com/news/goldman-research-ai",
    sourceName: "Bloomberg",
  },
];

const semiStories: StoryTemplate[] = [
  {
    sector: "semiconductors",
    headline: "TSMC books $15B in advance payments for 2nm capacity through 2028",
    context:
      "TSMC disclosed $15B in non-refundable prepayments for N2 capacity reservations extending through 2028, with Apple, NVIDIA, and AMD named as contributors. N2 volume production begins in H2 2026 at Fab 20 in Hsinchu.",
    whyItMatters:
      "Prepayments at this scale are a leading indicator of 2027-2028 product roadmaps. The list of who prepaid — and who didn't — tells you more about competitive positioning than any public guidance will.",
    sourceUrl: "https://pr.tsmc.com/n2-capacity-prepay",
    sourceName: "TSMC",
  },
  {
    sector: "semiconductors",
    headline: "ASML's High-NA EUV achieves first production wafer at Intel Foundry",
    context:
      "ASML confirmed Intel Foundry produced its first commercially viable wafer using High-NA EUV on the 18A process node. Defect density at pilot line is reportedly close to parity with standard EUV after 14 months of tuning.",
    whyItMatters:
      "This is the first production-grade High-NA result outside ASML's own test wafers. It validates Intel Foundry's 18A timeline and keeps open the possibility of real competition for TSMC at the leading node — something that mattered more to policy-makers than to TSMC customers until now.",
    sourceUrl: "https://www.asml.com/en/news/press-releases/2026/high-na-intel-18a",
    sourceName: "ASML",
  },
  {
    sector: "semiconductors",
    headline: "NVIDIA's Blackwell Ultra ships in volume, CoWoS-L capacity remains gating",
    context:
      "NVIDIA confirmed Blackwell Ultra is shipping in volume and that Q2 revenue will be capacity-constrained by TSMC's CoWoS-L packaging rather than die supply. TSMC is accelerating a new CoWoS line in Taiwan and qualifying a second site in Arizona.",
    whyItMatters:
      "Advanced packaging is now the binding constraint on AI accelerator supply. Any vendor talking about 'die shortages' is hiding the real bottleneck — watch CoWoS capacity announcements as the actual supply signal.",
    sourceUrl: "https://investor.nvidia.com/news/blackwell-ultra-shipping",
    sourceName: "NVIDIA Investor Relations",
  },
  {
    sector: "semiconductors",
    headline: "Samsung Foundry loses $4.6B GPU contract to TSMC, sources say",
    context:
      "Samsung Foundry lost a major AI accelerator contract valued at approximately $4.6B over three years, with the customer — reported to be a large cloud provider — moving the design to TSMC's N3P. Yield issues on Samsung's SF3 are cited as the principal reason.",
    whyItMatters:
      "Every contract loss of this size makes Samsung's foundry scale economics harder to defend. If Samsung drops another tier-one AI customer this year, expect serious questions about whether the foundry stays part of Samsung Electronics at all.",
    sourceUrl: "https://www.reuters.com/technology/samsung-foundry-loss",
    sourceName: "Reuters",
  },
  {
    sector: "semiconductors",
    headline: "US CHIPS Act disburses final $12B tranche, program reaches full commitment",
    context:
      "Commerce disbursed the remaining $12B of CHIPS Act direct grants, fully committing the $52B program. Intel, TSMC Arizona, and Samsung Taylor received the largest allocations; Micron's second Idaho fab rounded out the final tranche.",
    whyItMatters:
      "Now the pressure is entirely on execution. Over the next three years, expect quiet renegotiations on milestone schedules — the grants are largely conditional on hitting production targets that were set in a very different demand environment.",
    sourceUrl: "https://www.commerce.gov/news/press-releases/chips-act-full-commit",
    sourceName: "US Department of Commerce",
  },
  {
    sector: "semiconductors",
    headline: "Micron ships HBM4 samples to AI customers, qualification expected by Q4",
    context:
      "Micron shipped HBM4 samples to at least four major AI accelerator customers, with product qualification targeted by Q4. Bandwidth is rated at 1.6TB/s per stack, 33% above HBM3e; power draw is essentially flat.",
    whyItMatters:
      "Memory has been the hidden tax on AI training TCO. If HBM4 ships to spec, expect a generation of 2027 accelerators to quietly exceed their nameplate training throughput by 25-40% — not from compute improvements, but from memory.",
    sourceUrl: "https://investors.micron.com/hbm4-samples",
    sourceName: "Micron",
  },
  {
    sector: "semiconductors",
    headline: "Arm announces v10 architecture with native AI accelerator ISA extensions",
    context:
      "Arm unveiled its v10 architecture, adding ISA extensions for sparse matrix operations and 4-bit/8-bit mixed-precision arithmetic. First licensee silicon is expected in 2027; Arm disclosed that all top-10 licensees have signed on.",
    whyItMatters:
      "Arm moving AI primitives into the base ISA — not just extensions — means the line between CPU and accelerator blurs at the edge. Expect NPU-on-die to become table stakes for any chip shipping into phones or laptops from 2027 on.",
    sourceUrl: "https://www.arm.com/company/news/v10-architecture",
    sourceName: "Arm",
  },
  {
    sector: "semiconductors",
    headline: "Dutch government expands ASML export restrictions to cover older DUV tools",
    context:
      "The Netherlands expanded its semiconductor equipment export restrictions to include ASML's TWINSCAN NXT:2000i — a previous-generation DUV tool that remains critical for mature-node logic. China is the de facto target.",
    whyItMatters:
      "Mature-node restrictions bite harder than leading-edge ones for Chinese fabs, because that's where actual volume runs. Expect SMIC's automotive and power-management wafer starts to get squeezed first.",
    sourceUrl: "https://www.rijksoverheid.nl/documenten/export-duv-expansion",
    sourceName: "Government of the Netherlands",
  },
  {
    sector: "semiconductors",
    headline: "Rapidus Japan delays 2nm pilot to H2 2027, cites EUV training timeline",
    context:
      "Japan's Rapidus pushed its 2nm pilot production from Q1 to H2 2027, citing longer-than-expected EUV operator training and vendor qualification timelines. The program remains fully funded through 2028.",
    whyItMatters:
      "Rapidus delaying is the expected outcome, not the surprising one. The real question is whether Japan's broader foundry ambition survives IBM-dependent tech transfer; a second slip next year would be much harder to explain away.",
    sourceUrl: "https://www.rapidus.inc/news/2nm-pilot-schedule",
    sourceName: "Rapidus",
  },
  {
    sector: "semiconductors",
    headline: "Cadence acquires packaging design startup SemiTron for $1.9B",
    context:
      "Cadence Design Systems acquired SemiTron, a startup focused on 2.5D/3D advanced packaging design tooling, for $1.9B. SemiTron's technology supports interposer and bridge-based chiplet workflows.",
    whyItMatters:
      "EDA vendors are paying up for packaging-native tooling because the industry is converging on chiplet-based designs faster than anyone planned for. Expect Synopsys to respond with an equivalent acquisition within two quarters.",
    sourceUrl: "https://www.cadence.com/en_US/home/company/newsroom/semitron-acquisition",
    sourceName: "Cadence",
  },
  {
    sector: "semiconductors",
    headline: "Intel's 18A yields reach 60% at pilot production, on track for volume ramp",
    context:
      "Intel disclosed 18A is yielding approximately 60% at pilot production, up from 40% six months ago. CEO Pat Gelsinger reiterated that Panther Lake volume production remains on schedule for H2 2026.",
    whyItMatters:
      "60% at pilot is inside the range where Intel can make the planned Panther Lake ramp without losing margin dollars. If yields hold, Intel actually comes out of 2026 with a credible leading-node story for the first time in five years.",
    sourceUrl: "https://newsroom.intel.com/news/18a-yield-update",
    sourceName: "Intel",
  },
  {
    sector: "semiconductors",
    headline: "SK Hynix posts record quarterly revenue on HBM demand, margin hits 42%",
    context:
      "SK Hynix reported record quarterly revenue of ₩24.3T with operating margin of 42%, driven by HBM3e shipments to NVIDIA and AMD. HBM now represents 48% of total DRAM revenue.",
    whyItMatters:
      "Memory has flipped from commodity to specialty economics this cycle. The 42% margin is what you get when supply is fully allocated to a handful of customers on multi-year contracts — it's not sustainable at full DRAM scope, but it's the new baseline for HBM.",
    sourceUrl: "https://www.skhynix.com/news/earnings-q1-2026",
    sourceName: "SK Hynix",
  },
  {
    sector: "semiconductors",
    headline: "TSMC Arizona Fab 21 begins N4 volume production, 2 years late",
    context:
      "TSMC's Arizona Fab 21 started volume production on N4, initially focused on Apple and AMD client chips. The ramp is two years behind the original schedule; TSMC cited labor and permitting as the main factors.",
    whyItMatters:
      "Arizona producing anything meaningful is the point — not which node. It sets a precedent that US-based leading-edge logic is possible, which lowers the perceived political risk of the broader reshoring thesis even if the economics remain tougher than Taiwan.",
    sourceUrl: "https://pr.tsmc.com/arizona-fab21-volume",
    sourceName: "TSMC",
  },
  {
    sector: "semiconductors",
    headline: "Marvell wins $3.2B custom silicon contract with major cloud provider",
    context:
      "Marvell announced a $3.2B multi-year custom silicon design win with a large cloud provider, believed to be Microsoft, covering networking and AI inference accelerators. Production begins in 2027.",
    whyItMatters:
      "Custom silicon is draining the addressable market for merchant accelerators faster than the TAM is growing. For any company pitching 'we'll beat NVIDIA on inference,' the real competition is hyperscalers deciding to build their own rather than buy anything merchant.",
    sourceUrl: "https://www.marvell.com/company/newsroom/custom-silicon-win",
    sourceName: "Marvell",
  },
  {
    sector: "semiconductors",
    headline: "Applied Materials and Tokyo Electron form lithography-adjacent joint R&D venture",
    context:
      "Applied Materials and Tokyo Electron announced a joint R&D venture focused on deposition and etch processes for High-NA EUV nodes. The venture is headquartered in Albany, NY and will employ ~400 engineers at startup.",
    whyItMatters:
      "This is how the non-ASML equipment makers respond to High-NA: pool R&D and standardize around ASML's tool rather than fight each pattern independently. Expect faster process recipe releases for High-NA nodes — good for whoever is fabbing on it first.",
    sourceUrl: "https://www.appliedmaterials.com/company/news/press-releases/jv-tel",
    sourceName: "Applied Materials",
  },
  {
    sector: "semiconductors",
    headline: "India's first commercial fab breaks ground in Dholera, targeting 28nm by 2028",
    context:
      "Tata Electronics and PSMC broke ground on India's first commercial semiconductor fab in Dholera, Gujarat. The fab targets 28/40nm automotive and industrial chips starting 2028, with a $11B total investment and $5.5B central government subsidy.",
    whyItMatters:
      "28nm is what most auto and industrial SoCs actually use — not the leading edge. If India executes, it slots into the global supply chain at exactly the node range where Chinese expansion is most politically constrained. The country-risk math for 5-year auto platforms just improved.",
    sourceUrl: "https://www.tataelectronics.com/news/dholera-groundbreaking",
    sourceName: "Tata Electronics",
  },
];

// ---------- Date scatter ----------

function withinLast30Days(): Date {
  const now = Date.now();
  const offsetMs = Math.floor(rand() * 30 * 24 * 60 * 60 * 1000);
  return new Date(now - offsetMs);
}

// ---------- Seed runner ----------

async function seed(): Promise<void> {
  console.log("[seed] starting…");

  // Wipe in FK-safe order (dev-only).
  console.log("[seed] clearing existing data");
  await db.delete(schema.userSaves);
  await db.delete(schema.comments);
  await db.delete(schema.stories);
  await db.delete(schema.writers);

  // Writers
  console.log("[seed] inserting 3 writers");
  const insertedWriters = await db.insert(schema.writers).values(writerSeeds).returning();
  const writerBySector = new Map<string, (typeof insertedWriters)[number]>();
  for (const w of insertedWriters) {
    const s = (w.sectors?.[0] ?? "ai") as string;
    writerBySector.set(s, w);
  }

  // Stories: 50 total, ~17/17/16 by sector
  const templates: StoryTemplate[] = [];
  templates.push(...aiStories.slice(0, 17));
  templates.push(...financeStories.slice(0, 17));
  templates.push(...semiStories.slice(0, 16));

  // If any pool ran short, cycle within sector to reach target counts.
  while (templates.length < 50) {
    templates.push(pick(aiStories));
  }

  console.log(`[seed] inserting ${templates.length} stories`);
  const storiesToInsert: Array<typeof schema.stories.$inferInsert> = templates.map((t) => {
    const publishedAt = withinLast30Days();
    return {
      sector: t.sector,
      headline: t.headline,
      context: t.context,
      whyItMatters: t.whyItMatters,
      whyItMattersTemplate: null,
      sourceUrl: t.sourceUrl,
      sourceName: t.sourceName,
      authorId: writerBySector.get(t.sector)?.id ?? null,
      publishedAt,
    };
  });

  await db.insert(schema.stories).values(storiesToInsert);

  const writerCountRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.writers);
  const storyCountRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.stories);

  console.log(
    `[seed] done. writers=${writerCountRows[0]?.count ?? 0} stories=${storyCountRows[0]?.count ?? 0}`,
  );
}

seed()
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
