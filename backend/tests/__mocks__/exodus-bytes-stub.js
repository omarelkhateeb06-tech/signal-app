// Phase 12e.x fix cluster — stub for @exodus/bytes used by jsdom's
// html-encoding-sniffer in CJS test contexts. The real package ships
// ESM-only and trips Jest's default transformIgnorePatterns. The
// ingestion tests that import jsdom transitively don't depend on
// the byte-level encoding-detection logic — every fixture is UTF-8.
// Returning permissive defaults from the encoding helpers is enough
// to let html-encoding-sniffer hand back the encoding name jsdom
// expects.

"use strict";

// `encoding-lite` is the file Jest tripped on. Its exports are
// `getEncoding`, `decode`, plus various typed-array helpers. The CJS
// shape used by html-encoding-sniffer reads only `getEncoding`.
function noop() {
  return null;
}

module.exports = {
  // html-encoding-sniffer pattern: call getEncoding('label') and
  // expect either an Encoding object or null. Null tells the sniffer
  // to fall back to its default ("utf-8"), which is what every
  // ingestion-test fixture actually is.
  getEncoding: noop,
  decode: (buf) => (Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf)),
  // Pass-through for any other named imports — the empty default
  // covers `import * as bytes from '@exodus/bytes'` patterns.
  default: {},
};
