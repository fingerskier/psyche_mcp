import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, and, isNull, desc, sql, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { entries, entryTags, tags } from "@/lib/db/schema";
import { generateEmbedding } from "@/lib/embeddings";

export function registerEntryTools(server: McpServer) {
  // ── create_entry ──
  server.registerTool(
    "create_entry",
    {
      title: "Create Entry",
      description:
        "Create a knowledge entry in a collection with title, content, optional tags, and optional metadata. Embedding is generated automatically.",
      inputSchema: {
        title: z.string().describe("Entry title"),
        content: z.string().describe("Entry content (main body text)"),
        collection_id: z.string().uuid().optional().describe("Collection UUID to add the entry to"),
        tags: z.array(z.string()).optional().describe("List of tag names to apply"),
        metadata: z.record(z.unknown()).optional().describe("Arbitrary JSON metadata"),
      },
    },
    async ({ title, content, collection_id, tags: tagNames, metadata }) => {
      const db = getDb();

      // Generate embedding
      let embedding: number[] | undefined;
      try {
        embedding = await generateEmbedding(`${title}\n\n${content}`);
      } catch {
        // Proceed without embedding if OpenAI is unavailable
      }

      const [entry] = await db
        .insert(entries)
        .values({
          title,
          content,
          collectionId: collection_id || null,
          metadata: metadata || {},
          embedding: embedding || null,
        })
        .returning();

      // Handle tags
      if (tagNames && tagNames.length > 0) {
        for (const tagName of tagNames) {
          // Upsert tag
          const [tag] = await db
            .insert(tags)
            .values({ name: tagName.toLowerCase() })
            .onConflictDoNothing()
            .returning();
          const tagId =
            tag?.id ||
            (
              await db
                .select()
                .from(tags)
                .where(eq(tags.name, tagName.toLowerCase()))
                .limit(1)
            )[0].id;

          await db
            .insert(entryTags)
            .values({ entryId: entry.id, tagId })
            .onConflictDoNothing();
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { id: entry.id, title: entry.title, created_at: entry.createdAt },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── get_entry ──
  server.registerTool(
    "get_entry",
    {
      title: "Get Entry",
      description:
        "Retrieve a single entry by ID. Returns full content, tags, metadata, and timestamps.",
      inputSchema: {
        id: z.string().uuid().describe("Entry UUID"),
      },
    },
    async ({ id }) => {
      const db = getDb();

      const [entry] = await db
        .select()
        .from(entries)
        .where(and(eq(entries.id, id), isNull(entries.deletedAt)))
        .limit(1);

      if (!entry) {
        return {
          content: [{ type: "text" as const, text: "Entry not found." }],
          isError: true,
        };
      }

      // Get tags
      const entryTagRows = await db
        .select({ name: tags.name })
        .from(entryTags)
        .innerJoin(tags, eq(entryTags.tagId, tags.id))
        .where(eq(entryTags.entryId, id));

      return {
        content: [
          {
            type: "text" as const,
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

  // ── update_entry ──
  server.registerTool(
    "update_entry",
    {
      title: "Update Entry",
      description:
        "Update an entry's title, content, metadata, and/or tags. Re-generates embedding if content changes.",
      inputSchema: {
        id: z.string().uuid().describe("Entry UUID"),
        title: z.string().optional().describe("New title"),
        content: z.string().optional().describe("New content"),
        metadata: z.record(z.unknown()).optional().describe("New metadata (replaces existing)"),
        tags: z.array(z.string()).optional().describe("New tag list (replaces existing tags)"),
        collection_id: z.string().uuid().optional().describe("Move to a different collection"),
      },
    },
    async ({ id, title, content, metadata, tags: tagNames, collection_id }) => {
      const db = getDb();

      // Verify entry exists
      const [existing] = await db
        .select()
        .from(entries)
        .where(and(eq(entries.id, id), isNull(entries.deletedAt)))
        .limit(1);

      if (!existing) {
        return {
          content: [{ type: "text" as const, text: "Entry not found." }],
          isError: true,
        };
      }

      const updates: Record<string, unknown> = {};
      if (title !== undefined) updates.title = title;
      if (content !== undefined) updates.content = content;
      if (metadata !== undefined) updates.metadata = metadata;
      if (collection_id !== undefined) updates.collectionId = collection_id;

      // Re-generate embedding if content or title changed
      if (title !== undefined || content !== undefined) {
        const newTitle = title || existing.title;
        const newContent = content || existing.content;
        try {
          updates.embedding = await generateEmbedding(
            `${newTitle}\n\n${newContent}`
          );
        } catch {
          // Keep old embedding if generation fails
        }
      }

      if (Object.keys(updates).length > 0) {
        await db.update(entries).set(updates).where(eq(entries.id, id));
      }

      // Replace tags if provided
      if (tagNames !== undefined) {
        await db.delete(entryTags).where(eq(entryTags.entryId, id));
        for (const tagName of tagNames) {
          const [tag] = await db
            .insert(tags)
            .values({ name: tagName.toLowerCase() })
            .onConflictDoNothing()
            .returning();
          const tagId =
            tag?.id ||
            (
              await db
                .select()
                .from(tags)
                .where(eq(tags.name, tagName.toLowerCase()))
                .limit(1)
            )[0].id;
          await db
            .insert(entryTags)
            .values({ entryId: id, tagId })
            .onConflictDoNothing();
        }
      }

      return {
        content: [
          { type: "text" as const, text: `Entry ${id} updated successfully.` },
        ],
      };
    }
  );

  // ── delete_entry ──
  server.registerTool(
    "delete_entry",
    {
      title: "Delete Entry",
      description: "Soft-delete an entry by ID.",
      inputSchema: {
        id: z.string().uuid().describe("Entry UUID"),
      },
    },
    async ({ id }) => {
      const db = getDb();

      const [entry] = await db
        .update(entries)
        .set({ deletedAt: new Date() })
        .where(and(eq(entries.id, id), isNull(entries.deletedAt)))
        .returning({ id: entries.id });

      if (!entry) {
        return {
          content: [{ type: "text" as const, text: "Entry not found." }],
          isError: true,
        };
      }

      return {
        content: [
          { type: "text" as const, text: `Entry ${id} deleted.` },
        ],
      };
    }
  );

  // ── list_entries ──
  server.registerTool(
    "list_entries",
    {
      title: "List Entries",
      description:
        "List entries with optional filters: collection, tags, date range, limit/offset.",
      inputSchema: {
        collection_id: z.string().uuid().optional().describe("Filter by collection"),
        tags: z.array(z.string()).optional().describe("Filter by tag names (entries must have ALL listed tags)"),
        limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)"),
        offset: z.number().int().min(0).optional().describe("Offset for pagination"),
      },
    },
    async ({ collection_id, tags: tagFilter, limit = 20, offset = 0 }) => {
      const db = getDb();
      const conditions = [isNull(entries.deletedAt)];

      if (collection_id) {
        conditions.push(eq(entries.collectionId, collection_id));
      }

      let query = db
        .select({
          id: entries.id,
          title: entries.title,
          collectionId: entries.collectionId,
          createdAt: entries.createdAt,
          updatedAt: entries.updatedAt,
        })
        .from(entries)
        .where(and(...conditions))
        .orderBy(desc(entries.createdAt))
        .limit(limit)
        .offset(offset);

      const rows = await query;

      // If tag filter, do post-filtering (simpler for small datasets)
      let results = rows;
      if (tagFilter && tagFilter.length > 0) {
        const filtered = [];
        for (const row of rows) {
          const entryTagRows = await db
            .select({ name: tags.name })
            .from(entryTags)
            .innerJoin(tags, eq(entryTags.tagId, tags.id))
            .where(eq(entryTags.entryId, row.id));
          const entryTagNames = entryTagRows.map((r) => r.name);
          if (
            tagFilter.every((t) => entryTagNames.includes(t.toLowerCase()))
          ) {
            filtered.push({ ...row, tags: entryTagNames });
          }
        }
        results = filtered;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: results.length, entries: results }, null, 2),
          },
        ],
      };
    }
  );
}
