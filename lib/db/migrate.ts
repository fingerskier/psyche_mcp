/**
 * Raw SQL migration for initial schema setup.
 * Run via: npx tsx lib/db/migrate.ts
 *
 * This creates the tables, indexes, triggers, and extensions
 * that Drizzle's generated migrations may not fully capture
 * (e.g. GENERATED ALWAYS AS columns, pgvector indexes, triggers).
 */
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running migrations...");

  // Enable extensions
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;

  // ── Users ──
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT UNIQUE NOT NULL,
      name          TEXT,
      image         TEXT,
      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now()
    )
  `;

  // ── Auth Tokens ──
  await sql`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id),
      name          TEXT NOT NULL,
      token_hash    TEXT NOT NULL UNIQUE,
      last_used_at  TIMESTAMPTZ,
      expires_at    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT now()
    )
  `;

  // ── Collections ──
  await sql`
    CREATE TABLE IF NOT EXISTS collections (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name          TEXT NOT NULL UNIQUE,
      description   TEXT,
      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now()
    )
  `;

  // ── Entries ──
  await sql`
    CREATE TABLE IF NOT EXISTS entries (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      collection_id UUID REFERENCES collections(id),
      title         TEXT NOT NULL,
      content       TEXT NOT NULL,
      metadata      JSONB DEFAULT '{}',
      embedding     vector(1536),
      search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(content, '')), 'B')
      ) STORED,
      deleted_at    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now()
    )
  `;

  // ── Tags ──
  await sql`
    CREATE TABLE IF NOT EXISTS tags (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name          TEXT NOT NULL UNIQUE,
      created_at    TIMESTAMPTZ DEFAULT now()
    )
  `;

  // ── Entry Tags ──
  await sql`
    CREATE TABLE IF NOT EXISTS entry_tags (
      entry_id      UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      tag_id        UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (entry_id, tag_id)
    )
  `;

  // ── KV Store ──
  await sql`
    CREATE TABLE IF NOT EXISTS kv_store (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      namespace     TEXT NOT NULL DEFAULT 'default',
      key           TEXT NOT NULL,
      value         JSONB NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now(),
      UNIQUE (namespace, key)
    )
  `;

  // ── Indexes ──
  await sql`CREATE INDEX IF NOT EXISTS idx_entries_search ON entries USING GIN (search_vector)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_entries_collection ON entries (collection_id) WHERE deleted_at IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries (deleted_at) WHERE deleted_at IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags (tag_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_kv_namespace ON kv_store (namespace)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens (token_hash)`;

  // HNSW index for vector similarity (create only if not exists)
  try {
    await sql`
      CREATE INDEX IF NOT EXISTS idx_entries_embedding ON entries
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `;
  } catch (e) {
    console.warn("Could not create HNSW index (may need entries first):", e);
  }

  // ── updated_at triggers ──
  await sql`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  // Create triggers (each spelled out since tagged templates don't support dynamic identifiers)
  await sql`DROP TRIGGER IF EXISTS users_updated_at ON users`;
  await sql`CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at()`;

  await sql`DROP TRIGGER IF EXISTS entries_updated_at ON entries`;
  await sql`CREATE TRIGGER entries_updated_at BEFORE UPDATE ON entries FOR EACH ROW EXECUTE FUNCTION update_updated_at()`;

  await sql`DROP TRIGGER IF EXISTS collections_updated_at ON collections`;
  await sql`CREATE TRIGGER collections_updated_at BEFORE UPDATE ON collections FOR EACH ROW EXECUTE FUNCTION update_updated_at()`;

  await sql`DROP TRIGGER IF EXISTS kv_store_updated_at ON kv_store`;
  await sql`CREATE TRIGGER kv_store_updated_at BEFORE UPDATE ON kv_store FOR EACH ROW EXECUTE FUNCTION update_updated_at()`;

  console.log("Migrations complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
