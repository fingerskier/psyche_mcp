import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sql, eq, isNull, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { entries, collections, tags, kvStore } from "@/lib/db/schema";
import { generateEmbedding } from "@/lib/embeddings";

export function registerUtilityTools(server: McpServer) {
  // ── get_schema ──
  server.registerTool(
    "get_schema",
    {
      title: "Get Schema",
      description:
        "Return the current database schema (tables, columns, types).",
      inputSchema: {},
    },
    async () => {
      const db = getDb();

      const result = await db.execute(sql`
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `);

      // Group by table
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
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(schema, null, 2),
          },
        ],
      };
    }
  );

  // ── get_stats ──
  server.registerTool(
    "get_stats",
    {
      title: "Get Stats",
      description:
        "Return knowledgebase statistics: entry count, collection count, tag count, embedding coverage.",
      inputSchema: {},
    },
    async () => {
      const db = getDb();

      const [entryStats] = await db
        .select({
          total: sql<number>`count(*)`,
          withEmbedding: sql<number>`count(embedding)`,
        })
        .from(entries)
        .where(isNull(entries.deletedAt));

      const [collectionStats] = await db
        .select({ total: sql<number>`count(*)` })
        .from(collections);

      const [tagStats] = await db
        .select({ total: sql<number>`count(*)` })
        .from(tags);

      const [kvStats] = await db
        .select({ total: sql<number>`count(*)` })
        .from(kvStore);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                entries: {
                  total: Number(entryStats.total),
                  with_embedding: Number(entryStats.withEmbedding),
                  embedding_coverage:
                    Number(entryStats.total) > 0
                      ? `${Math.round((Number(entryStats.withEmbedding) / Number(entryStats.total)) * 100)}%`
                      : "N/A",
                },
                collections: Number(collectionStats.total),
                tags: Number(tagStats.total),
                kv_pairs: Number(kvStats.total),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── reindex_embeddings ──
  server.registerTool(
    "reindex_embeddings",
    {
      title: "Reindex Embeddings",
      description:
        "Re-generate embeddings for entries missing them, or for all entries in a collection. Runs in batches.",
      inputSchema: {
        collection_id: z
          .string()
          .uuid()
          .optional()
          .describe("Reindex only entries in this collection"),
        force: z
          .boolean()
          .optional()
          .describe(
            "If true, re-generate even for entries that already have embeddings"
          ),
        batch_size: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Batch size (default 10)"),
      },
    },
    async ({ collection_id, force = false, batch_size = 10 }) => {
      const db = getDb();

      const conditions = [isNull(entries.deletedAt)];
      if (collection_id) {
        conditions.push(eq(entries.collectionId, collection_id));
      }
      if (!force) {
        conditions.push(sql`${entries.embedding} IS NULL`);
      }

      const toReindex = await db
        .select({
          id: entries.id,
          title: entries.title,
          content: entries.content,
        })
        .from(entries)
        .where(and(...conditions))
        .limit(batch_size);

      let processed = 0;
      let errors = 0;

      for (const entry of toReindex) {
        try {
          const embedding = await generateEmbedding(
            `${entry.title}\n\n${entry.content}`
          );
          await db
            .update(entries)
            .set({ embedding })
            .where(eq(entries.id, entry.id));
          processed++;
        } catch {
          errors++;
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                found: toReindex.length,
                processed,
                errors,
                message:
                  toReindex.length === batch_size
                    ? "Batch limit reached. Run again to process more."
                    : "All matching entries processed.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
