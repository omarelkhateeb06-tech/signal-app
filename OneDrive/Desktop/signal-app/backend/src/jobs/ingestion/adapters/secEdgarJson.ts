// SEC EDGAR JSON adapter — stub. Implementation lands in 12e.5d
// (business-hours-aware cadence: every 15 min 9-5 ET, hourly off-hours;
// CIK-filtered for the semis-tagged subset and unfiltered for the full
// feed).

import type { AdapterContext, AdapterResult } from "../types";

export async function secEdgarJsonAdapter(_ctx: AdapterContext): Promise<AdapterResult> {
  throw new Error("sec_edgar_json adapter not yet implemented (Phase 12e.5d)");
}
