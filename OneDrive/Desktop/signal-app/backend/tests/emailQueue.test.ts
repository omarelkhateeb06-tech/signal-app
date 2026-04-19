const sendEmailMock = jest.fn();
jest.mock("../src/services/emailService", () => ({
  __esModule: true,
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

jest.mock("../src/lib/redis", () => ({
  __esModule: true,
  getRedis: () => null,
  isRedisConfigured: () => false,
  getRedisUrl: () => null,
  closeRedis: async () => undefined,
}));

import { enqueueEmail, getEmailQueue } from "../src/jobs/emailQueue";

describe("emailQueue graceful degradation", () => {
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue({ delivered: false, provider: "console" });
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
  });

  it("getEmailQueue returns null when Redis is not configured", () => {
    expect(getEmailQueue()).toBeNull();
  });

  it("enqueueEmail sends synchronously without Redis", async () => {
    const result = await enqueueEmail({
      type: "welcome",
      payload: { to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" },
    });
    expect(result.queued).toBe(false);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@b.com", subject: "Hi" }),
    );
  });
});
