# psyche_mcp Specification

## 1. Overview

Psyche is a single-user personal knowledgebase exposed as an MCP (Model Context Protocol) server. It runs on Vercel as a Next.js application backed by Neon PostgreSQL with pgvector for semantic search. AI assistants connect over MCP Streamable HTTP to store, retrieve, organize, and search knowledge on the user's behalf.

**Core constraints:**

- Single authorized user (no multi-tenancy)
- MCP-only data interface (no REST API for entries)
- Serverless deployment on Vercel
- All embeddings generated via OpenAI

---

## 2. Architecture

```
┌─────────────┐   MCP Streamable HTTP   ┌──────────────────────┐
│  AI Client   │ ◄────────────────────► │  Vercel (Next.js)    │
│ (Claude, etc)│   Bearer token auth     │                      │
└─────────────┘                         │  /api/mcp            │
                                        │  ├─ mcp-handler      │
┌─────────────┐   Google OAuth          │  ├─ tools            │
│  Browser     │ ◄────────────────────► │  ├─ resources        │
│  (Mgmt UI)   │   NextAuth.js          │  └─ prompts          │
└─────────────┘                         │                      │
                                        │  /app (Management UI)│
                                        └──────────┬───────────┘
                                                   │
                                                   │ Drizzle ORM
                                                   ▼
                                        ┌──────────────────────┐
                                        │  Neon PostgreSQL     │
                                        │  + pgvector          │
                                        │  + full-text search  │
                                        └──────────────────────┘
```

### Key architectural decisions

- **Next.js App Router** on Vercel for both the MCP endpoint and the management UI in a single deployment.
- **MCP Streamable HTTP** at `/api/mcp` using the `mcp-handler` package. Each request instantiates a stateless MCP server (no persistent sessions).
- **Neon PostgreSQL** with `pgvector` for vector similarity search and built-in GIN indexes for full-text search.
- **Two auth paths**: Google OAuth (browser/management UI) and bearer tokens (MCP clients).

---

## 3. MCP Tools

Tools are the primary interface for AI clients to interact with the knowledgebase.

### Entry CRUD

| Tool | Description |
|------|-------------|
| `create_entry` | Create an entry in a collection with title, content, optional tags, and optional metadata (JSON). Embedding is generated automatically. |
| `get_entry` | Retrieve a single entry by ID. Returns full content, tags, metadata, timestamps. |
| `update_entry` | Update title, content, metadata, and/or tags. Re-generates embedding if content changes. |
| `delete_entry` | Soft-delete an entry by ID. |
| `list_entries` | List entries with optional filters: collection, tags, date range, limit/offset. |

### Search

| Tool | Description |
|------|-------------|
| `search_fulltext` | PostgreSQL full-text search across entry titles and content. Returns ranked results with highlights. |
| `search_semantic` | Vector similarity search using cosine distance against entry embeddings. |
| `search_hybrid` | Combined full-text + semantic search using Reciprocal Rank Fusion (RRF) to merge rankings. |

### Collections

| Tool | Description |
|------|-------------|
| `create_collection` | Create a named collection with optional description. |
| `list_collections` | List all collections with entry counts. |
| `get_collection` | Get collection details including description and entry count. |
| `delete_collection` | Delete a collection. Fails if it contains entries (must reassign or delete entries first). |

### Tags

| Tool | Description |
|------|-------------|
| `tag_entry` | Add one or more tags to an entry. Creates tags if they don't exist. |
| `untag_entry` | Remove one or more tags from an entry. |
| `list_tags` | List all tags with usage counts. |

### Key-Value Store

| Tool | Description |
|------|-------------|
| `kv_set` | Set a key-value pair in a namespace. Value is JSON. Upserts. |
| `kv_get` | Get a value by namespace + key. |
| `kv_delete` | Delete a key-value pair. |
| `kv_list` | List keys in a namespace, or list all namespaces. |

### SQL

| Tool | Description |
|------|-------------|
| `execute_sql` | Execute a raw SQL SELECT query. DDL and DML (INSERT/UPDATE/DELETE) are blocked by default. An optional `allow_mutations` flag permits DML but never DDL. |

### Utility

| Tool | Description |
|------|-------------|
| `get_schema` | Return the current database schema (tables, columns, types). |
| `get_stats` | Return knowledgebase statistics: entry count, collection count, tag count, storage usage, embedding coverage. |
| `reindex_embeddings` | Re-generate embeddings for entries missing them or for all entries in a collection. Runs in batches to stay within serverless time limits. |

---

## 4. MCP Resources & Prompts

### Static Resources

| URI | Description |
|-----|-------------|
| `psyche://schema` | Current database schema |
| `psyche://stats` | Knowledgebase statistics |
| `psyche://collections` | List of all collections |
| `psyche://tags` | List of all tags with counts |

### Resource Templates (Dynamic)

| URI Template | Description |
|--------------|-------------|
| `psyche://collection/{id}/entries` | Entries in a specific collection |
| `psyche://entry/{id}` | Single entry by ID |
| `psyche://kv/{namespace}` | All key-value pairs in a namespace |
| `psyche://kv/{namespace}/{key}` | Single key-value pair |
| `psyche://search?q={query}` | Hybrid search results |

### Prompts

| Prompt | Description |
|--------|-------------|
| `summarize_collection` | Summarize the contents and themes of a collection. Arguments: `collection_id`. |
| `find_related` | Find entries related to a given topic or entry. Arguments: `query` or `entry_id`. |
| `organize_entries` | Suggest how to reorganize/re-tag entries for better structure. Arguments: `collection_id` (optional). |

---

## 5. Database Schema

### Tables

```sql
-- Users (single user, but table supports the auth flow)
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  image         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Auth tokens for MCP client connections
CREATE TABLE auth_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,              -- human-readable label
  token_hash    TEXT NOT NULL UNIQUE,       -- SHA-256 hash of the bearer token
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,               -- NULL = never expires
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Collections group related entries
CREATE TABLE collections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Core knowledge entries
CREATE TABLE entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID REFERENCES collections(id),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  metadata      JSONB DEFAULT '{}',
  embedding     vector(1536),              -- OpenAI text-embedding-3-small
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) STORED,
  deleted_at    TIMESTAMPTZ,               -- soft delete
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Tags
CREATE TABLE tags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Entry-tag junction
CREATE TABLE entry_tags (
  entry_id      UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id        UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

-- Namespaced key-value store
CREATE TABLE kv_store (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace     TEXT NOT NULL DEFAULT 'default',
  key           TEXT NOT NULL,
  value         JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (namespace, key)
);
```

### Indexes

```sql
-- Full-text search
CREATE INDEX idx_entries_search ON entries USING GIN (search_vector);

-- Vector similarity (HNSW for fast approximate nearest neighbor)
CREATE INDEX idx_entries_embedding ON entries
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Lookups
CREATE INDEX idx_entries_collection ON entries (collection_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_entries_deleted ON entries (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_entry_tags_tag ON entry_tags (tag_id);
CREATE INDEX idx_kv_namespace ON kv_store (namespace);
CREATE INDEX idx_auth_tokens_hash ON auth_tokens (token_hash);
```

### Triggers

- `updated_at` auto-update trigger on `entries`, `collections`, `kv_store`, and `users`.

---

## 6. Authentication

### Google OAuth (Management UI)

- Implemented via **NextAuth.js** (Auth.js v5) with the Google provider.
- A single authorized email is stored in the `AUTHORIZED_EMAIL` environment variable.
- On sign-in, the callback checks `profile.email === AUTHORIZED_EMAIL`. Unauthorized emails are rejected.
- Session tokens are stored in an HTTP-only cookie.

### Bearer Tokens (MCP Clients)

- Created through the management UI. The raw token is shown once at creation time.
- Stored as SHA-256 hashes in the `auth_tokens` table.
- MCP clients send `Authorization: Bearer <token>` with each request.
- The `/api/mcp` handler hashes the incoming token and looks up the matching row.
- Tokens can optionally have an expiration date.

---

## 7. Deployment & Environment

### Vercel Configuration

The project deploys as a standard Next.js app on Vercel. No special `vercel.json` is needed beyond defaults. The MCP endpoint is a Next.js Route Handler at `app/api/mcp/route.ts`.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon PostgreSQL connection string (pooled) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `NEXTAUTH_SECRET` | Random secret for NextAuth.js session encryption |
| `NEXTAUTH_URL` | Canonical URL of the deployment (e.g. `https://psyche.vercel.app`) |
| `AUTHORIZED_EMAIL` | The single Google email authorized to access the management UI |
| `OPENAI_API_KEY` | OpenAI API key for generating embeddings |

---

## 8. NPM Dependencies

### Core

| Package | Purpose |
|---------|---------|
| `next` | Framework (App Router) |
| `react`, `react-dom` | UI |
| `mcp-handler` | Streamable HTTP adapter for MCP in Next.js |
| `@modelcontextprotocol/sdk` | MCP server SDK |
| `zod` | Schema validation for tool inputs |
| `next-auth` | Google OAuth authentication |
| `@neondatabase/serverless` | Neon PostgreSQL driver (HTTP/WebSocket) |
| `drizzle-orm` | Type-safe ORM |
| `drizzle-kit` | Migrations CLI |
| `openai` | Embedding generation |
| `pgvector` | pgvector type support for Drizzle |

### Dev

| Package | Purpose |
|---------|---------|
| `typescript` | Type checking |
| `@types/node`, `@types/react` | Type definitions |
| `eslint`, `eslint-config-next` | Linting |
| `tailwindcss`, `@tailwindcss/postcss` | Styling for management UI |

---

## 9. Project Structure

```
psyche_mcp/
├── app/
│   ├── layout.tsx                  # Root layout
│   ├── page.tsx                    # Landing / redirect to dashboard
│   ├── api/
│   │   ├── mcp/
│   │   │   └── route.ts           # MCP Streamable HTTP endpoint
│   │   └── auth/
│   │       └── [...nextauth]/
│   │           └── route.ts       # NextAuth.js handlers
│   └── dashboard/
│       ├── layout.tsx              # Authenticated layout
│       ├── page.tsx                # Dashboard overview
│       └── tokens/
│           └── page.tsx            # Token management
├── lib/
│   ├── db/
│   │   ├── schema.ts              # Drizzle schema definitions
│   │   ├── index.ts               # Database client
│   │   └── migrations/            # Drizzle migration files
│   ├── mcp/
│   │   ├── server.ts              # MCP server factory
│   │   ├── tools/
│   │   │   ├── entries.ts         # Entry CRUD tools
│   │   │   ├── search.ts          # Search tools (FTS, semantic, hybrid)
│   │   │   ├── collections.ts     # Collection tools
│   │   │   ├── tags.ts            # Tag tools
│   │   │   ├── kv.ts              # Key-value tools
│   │   │   ├── sql.ts             # Raw SQL tool
│   │   │   └── utility.ts         # Schema, stats, reindex tools
│   │   ├── resources/
│   │   │   ├── static.ts          # Static resources
│   │   │   └── templates.ts       # Dynamic resource templates
│   │   └── prompts/
│   │       └── index.ts           # Prompt definitions
│   ├── auth/
│   │   ├── config.ts              # NextAuth.js configuration
│   │   └── tokens.ts              # Bearer token utilities (hash, verify)
│   └── embeddings.ts              # OpenAI embedding generation
├── drizzle.config.ts               # Drizzle Kit configuration
├── next.config.ts                  # Next.js configuration
├── tailwind.config.ts              # Tailwind CSS configuration
├── tsconfig.json
├── package.json
├── SPEC.md
└── README.md
```

---

## 10. Implementation Phases

### Phase 1 — Foundation

- Initialize Next.js project with TypeScript and Tailwind
- Set up Drizzle ORM with Neon PostgreSQL
- Define database schema and run initial migration
- Create the MCP endpoint at `/api/mcp` using `mcp-handler`
- Implement bearer token authentication middleware
- Set up NextAuth.js with Google OAuth and `AUTHORIZED_EMAIL` gate

### Phase 2 — Core Tools

- Implement entry CRUD tools (`create_entry`, `get_entry`, `update_entry`, `delete_entry`, `list_entries`)
- Implement collection tools (`create_collection`, `list_collections`, `get_collection`, `delete_collection`)
- Implement tag tools (`tag_entry`, `untag_entry`, `list_tags`)
- Implement key-value tools (`kv_set`, `kv_get`, `kv_delete`, `kv_list`)

### Phase 3 — Search

- Integrate OpenAI embeddings generation on entry create/update
- Implement `search_fulltext` using PostgreSQL `ts_rank`
- Implement `search_semantic` using pgvector cosine distance
- Implement `search_hybrid` with Reciprocal Rank Fusion (RRF)
- Implement `reindex_embeddings` utility tool

### Phase 4 — Resources & Prompts

- Register static resources (schema, stats, collections, tags)
- Register dynamic resource templates (collection entries, entry, KV, search)
- Register prompts (summarize_collection, find_related, organize_entries)

### Phase 5 — Management UI

- Build dashboard page showing knowledgebase stats
- Build token management page (create, list, revoke tokens)
- Add authenticated layout with sign-in/sign-out

### Phase 6 — Polish

- Implement `execute_sql` tool with mutation guard
- Implement `get_schema` and `get_stats` utility tools
- Add rate limiting / request logging
- Review error handling and edge cases
