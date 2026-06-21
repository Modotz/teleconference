/**
 * Tiny email helper. Uses SMTP via nodemailer when configured, otherwise logs
 * the message (incl. action links) to the console so flows are testable in dev.
 */

export function appUrl() {
  const o = process.env.APP_URL;
  if (o) return o.replace(/\/+$/, '');
  return 'http://localhost:3000';
}

export async function sendMail({ to, subject, html, text }) {
  const host = process.env.SMTP_HOST;

  if (!host) {
    // Dev fallback — no SMTP configured.
    console.log('\n📧 [DEV email — SMTP not configured]');
    console.log('  To:     ', to);
    console.log('  Subject:', subject);
    console.log('  Body:   ', text || html);
    console.log('');
    return;
  }

  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    text,
  });
}
