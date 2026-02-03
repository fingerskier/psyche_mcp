import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sql, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { entries, collections, tags, kvStore } from "@/lib/db/schema";

export function registerStaticResources(server: McpServer) {
  // ── psyche://schema ──
  server.registerResource(
    "schema",
    "psyche://schema",
    { description: "Current database schema", mimeType: "application/json" },
    async () => {
      const db = getDb();
      const result = await db.execute(sql`
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `);

      const schema: Record<string, unknown[]> = {};
      for (const row of result.rows) {
        const table = row.table_name as string;
        if (!schema[table]) schema[table] = [];
        schema[table].push({
          column: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === "YES",
          default: row.column_default,
        });
      }

      return {
        contents: [
          {
            uri: "psyche://schema",
            mimeType: "application/json",
            text: JSON.stringify(schema, null, 2),
          },
        ],
      };
    }
  );

  // ── psyche://stats ──
  server.registerResource(
    "stats",
    "psyche://stats",
    { description: "Knowledgebase statistics", mimeType: "application/json" },
    async () => {
      const db = getDb();

      const [entryStats] = await db
        .select({
          total: sql<number>`count(*)`,
          withEmbedding: sql<number>`count(embedding)`,
        })
        .from(entries)
        .where(isNull(entries.deletedAt));

      const [collectionCount] = await db
        .select({ total: sql<number>`count(*)` })
        .from(collections);

      const [tagCount] = await db
        .select({ total: sql<number>`count(*)` })
        .from(tags);

      const [kvCount] = await db
        .select({ total: sql<number>`count(*)` })
        .from(kvStore);

      const stats = {
        entries: Number(entryStats.total),
        entries_with_embeddings: Number(entryStats.withEmbedding),
        collections: Number(collectionCount.total),
        tags: Number(tagCount.total),
        kv_pairs: Number(kvCount.total),
      };

      return {
        contents: [
          {
            uri: "psyche://stats",
            mimeType: "application/json",
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    }
  );

  // ── psyche://collections ──
  server.registerResource(
    "collections",
    "psyche://collections",
    {
      description: "List of all collections",
      mimeType: "application/json",
    },
    async () => {
      const db = getDb();

      const rows = await db
        .select({
          id: collections.id,
          name: collections.name,
          description: collections.description,
          entryCount: sql<number>`(
            SELECT count(*) FROM entries
            WHERE entries.collection_id = ${collections.id}
            AND entries.deleted_at IS NULL
          )`.as("entry_count"),
        })
        .from(collections)
        .orderBy(collections.name);

      return {
        contents: [
          {
            uri: "psyche://collections",
            mimeType: "application/json",
            text: JSON.stringify(rows, null, 2),
          },
        ],
      };
    }
  );

  // ── psyche://tags ──
  server.registerResource(
    "tags",
    "psyche://tags",
    {
      description: "List of all tags with usage counts",
      mimeType: "application/json",
    },
    async () => {
      const db = getDb();

      const rows = await db
        .select({
          id: tags.id,
          name: tags.name,
          count: sql<number>`(
            SELECT count(*) FROM entry_tags
            WHERE entry_tags.tag_id = ${tags.id}
          )`.as("usage_count"),
        })
        .from(tags)
        .orderBy(tags.name);

      return {
        contents: [
          {
            uri: "psyche://tags",
            mimeType: "application/json",
            text: JSON.stringify(rows, null, 2),
          },
        ],
      };
    }
  );
}
