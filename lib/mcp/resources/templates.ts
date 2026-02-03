import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { entries, entryTags, tags, kvStore } from "@/lib/db/schema";
import { generateEmbedding } from "@/lib/embeddings";

export function registerResourceTemplates(server: McpServer) {
  // ── psyche://collection/{id}/entries ──
  server.registerResource(
    "collection-entries",
    new ResourceTemplate("psyche://collection/{id}/entries", { list: undefined }),
    {
      description: "Entries in a specific collection",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const db = getDb();
      const id = variables.id as string;

      const rows = await db
        .select({
          id: entries.id,
          title: entries.title,
          createdAt: entries.createdAt,
          updatedAt: entries.updatedAt,
        })
        .from(entries)
        .where(and(eq(entries.collectionId, id), isNull(entries.deletedAt)))
        .orderBy(desc(entries.createdAt));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(rows, null, 2),
          },
        ],
      };
    }
  );

  // ── psyche://entry/{id} ──
  server.registerResource(
    "entry",
    new ResourceTemplate("psyche://entry/{id}", { list: undefined }),
    { description: "Single entry by ID", mimeType: "application/json" },
    async (uri, variables) => {
      const db = getDb();
      const id = variables.id as string;

      const [entry] = await db
        .select()
        .from(entries)
        .where(and(eq(entries.id, id), isNull(entries.deletedAt)))
        .limit(1);

      if (!entry) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: "Entry not found",
            },
          ],
        };
      }

      const entryTagRows = await db
        .select({ name: tags.name })
        .from(entryTags)
        .innerJoin(tags, eq(entryTags.tagId, tags.id))
        .where(eq(entryTags.entryId, id));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                ...entry,
                embedding: entry.embedding ? "[vector]" : null,
                searchVector: undefined,
                tags: entryTagRows.map((r) => r.name),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── psyche://kv/{namespace} ──
  server.registerResource(
    "kv-namespace",
    new ResourceTemplate("psyche://kv/{namespace}", { list: undefined }),
    {
      description: "All key-value pairs in a namespace",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const db = getDb();
      const namespace = variables.namespace as string;

      const rows = await db
        .select({
          key: kvStore.key,
          value: kvStore.value,
          updatedAt: kvStore.updatedAt,
        })
        .from(kvStore)
        .where(eq(kvStore.namespace, namespace))
        .orderBy(kvStore.key);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(rows, null, 2),
          },
        ],
      };
    }
  );

  // ── psyche://kv/{namespace}/{key} ──
  server.registerResource(
    "kv-entry",
    new ResourceTemplate("psyche://kv/{namespace}/{key}", { list: undefined }),
    {
      description: "Single key-value pair",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const db = getDb();
      const namespace = variables.namespace as string;
      const key = variables.key as string;

      const [row] = await db
        .select()
        .from(kvStore)
        .where(and(eq(kvStore.namespace, namespace), eq(kvStore.key, key)))
        .limit(1);

      if (!row) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: "Key not found",
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(row.value, null, 2),
          },
        ],
      };
    }
  );

  // ── psyche://search?q={query} ──
  server.registerResource(
    "search",
    new ResourceTemplate("psyche://search?q={query}", { list: undefined }),
    {
      description: "Hybrid search results",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const db = getDb();
      const query = variables.query as string;
      const k = 60;

      const tsQuery = query
        .trim()
        .split(/\s+/)
        .map((w) => w.replace(/[^\w]/g, ""))
        .filter(Boolean)
        .join(" & ");

      let embedding: number[] | undefined;
      try {
        embedding = await generateEmbedding(query);
      } catch {
        // Fall back to FTS only
      }

      let rows: Record<string, unknown>[] = [];

      if (embedding && tsQuery) {
        const vectorStr = `[${embedding.join(",")}]`;
        const result = await db.execute(sql`
          WITH fts AS (
            SELECT e.id,
                   ROW_NUMBER() OVER (ORDER BY ts_rank(e.search_vector, to_tsquery('english', ${tsQuery})) DESC) AS rank
            FROM entries e
            WHERE e.deleted_at IS NULL
              AND e.search_vector @@ to_tsquery('english', ${tsQuery})
          ),
          sem AS (
            SELECT e.id,
                   ROW_NUMBER() OVER (ORDER BY e.embedding <=> ${vectorStr}::vector) AS rank
            FROM entries e
            WHERE e.deleted_at IS NULL
              AND e.embedding IS NOT NULL
          ),
          combined AS (
            SELECT COALESCE(fts.id, sem.id) AS id,
                   COALESCE(1.0 / (${k} + fts.rank), 0) + COALESCE(1.0 / (${k} + sem.rank), 0) AS rrf_score
            FROM fts
            FULL OUTER JOIN sem ON fts.id = sem.id
          )
          SELECT c.id, e.title, c.rrf_score
          FROM combined c
          JOIN entries e ON e.id = c.id
          ORDER BY c.rrf_score DESC
          LIMIT 20
        `);
        rows = result.rows;
      } else if (tsQuery) {
        const result = await db.execute(sql`
          SELECT e.id, e.title,
                 ts_rank(e.search_vector, to_tsquery('english', ${tsQuery})) AS rank
          FROM entries e
          WHERE e.deleted_at IS NULL
            AND e.search_vector @@ to_tsquery('english', ${tsQuery})
          ORDER BY rank DESC
          LIMIT 20
        `);
        rows = result.rows;
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(rows, null, 2),
          },
        ],
      };
    }
  );
}
