import sgMail from "@sendgrid/mail";
import { sendEmail, isEmailConfigured, getSenderEmail } from "../src/services/emailService";

jest.mock("@sendgrid/mail", () => ({
  __esModule: true,
  default: {
    setApiKey: jest.fn(),
    send: jest.fn(),
  },
}));

const sgSend = (sgMail as unknown as { send: jest.Mock }).send;
const sgSetApiKey = (sgMail as unknown as { setApiKey: jest.Mock }).setApiKey;

describe("emailService", () => {
  const originalKey = process.env.SENDGRID_API_KEY;
  const originalSender = process.env.SENDER_EMAIL;
  let consoleLog: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    sgSend.mockReset();
    sgSetApiKey.mockReset();
    consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.SENDGRID_API_KEY = originalKey;
    process.env.SENDER_EMAIL = originalSender;
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
  });

  it("falls back to console when SENDGRID_API_KEY is missing", async () => {
    delete process.env.SENDGRID_API_KEY;
    const result = await sendEmail({
      to: "u@example.com",
      subject: "Hi",
      html: "<p>Hi</p>",
    });
    expect(result.provider).toBe("console");
    expect(result.delivered).toBe(false);
    expect(sgSend).not.toHaveBeenCalled();
    expect(isEmailConfigured()).toBe(false);
  });

  it("delivers via SendGrid when key is set", async () => {
    process.env.SENDGRID_API_KEY = "SG.test-key";
    process.env.SENDER_EMAIL = "noreply@signal.so";
    sgSend.mockResolvedValue([{ statusCode: 202 }, {}]);

    const result = await sendEmail({
      to: "u@example.com",
      subject: "Welcome",
      html: "<p>Hi <b>there</b></p>",
    });

    expect(sgSetApiKey).toHaveBeenCalledWith("SG.test-key");
    expect(sgSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "u@example.com",
        from: "noreply@signal.so",
        subject: "Welcome",
        html: "<p>Hi <b>there</b></p>",
      }),
    );
    expect(result).toEqual({ delivered: true, provider: "sendgrid" });
  });

  it("auto-generates a text body when not provided", async () => {
    process.env.SENDGRID_API_KEY = "SG.test-key";
    sgSend.mockResolvedValue([{ statusCode: 202 }, {}]);
    await sendEmail({ to: "u@e.com", subject: "s", html: "<p>Hi <em>there</em></p>" });
    const args = sgSend.mock.calls[0][0];
    expect(args.text).toContain("Hi");
    expect(args.text).not.toContain("<em>");
  });

  it("getSenderEmail returns configured value or default", () => {
    process.env.SENDER_EMAIL = "custom@signal.so";
    expect(getSenderEmail()).toBe("custom@signal.so");
    delete process.env.SENDER_EMAIL;
    expect(getSenderEmail()).toBe("noreply@signal.so");
  });
});
