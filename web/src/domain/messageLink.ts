import { MessageChannel } from "../db/types";

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * The link that opens a message, ready to send, in WhatsApp or the SMS app
 * (docs/schema.md's v19 additions — there is no provider):
 * - WhatsApp: `https://wa.me/<E.164 digits without +>?text=<encoded body>`
 * - SMS: `sms:<E.164>?body=<encoded body>`
 *
 * The body is percent-encoded whole (encodeURIComponent), so Arabic, newlines,
 * emoji and the characters a URL would otherwise read as structure ("&", "#",
 * "+") all arrive as written. Throws `invalid_phone` for a number that is not
 * E.164 — the callers pass the patient's stored, normalised number.
 */
export function buildMessageLink(channel: MessageChannel, phone: string, body: string): string {
  if (!E164.test(phone)) {
    throw new Error("invalid_phone");
  }
  const encoded = encodeURIComponent(body);
  return channel === MessageChannel.WhatsApp
    ? `https://wa.me/${phone.slice(1)}?text=${encoded}`
    : `sms:${phone}?body=${encoded}`;
}
