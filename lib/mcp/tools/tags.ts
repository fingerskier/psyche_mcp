import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, sql, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tags, entryTags } from "@/lib/db/schema";

export function registerTagTools(server: McpServer) {
  // ── tag_entry ──
  server.registerTool(
    "tag_entry",
    {
      title: "Tag Entry",
      description:
        "Add one or more tags to an entry. Creates tags if they don't exist.",
      inputSchema: {
        entry_id: z.string().uuid().describe("Entry UUID"),
        tags: z.array(z.string()).min(1).describe("Tag names to add"),
      },
    },
    async ({ entry_id, tags: tagNames }) => {
      const db = getDb();
      const added: string[] = [];

      for (const tagName of tagNames) {
        const normalized = tagName.toLowerCase().trim();
        // Upsert tag
        const [tag] = await db
          .insert(tags)
          .values({ name: normalized })
          .onConflictDoNothing()
          .returning();
        const tagId =
          tag?.id ||
          (
            await db
              .select()
              .from(tags)
              .where(eq(tags.name, normalized))
              .limit(1)
          )[0].id;

        // Link tag to entry
        await db
          .insert(entryTags)
          .values({ entryId: entry_id, tagId })
          .onConflictDoNothing();

        added.push(normalized);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Tags added to entry ${entry_id}: ${added.join(", ")}`,
          },
        ],
      };
    }
  );

  // ── untag_entry ──
  server.registerTool(
    "untag_entry",
    {
      title: "Untag Entry",
      description: "Remove one or more tags from an entry.",
      inputSchema: {
        entry_id: z.string().uuid().describe("Entry UUID"),
        tags: z.array(z.string()).min(1).describe("Tag names to remove"),
      },
    },
    async ({ entry_id, tags: tagNames }) => {
      const db = getDb();
      const removed: string[] = [];

      for (const tagName of tagNames) {
        const normalized = tagName.toLowerCase().trim();
        const [tag] = await db
          .select()
          .from(tags)
          .where(eq(tags.name, normalized))
          .limit(1);

        if (tag) {
          await db
            .delete(entryTags)
            .where(
              sql`${entryTags.entryId} = ${entry_id} AND ${entryTags.tagId} = ${tag.id}`
            );
          removed.push(normalized);
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Tags removed from entry ${entry_id}: ${removed.join(", ") || "none found"}`,
          },
        ],
      };
    }
  );

  // ── list_tags ──
  server.registerTool(
    "list_tags",
    {
      title: "List Tags",
      description: "List all tags with usage counts.",
      inputSchema: {},
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
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ tags: rows }, null, 2),
          },
        ],
      };
    }
  );
}
