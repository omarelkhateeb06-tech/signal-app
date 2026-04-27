# Feed fixtures

Real-world RSS/Atom XML fetched 2026-04-27 (UTC) for unit testing the
ingestion adapter. These are exact bytes returned by the upstream
servers — no pretty-printing, no editing — except where truncation is
explicitly documented at the top of the file.

| file | source URL | items | size | notes |
|---|---|---|---|---|
| `import-ai.xml` | https://importai.substack.com/feed | 20 | ~430 KB | full feed |
| `semianalysis.xml` | https://newsletter.semianalysis.com/feed | 5 (of 20) | ~1.1 MB | truncated to first 5 items; original ~4.7 MB |
| `cnbc-markets.xml` | https://www.cnbc.com/id/15839135/device/rss/rss.html | 30 | ~20 KB | full feed; channel title is "Earnings" (registry mislabel — separate PR) |

These fixtures drift over time as feeds publish new items. Refresh with
the same User-Agent (`SIGNAL/12e.2 (+contact@signal.so)`) if tests
start failing for content-shape reasons. Tests should not depend on
specific item titles or URLs — assert on structural shape only.

User-Agent used at fetch:
`SIGNAL/12e.2 (+contact@signal.so)`
