import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "./index";

async function verify(): Promise<void> {
  const tablesRes = await db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);
  console.log("=== tables ===");
  for (const row of tablesRes.rows) console.log(" -", row.table_name);

  const countsRes = await db.execute<{
    writers: string;
    stories: string;
    users: string;
    ai: string;
    finance: string;
    semi: string;
    with_author: string;
    orphan_authors: string;
  }>(sql`
    select
      (select count(*) from writers)::text                                            as writers,
      (select count(*) from stories)::text                                            as stories,
      (select count(*) from users)::text                                              as users,
      (select count(*) from stories where sector = 'ai')::text                        as ai,
      (select count(*) from stories where sector = 'finance')::text                   as finance,
      (select count(*) from stories where sector = 'semiconductors')::text            as semi,
      (select count(*) from stories where author_id is not null)::text                as with_author,
      (select count(*) from stories s
         left join writers w on w.id = s.author_id
         where s.author_id is not null and w.id is null)::text                        as orphan_authors
  `);
  const c = countsRes.rows[0];
  console.log("=== counts ===");
  console.log(c);

  const sampleRes = await db.execute<{
    sector: string;
    headline: string;
    writer: string;
    published_at: string;
  }>(sql`
    select s.sector, s.headline, w.name as writer, to_char(s.published_at, 'YYYY-MM-DD') as published_at
    from stories s
    left join writers w on w.id = s.author_id
    order by s.sector, s.published_at desc
    limit 9
  `);
  console.log("=== sample stories (3 per sector) ===");
  for (const row of sampleRes.rows) {
    console.log(` [${row.sector.padEnd(14)}] ${row.published_at} | by ${row.writer ?? "(none)"}`);
    console.log(`   ${row.headline}`);
  }

  const dateRangeRes = await db.execute<{ min: string; max: string }>(sql`
    select to_char(min(published_at), 'YYYY-MM-DD') as min,
           to_char(max(published_at), 'YYYY-MM-DD') as max
    from stories
  `);
  console.log("=== published_at range ===", dateRangeRes.rows[0]);
}

verify()
  .catch((err) => {
    console.error("[verify] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
