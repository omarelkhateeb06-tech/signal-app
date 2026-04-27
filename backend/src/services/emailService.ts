import sgMail from "@sendgrid/mail";

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  categories?: string[];
}

export interface EmailSendResult {
  delivered: boolean;
  provider: "sendgrid" | "console";
}

let sendgridInitialized = false;
let warnedMissing = false;

function getSendgridKey(): string | null {
  const key = process.env.SENDGRID_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function getSenderEmail(): string {
  return process.env.SENDER_EMAIL?.trim() || "noreply@signal.so";
}

export function isEmailConfigured(): boolean {
  return getSendgridKey() !== null;
}

function ensureSendgrid(): boolean {
  const key = getSendgridKey();
  if (!key) return false;
  if (!sendgridInitialized) {
    sgMail.setApiKey(key);
    sendgridInitialized = true;
  }
  return true;
}

export async function sendEmail(payload: EmailPayload): Promise<EmailSendResult> {
  const ready = ensureSendgrid();
  if (!ready) {
    if (!warnedMissing) {
      // eslint-disable-next-line no-console
      console.warn(
        "[signal-backend] SENDGRID_API_KEY not set — emails will be logged to console only",
      );
      warnedMissing = true;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[signal-backend] [email:console] to=${payload.to} subject=${JSON.stringify(payload.subject)}`,
    );
    return { delivered: false, provider: "console" };
  }

  await sgMail.send({
    to: payload.to,
    from: getSenderEmail(),
    subject: payload.subject,
    html: payload.html,
    text: payload.text ?? stripHtml(payload.html),
    categories: payload.categories,
  });
  return { delivered: true, provider: "sendgrid" };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
