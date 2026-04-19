export interface LayoutOptions {
  title: string;
  previewText?: string;
  bodyHtml: string;
  unsubscribeUrl?: string;
  frontendUrl: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderLayout(opts: LayoutOptions): string {
  const preview = opts.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(opts.previewText)}</div>`
    : "";
  const footer = opts.unsubscribeUrl
    ? `<p style="margin-top:24px;font-size:12px;color:#64748b;">
         You're receiving this because you signed up for SIGNAL.
         <a href="${opts.unsubscribeUrl}" style="color:#64748b;text-decoration:underline;">Unsubscribe</a>
         or manage preferences in <a href="${opts.frontendUrl}/settings" style="color:#64748b;text-decoration:underline;">settings</a>.
       </p>`
    : `<p style="margin-top:24px;font-size:12px;color:#64748b;">
         Manage preferences in <a href="${opts.frontendUrl}/settings" style="color:#64748b;text-decoration:underline;">settings</a>.
       </p>`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(opts.title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
    ${preview}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,0.04);">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
                <a href="${opts.frontendUrl}" style="text-decoration:none;color:#0f172a;font-weight:700;letter-spacing:0.08em;font-size:16px;">SIGNAL</a>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${opts.bodyHtml}
                ${footer}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
