import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, and, isNull, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { entries, collections, entryTags, tags } from "@/lib/db/schema";

export function registerPrompts(server: McpServer) {
  // ── summarize_collection ──
  server.registerPrompt(
    "summarize_collection",
    {
      description:
        "Summarize the contents and themes of a collection.",
      argsSchema: {
        collection_id: z
          .string()
          .uuid()
          .describe("The collection UUID to summarize"),
      },
    },
    async ({ collection_id }) => {
      const db = getDb();

      const [collection] = await db
        .select()
        .from(collections)
        .where(eq(collections.id, collection_id))
        .limit(1);

      const entryRows = await db
        .select({ title: entries.title, content: entries.content })
        .from(entries)
        .where(
          and(
            eq(entries.collectionId, collection_id),
            isNull(entries.deletedAt)
          )
        )
        .orderBy(desc(entries.createdAt))
        .limit(50);

      const entryList = entryRows
        .map((e) => `## ${e.title}\n${e.content.slice(0, 500)}`)
        .join("\n\n---\n\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Please summarize the following collection "${collection?.name || "Unknown"}" (${collection?.description || "no description"}).\n\nIt contains ${entryRows.length} entries:\n\n${entryList}\n\nProvide:\n1. A brief overall summary\n2. Key themes and topics\n3. Any notable patterns or gaps`,
            },
          },
        ],
      };
    }
  );

  // ── find_related ──
  server.registerPrompt(
    "find_related",
    {
      description: "Find entries related to a given topic or entry.",
      argsSchema: {
        query: z
          .string()
          .optional()
          .describe("Search query or topic to find related entries for"),
        entry_id: z
          .string()
          .uuid()
          .optional()
          .describe("An existing entry ID to find related entries for"),
      },
    },
    async ({ query, entry_id }) => {
      const db = getDb();
      let searchContext = "";

      if (entry_id) {
        const [entry] = await db
          .select({ title: entries.title, content: entries.content })
          .from(entries)
          .where(eq(entries.id, entry_id))
          .limit(1);
        if (entry) {
          searchContext = `Based on this entry:\nTitle: ${entry.title}\nContent: ${entry.content.slice(0, 1000)}`;
        }
      }

      if (query) {
        searchContext = `Based on this topic/query: "${query}"`;
      }

      const recentEntries = await db
        .select({ id: entries.id, title: entries.title })
        .from(entries)
        .where(isNull(entries.deletedAt))
        .orderBy(desc(entries.createdAt))
        .limit(30);

      const entryList = recentEntries
        .map((e) => `- [${e.id}] ${e.title}`)
        .join("\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `${searchContext}\n\nHere are the available entries in the knowledgebase:\n${entryList}\n\nPlease:\n1. Use the search_hybrid or search_semantic tools to find entries related to the topic\n2. Identify the most relevant entries and explain why they're related\n3. Suggest any connections or themes that link them together`,
            },
          },
        ],
      };
    }
  );

  // ── organize_entries ──
  server.registerPrompt(
    "organize_entries",
    {
      description:
        "Suggest how to reorganize/re-tag entries for better structure.",
      argsSchema: {
        collection_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            "Optional collection ID to limit the scope of organization suggestions"
          ),
      },
    },
    async ({ collection_id }) => {
      const db = getDb();

      const conditions = [isNull(entries.deletedAt)];
      if (collection_id) {
        conditions.push(eq(entries.collectionId, collection_id));
      }

      const entryRows = await db
        .select({
          id: entries.id,
          title: entries.title,
          collectionId: entries.collectionId,
        })
        .from(entries)
        .where(and(...conditions))
        .orderBy(entries.title)
        .limit(100);

      const entryDetails = [];
      for (const entry of entryRows) {
        const entryTagRows = await db
          .select({ name: tags.name })
          .from(entryTags)
          .innerJoin(tags, eq(entryTags.tagId, tags.id))
          .where(eq(entryTags.entryId, entry.id));
        entryDetails.push({
          id: entry.id,
          title: entry.title,
          collection_id: entry.collectionId,
          tags: entryTagRows.map((r) => r.name),
        });
      }

      const collectionRows = await db
        .select({ id: collections.id, name: collections.name })
        .from(collections)
        .orderBy(collections.name);

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Please analyze the following entries and suggest how to better organize them.\n\nExisting collections:\n${collectionRows.map((c) => `- ${c.name} (${c.id})`).join("\n")}\n\nEntries:\n${JSON.stringify(entryDetails, null, 2)}\n\nPlease suggest:\n1. Which entries might benefit from being moved to different collections\n2. New collections that could be created\n3. Tags that should be added or removed\n4. Any entries that seem duplicated or could be merged`,
            },
          },
        ],
      };
    }
  );
}
