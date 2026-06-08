/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // Phase 12e.x fix cluster — Fix 5. jsdom pulls in `@exodus/bytes`
    // transitively through html-encoding-sniffer. That package ships
    // ESM-only (`export {…}` in a .js file with no CJS entry) and
    // Jest's default transformIgnorePatterns leaves it unparseable in
    // the CJS test environment. The transitive use inside jsdom is
    // limited to UTF byte-detection during HTML parsing; for the
    // ingestion tests that pull jsdom transitively
    // (htmlStrip/bodyExtractor/heuristicSeam/rssAdapter), we don't
    // depend on byte-level encoding detection — UTF-8 is the only
    // path the test fixtures exercise. Stubbing the module with an
    // empty CJS object is sufficient to unblock parsing.
    "^@exodus/bytes/?(.*)$": "<rootDir>/tests/__mocks__/exodus-bytes-stub.js",
  },
  setupFiles: ["<rootDir>/tests/setup.ts"],
  clearMocks: true,
  // Issue #81 — BullMQ/ioredis keep their Redis sockets open past the last
  // test, so Jest prints "A worker process has failed to exit gracefully" and
  // hangs on the open handles. The leak is known + benign (queue/worker
  // connections in the ingestion suites); force-exit once all suites pass
  // rather than thread afterAll teardown through every BullMQ-touching test.
  forceExit: true,
};
