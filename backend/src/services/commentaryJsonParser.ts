// Phase 12d — strict parse of Haiku JSON commentary output.
//
// Pure module. Input is the raw assembled model text (the prefill
// prepended by the service layer if used); output is a discriminated
// union — either the validated `{thesis, support}` shape or a typed
// failure reason the caller can route into the Tier-3 anomaly log
// without re-deriving "what went wrong".
//
// Parse stages, in order:
//   1. Optional fence-strip — if the model wrapped its JSON in
//      ```json ... ``` despite the prompt forbidding it, peel before
//      JSON.parse so the second-pass retry doesn't have to.
//   2. JSON.parse — any throw becomes `reason: "json_parse"`.
//   3. Shape check — both fields present, both string-typed, both
//      non-empty after trim. Anything else is `reason: "json_shape"`
//      (with `missingFields` populated for the log line).

export type ParseFailureReason = "json_parse" | "json_shape";

export interface ParsedCommentary {
  thesis: string;
  support: string;
}

export type CommentaryParseResult =
  | { ok: true; value: ParsedCommentary }
  | {
      ok: false;
      reason: ParseFailureReason;
      // Populated for json_shape; lists field names that failed the
      // non-empty-string check. Empty for json_parse failures.
      missingFields?: readonly ("thesis" | "support")[];
      // Truncated raw input echoed into the log line so an operator
      // can distinguish "model emitted prose" from "model emitted JSON
      // but with the wrong keys" without re-running the request.
      rawSample?: string;
    };

const RAW_SAMPLE_MAX = 200;

function rawSample(text: string): string {
  if (text.length <= RAW_SAMPLE_MAX) return text;
  return text.slice(0, RAW_SAMPLE_MAX) + "…";
}

// Belt-and-braces fence stripper. The prompt and the assistant prefill
// already push the model toward bare JSON, but if a tail case slips a
// ```json fence past both, this peels it before JSON.parse.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  // ```json ... ``` or ``` ... ```
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced) return fenced[1]!.trim();
  return trimmed;
}

export function parseCommentaryJson(text: string): CommentaryParseResult {
  const candidate = stripCodeFence(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { ok: false, reason: "json_parse", rawSample: rawSample(text) };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: "json_shape",
      missingFields: ["thesis", "support"],
      rawSample: rawSample(text),
    };
  }

  const obj = parsed as Record<string, unknown>;
  const thesisRaw = obj.thesis;
  const supportRaw = obj.support;

  const missing: ("thesis" | "support")[] = [];
  if (typeof thesisRaw !== "string" || thesisRaw.trim() === "") {
    missing.push("thesis");
  }
  if (typeof supportRaw !== "string" || supportRaw.trim() === "") {
    missing.push("support");
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "json_shape",
      missingFields: missing,
      rawSample: rawSample(text),
    };
  }

  return {
    ok: true,
    value: {
      thesis: (thesisRaw as string).trim(),
      support: (supportRaw as string).trim(),
    },
  };
}
