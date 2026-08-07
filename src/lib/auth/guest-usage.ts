import { createHmac, timingSafeEqual } from "node:crypto";

export const GUEST_MESSAGE_LIMIT = 10;
export const GUEST_USAGE_COOKIE = "bmai_guest_usage";

function usageSecret(): string {
  const secret = process.env.ANON_USAGE_SECRET ?? process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Guest usage signing is not configured.");
  return secret;
}

function signature(count: number): string {
  return createHmac("sha256", usageSecret())
    .update(`bmai:${count}`)
    .digest("base64url");
}

export function encodeGuestUsage(count: number): string {
  const safeCount = Math.max(0, Math.min(GUEST_MESSAGE_LIMIT, Math.floor(count)));
  return `${safeCount}.${signature(safeCount)}`;
}

export function decodeGuestUsage(value: string | undefined): number {
  if (!value) return 0;
  const [rawCount, rawSignature] = value.split(".");
  const count = Number(rawCount);
  if (!Number.isInteger(count) || count < 0 || count > GUEST_MESSAGE_LIMIT || !rawSignature) {
    return 0;
  }
  const expected = Buffer.from(signature(count));
  const received = Buffer.from(rawSignature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return 0;
  return count;
}

export function remainingGuestMessages(used: number): number {
  return Math.max(0, GUEST_MESSAGE_LIMIT - used);
}

