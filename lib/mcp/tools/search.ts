import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sql, and, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { entries } from "@/lib/db/schema";
import { generateEmbedding } from "@/lib/embeddings";

export function registerSearchTools(server: McpServer) {
  // ── search_fulltext ──
  server.registerTool(
    "search_fulltext",
    {
      title: "Full-Text Search",
      description:
        "PostgreSQL full-text search across entry titles and content. Returns ranked results with highlights.",
      inputSchema: {
        query: z.string().describe("Search query text"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
        collection_id: z.string().uuid().optional().describe("Filter by collection"),
      },
    },
    async ({ query, limit = 10, collection_id }) => {
      const db = getDb();

      const tsQuery = query
        .trim()
        .split(/\s+/)
        .map((w) => w.replace(/[^\w]/g, ""))
        .filter(Boolean)
        .join(" & ");

      if (!tsQuery) {
        return {
          content: [{ type: "text" as const, text: "Invalid search query." }],
          isError: true,
        };
      }

      const conditions = [
        isNull(entries.deletedAt),
        sql`${entries.searchVector} @@ to_tsquery('english', ${tsQuery})`,
      ];

      if (collection_id) {
        conditions.push(sql`${entries.collectionId} = ${collection_id}`);
      }

      const rows = await db
        .select({
          id: entries.id,
          title: entries.title,
          collectionId: entries.collectionId,
          rank: sql<number>`ts_rank(${entries.searchVector}, to_tsquery('english', ${tsQuery}))`.as("rank"),
          headline: sql<string>`ts_headline('english', ${entries.content}, to_tsquery('english', ${tsQuery}), 'MaxFragments=2,MaxWords=60')`.as("headline"),
          createdAt: entries.createdAt,
        })
        .from(entries)
        .where(and(...conditions))
        .orderBy(
          sql`ts_rank(${entries.searchVector}, to_tsquery('english', ${tsQuery})) DESC`
        )
        .limit(limit);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: rows.length, results: rows }, null, 2),
          },
        ],
      };
    }
  );

  // ── search_semantic ──
  server.registerTool(
    "search_semantic",
    {
      title: "Semantic Search",
      description:
        "Vector similarity search using cosine distance against entry embeddings.",
      inputSchema: {
        query: z.string().describe("Natural language search query"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
        collection_id: z.string().uuid().optional().describe("Filter by collection"),
      },
    },
    async ({ query, limit = 10, collection_id }) => {
      const db = getDb();

      let embedding: number[];
      try {
        embedding = await generateEmbedding(query);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: "Failed to generate embedding for query. Check OPENAI_API_KEY.",
            },
          ],
          isError: true,
        };
      }

      const vectorStr = `[${embedding.join(",")}]`;
      const conditions = [
        isNull(entries.deletedAt),
        sql`${entries.embedding} IS NOT NULL`,
      ];

      if (collection_id) {
        conditions.push(sql`${entries.collectionId} = ${collection_id}`);
      }

      const rows = await db
        .select({
          id: entries.id,
          title: entries.title,
          collectionId: entries.collectionId,
          similarity: sql<number>`1 - (${entries.embedding} <=> ${vectorStr}::vector)`.as("similarity"),
          createdAt: entries.createdAt,
        })
        .from(entries)
        .where(and(...conditions))
        .orderBy(sql`${entries.embedding} <=> ${vectorStr}::vector`)
        .limit(limit);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: rows.length, results: rows }, null, 2),
          },
        ],
      };
    }
  );

  // ── search_hybrid ──
  server.registerTool(
    "search_hybrid",
    {
      title: "Hybrid Search",
      description:
        "Combined full-text + semantic search using Reciprocal Rank Fusion (RRF) to merge rankings.",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
        collection_id: z.string().uuid().optional().describe("Filter by collection"),
      },
    },
    async ({ query, limit = 10, collection_id }) => {
      const db = getDb();
      const k = 60; // RRF constant

      // Build tsquery
      const tsQuery = query
        .trim()
        .split(/\s+/)
        .map((w) => w.replace(/[^\w]/g, ""))
        .filter(Boolean)
        .join(" & ");

      // Generate embedding
      let embedding: number[];
      try {
        embedding = await generateEmbedding(query);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: "Failed to generate embedding. Falling back would require OPENAI_API_KEY.",
            },
          ],
          isError: true,
        };
      }

      const vectorStr = `[${embedding.join(",")}]`;

      // Use a CTE-based RRF query
      const collectionFilter = collection_id
        ? sql`AND e.collection_id = ${collection_id}`
        : sql``;

      const { rows } = await db.execute(sql`
        WITH fts AS (
          SELECT e.id,
                 ROW_NUMBER() OVER (ORDER BY ts_rank(e.search_vector, to_tsquery('english', ${tsQuery})) DESC) AS rank
          FROM entries e
          WHERE e.deleted_at IS NULL
            AND e.search_vector @@ to_tsquery('english', ${tsQuery})
            ${collectionFilter}
        ),
        sem AS (
          SELECT e.id,
                 ROW_NUMBER() OVER (ORDER BY e.embedding <=> ${vectorStr}::vector) AS rank
          FROM entries e
          WHERE e.deleted_at IS NULL
            AND e.embedding IS NOT NULL
            ${collectionFilter}
        ),
        combined AS (
          SELECT COALESCE(fts.id, sem.id) AS id,
                 COALESCE(1.0 / (${k} + fts.rank), 0) + COALESCE(1.0 / (${k} + sem.rank), 0) AS rrf_score
          FROM fts
          FULL OUTER JOIN sem ON fts.id = sem.id
        )
        SELECT c.id, e.title, e.collection_id, c.rrf_score, e.created_at
        FROM combined c
        JOIN entries e ON e.id = c.id
        ORDER BY c.rrf_score DESC
        LIMIT ${limit}
      `);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: rows.length, results: rows }, null, 2),
          },
        ],
      };
    }
  );
}
