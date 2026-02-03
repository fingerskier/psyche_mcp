import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getDb } from "@/lib/db";
import { authTokens, users } from "@/lib/db/schema";
import { generateToken, hashToken } from "@/lib/auth/tokens";
import { eq, desc } from "drizzle-orm";

/**
 * GET /api/tokens - List all tokens for the authenticated user.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const tokens = await db
    .select({
      id: authTokens.id,
      name: authTokens.name,
      lastUsedAt: authTokens.lastUsedAt,
      expiresAt: authTokens.expiresAt,
      createdAt: authTokens.createdAt,
    })
    .from(authTokens)
    .where(eq(authTokens.userId, user.id))
    .orderBy(desc(authTokens.createdAt));

  return NextResponse.json({ tokens });
}

/**
 * POST /api/tokens - Create a new bearer token.
 * Returns the raw token once — it cannot be retrieved again.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!user) {
    // Auto-create user on first token creation
    const [newUser] = await db
      .insert(users)
      .values({
        email: session.user.email,
        name: session.user.name || null,
        image: session.user.image || null,
      })
      .returning();
    return createTokenForUser(db, newUser.id, request);
  }

  return createTokenForUser(db, user.id, request);
}

async function createTokenForUser(
  db: ReturnType<typeof getDb>,
  userId: string,
  request: Request
) {
  const body = await request.json();
  const name = body.name || "Unnamed Token";
  const expiresAt = body.expires_at ? new Date(body.expires_at) : null;

  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);

  await db.insert(authTokens).values({
    userId,
    name,
    tokenHash,
    expiresAt,
  });

  return NextResponse.json({
    token: rawToken,
    name,
    message: "Save this token — it will not be shown again.",
  });
}

/**
 * DELETE /api/tokens - Revoke a token by ID.
 */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const { id } = await request.json();

  const [deleted] = await db
    .delete(authTokens)
    .where(eq(authTokens.id, id))
    .returning({ id: authTokens.id });

  if (!deleted) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  return NextResponse.json({ message: "Token revoked." });
}
