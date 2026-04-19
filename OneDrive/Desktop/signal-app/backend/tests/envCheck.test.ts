import {
  checkRequiredEnv,
  reportMissingEnv,
  type RequiredEnvVar,
} from "../src/lib/envCheck";

const sample: RequiredEnvVar[] = [
  { name: "FAKE_API_KEY", description: "fake thing" },
  { name: "FAKE_SECRET", description: "another fake" },
];

describe("envCheck", () => {
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
  });

  it("returns no missing vars outside of production", () => {
    const result = checkRequiredEnv(sample, { NODE_ENV: "development" });
    expect(result.ranInProduction).toBe(false);
    expect(result.missing).toEqual([]);
  });

  it("flags every unset var in production", () => {
    const result = checkRequiredEnv(sample, { NODE_ENV: "production" });
    expect(result.ranInProduction).toBe(true);
    expect(result.missing.map((v) => v.name)).toEqual([
      "FAKE_API_KEY",
      "FAKE_SECRET",
    ]);
  });

  it("treats empty and whitespace-only values as missing in production", () => {
    const result = checkRequiredEnv(sample, {
      NODE_ENV: "production",
      FAKE_API_KEY: "",
      FAKE_SECRET: "   ",
    });
    expect(result.missing.map((v) => v.name)).toEqual([
      "FAKE_API_KEY",
      "FAKE_SECRET",
    ]);
  });

  it("treats populated values as present in production", () => {
    const result = checkRequiredEnv(sample, {
      NODE_ENV: "production",
      FAKE_API_KEY: "sg.key",
      FAKE_SECRET: "shh",
    });
    expect(result.missing).toEqual([]);
  });

  it("reportMissingEnv logs a WARN block only when production and missing", () => {
    reportMissingEnv({ ranInProduction: false, missing: sample });
    expect(consoleWarn).not.toHaveBeenCalled();

    reportMissingEnv({ ranInProduction: true, missing: [] });
    expect(consoleWarn).not.toHaveBeenCalled();

    reportMissingEnv({ ranInProduction: true, missing: sample });
    const joined = consoleWarn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(joined).toContain("WARN: missing required env var(s) in production");
    expect(joined).toContain("FAKE_API_KEY");
    expect(joined).toContain("FAKE_SECRET");
    expect(joined).toContain("fake thing");
  });
});
