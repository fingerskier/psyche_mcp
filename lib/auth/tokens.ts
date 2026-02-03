import { eq, and, or, isNull, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { authTokens } from "@/lib/db/schema";

/**
 * Hash a raw bearer token using SHA-256.
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a cryptographically secure random token.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a bearer token. Returns the token row if valid, null otherwise.
 * Also updates last_used_at.
 */
export async function verifyToken(rawToken: string) {
  const db = getDb();
  const hash = await hashToken(rawToken);
  const now = new Date();

  const [token] = await db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hash),
        or(isNull(authTokens.expiresAt), gt(authTokens.expiresAt, now))
      )
    )
    .limit(1);

  if (!token) return null;

  // Update last_used_at
  await db
    .update(authTokens)
    .set({ lastUsedAt: now })
    .where(eq(authTokens.id, token.id));

  return token;
}
