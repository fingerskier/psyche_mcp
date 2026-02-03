import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, sql, and, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { collections, entries } from "@/lib/db/schema";

export function registerCollectionTools(server: McpServer) {
  // ── create_collection ──
  server.registerTool(
    "create_collection",
    {
      title: "Create Collection",
      description: "Create a named collection with optional description.",
      inputSchema: {
        name: z.string().describe("Collection name (must be unique)"),
        description: z.string().optional().describe("Collection description"),
      },
    },
    async ({ name, description }) => {
      const db = getDb();

      try {
        const [collection] = await db
          .insert(collections)
          .values({ name, description })
          .returning();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(collection, null, 2),
            },
          ],
        };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes("unique") || message.includes("duplicate")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `A collection named "${name}" already exists.`,
              },
            ],
            isError: true,
          };
        }
        throw e;
      }
    }
  );

  // ── list_collections ──
  server.registerTool(
    "list_collections",
    {
      title: "List Collections",
      description: "List all collections with entry counts.",
      inputSchema: {},
    },
    async () => {
      const db = getDb();

      const rows = await db
        .select({
          id: collections.id,
          name: collections.name,
          description: collections.description,
          createdAt: collections.createdAt,
          entryCount: sql<number>`(
            SELECT count(*) FROM entries
            WHERE entries.collection_id = ${collections.id}
            AND entries.deleted_at IS NULL
          )`.as("entry_count"),
        })
        .from(collections)
        .orderBy(collections.name);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ collections: rows }, null, 2),
          },
        ],
      };
    }
  );

  // ── get_collection ──
  server.registerTool(
    "get_collection",
    {
      title: "Get Collection",
      description:
        "Get collection details including description and entry count.",
      inputSchema: {
        id: z.string().uuid().describe("Collection UUID"),
      },
    },
    async ({ id }) => {
      const db = getDb();

      const [collection] = await db
        .select({
          id: collections.id,
          name: collections.name,
          description: collections.description,
          createdAt: collections.createdAt,
          updatedAt: collections.updatedAt,
          entryCount: sql<number>`(
            SELECT count(*) FROM entries
            WHERE entries.collection_id = ${collections.id}
            AND entries.deleted_at IS NULL
          )`.as("entry_count"),
        })
        .from(collections)
        .where(eq(collections.id, id))
        .limit(1);

      if (!collection) {
        return {
          content: [{ type: "text" as const, text: "Collection not found." }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(collection, null, 2),
          },
        ],
      };
    }
  );

  // ── delete_collection ──
  server.registerTool(
    "delete_collection",
    {
      title: "Delete Collection",
      description:
        "Delete a collection. Fails if it contains entries (must reassign or delete entries first).",
      inputSchema: {
        id: z.string().uuid().describe("Collection UUID"),
      },
    },
    async ({ id }) => {
      const db = getDb();

      // Check for existing entries
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(entries)
        .where(
          and(eq(entries.collectionId, id), isNull(entries.deletedAt))
        );

      if (Number(count) > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cannot delete collection: it still contains ${count} active entries. Delete or reassign them first.`,
            },
          ],
          isError: true,
        };
      }

      const [deleted] = await db
        .delete(collections)
        .where(eq(collections.id, id))
        .returning({ id: collections.id });

      if (!deleted) {
        return {
          content: [{ type: "text" as const, text: "Collection not found." }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Collection ${id} deleted.`,
          },
        ],
      };
    }
  );
}
