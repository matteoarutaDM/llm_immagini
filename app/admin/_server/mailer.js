import "server-only";
import nodemailer from "nodemailer";

import { config } from "./config";
import { DomainError } from "./http";
import { singleton } from "./memory";

/**
 * Email delivery for the backoffice, configured with the same SMTP_* variables
 * as the FastAPI backend (backend/email_service.py). Mirrors its development
 * fallback: without SMTP_HOST and with DEBUG_EMAIL_TOKENS=true the message is
 * logged instead of sent (never allowed in production).
 */

const smtpHost = () => (process.env.SMTP_HOST ?? "").trim();
const debugTokens = () => (process.env.DEBUG_EMAIL_TOKENS ?? "false").trim().toLowerCase() === "true";

const transport = () =>
  singleton("smtp-transport", () => {
    const port = Number(process.env.SMTP_PORT ?? 587);
    return nodemailer.createTransport({
      host: smtpHost(),
      port,
      secure: port === 465,
      requireTLS: (process.env.SMTP_USE_TLS ?? "true").toLowerCase() === "true" && port !== 465,
      auth: process.env.SMTP_USERNAME ? { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD ?? "" } : undefined,
    });
  });

export async function sendEmail({ to, subject, text, debugSummary }) {
  if (!smtpHost()) {
    if (debugTokens() && !config.isProduction) {
      console.info(`[backoffice] DEBUG_EMAIL_TOKENS, SMTP non configurato: ${debugSummary}`);
      return;
    }
    throw new DomainError(503, "EMAIL_UNAVAILABLE", "Invio email non configurato: impossibile spedire il codice.");
  }
  const fromName = process.env.SMTP_FROM_NAME ?? "Assistente Macchine";
  const fromEmail = process.env.SMTP_FROM_EMAIL ?? "no-reply@assistente-macchine.local";
  try {
    await transport().sendMail({ from: `"${fromName}" <${fromEmail}>`, to, subject, text });
  } catch (error) {
    console.error("[backoffice] invio email fallito", error);
    throw new DomainError(503, "EMAIL_FAILED", "Invio del codice non riuscito. Riprova tra poco.");
  }
}
