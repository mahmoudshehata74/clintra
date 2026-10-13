import { describe, expect, it } from "vitest";
import { MessageChannel } from "../db/types";
import { buildMessageLink } from "./messageLink";

describe("buildMessageLink", () => {
  it.each<[string, MessageChannel, string, string, string]>([
    ["WhatsApp, plain text", MessageChannel.WhatsApp, "+201001234567", "hello", "https://wa.me/201001234567?text=hello"],
    ["SMS, plain text", MessageChannel.Sms, "+201001234567", "hello", "sms:+201001234567?body=hello"],
    [
      "Arabic",
      MessageChannel.WhatsApp,
      "+201001234567",
      "مرحباً",
      "https://wa.me/201001234567?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%D9%8B",
    ],
    ["a newline", MessageChannel.Sms, "+201001234567", "a\nb", "sms:+201001234567?body=a%0Ab"],
    ["an emoji", MessageChannel.WhatsApp, "+201001234567", "📅", "https://wa.me/201001234567?text=%F0%9F%93%85"],
    ["an ampersand", MessageChannel.WhatsApp, "+201001234567", "a&b=c", "https://wa.me/201001234567?text=a%26b%3Dc"],
    ["a hash", MessageChannel.Sms, "+201001234567", "#5", "sms:+201001234567?body=%235"],
    ["a plus", MessageChannel.WhatsApp, "+201001234567", "1+1", "https://wa.me/201001234567?text=1%2B1"],
    ["spaces", MessageChannel.Sms, "+201001234567", "a b", "sms:+201001234567?body=a%20b"],
    ["an empty body", MessageChannel.WhatsApp, "+201001234567", "", "https://wa.me/201001234567?text="],
    ["a landline", MessageChannel.Sms, "+20221234567", "x", "sms:+20221234567?body=x"],
  ])("%s", (_label, channel, phone, body, expected) => {
    expect(buildMessageLink(channel, phone, body)).toBe(expected);
  });

  it("round-trips a whole message through the link's query", () => {
    const body = "مرحباً كريم،\n📅 الأحد · 10:30\nاتصل: 02 2123 4567 & #2 + 👨‍⚕️";
    for (const [channel, param] of [
      [MessageChannel.WhatsApp, "text"],
      [MessageChannel.Sms, "body"],
    ] as const) {
      const link = buildMessageLink(channel, "+201001234567", body);
      const query = link.slice(link.indexOf("?") + 1);
      expect(new URLSearchParams(query.replace(/\+/g, "%2B")).get(param)).toBe(body);
      expect(link.split("?")).toHaveLength(2);
      expect(link).not.toContain("#");
      expect(link).not.toContain("&");
      expect(link).not.toMatch(/\s/);
    }
  });

  it.each(["01001234567", "201001234567", "+0123456789", "+2010", "", "+20 100 123 4567"])(
    "refuses %j, which is not E.164",
    (phone) => {
      expect(() => buildMessageLink(MessageChannel.WhatsApp, phone, "x")).toThrow("invalid_phone");
    },
  );
});
