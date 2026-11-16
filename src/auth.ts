// Single-reader sign-in. The passphrase lives in the ADMIN_TOKEN secret
// (`wrangler secret put ADMIN_TOKEN`). Signing in sets a long-lived HttpOnly
// cookie holding an HMAC of a fixed label, so changing the secret signs out
// every browser. Reading the site needs no sign-in; marking stories does.

import type { Env } from "./index";

const COOKIE = "sid";
const enc = new TextEncoder();

async function sessionValue(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("tseku-news session v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function equal(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export async function isSignedIn(req: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const got = cookie(req, COOKIE);
  return !!got && equal(got, await sessionValue(env.ADMIN_TOKEN));
}

// Returns the Set-Cookie header for a correct passphrase, or null.
export async function signIn(passphrase: string, env: Env): Promise<string | null> {
  if (!env.ADMIN_TOKEN || !equal(passphrase, env.ADMIN_TOKEN)) return null;
  return `${COOKIE}=${await sessionValue(env.ADMIN_TOKEN)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}

export const signOutCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// Writes must come from the site itself.
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !!origin && origin === new URL(req.url).origin;
}
