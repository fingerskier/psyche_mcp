import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { kvStore } from "@/lib/db/schema";

export function registerKvTools(server: McpServer) {
  // ── kv_set ──
  server.registerTool(
    "kv_set",
    {
      title: "KV Set",
      description:
        "Set a key-value pair in a namespace. Value is JSON. Upserts (creates or updates).",
      inputSchema: {
        namespace: z
          .string()
          .optional()
          .describe("Namespace (default: 'default')"),
        key: z.string().describe("Key name"),
        value: z.unknown().describe("JSON value to store"),
      },
    },
    async ({ namespace = "default", key, value }) => {
      const db = getDb();

      await db
        .insert(kvStore)
        .values({ namespace, key, value })
        .onConflictDoUpdate({
          target: [kvStore.namespace, kvStore.key],
          set: { value, updatedAt: new Date() },
        });

      return {
        content: [
          {
            type: "text" as const,
            text: `Set ${namespace}/${key}`,
          },
        ],
      };
    }
  );

  // ── kv_get ──
  server.registerTool(
    "kv_get",
    {
      title: "KV Get",
      description: "Get a value by namespace + key.",
      inputSchema: {
        namespace: z
          .string()
          .optional()
          .describe("Namespace (default: 'default')"),
        key: z.string().describe("Key name"),
      },
    },
    async ({ namespace = "default", key }) => {
      const db = getDb();

      const [row] = await db
        .select()
        .from(kvStore)
        .where(and(eq(kvStore.namespace, namespace), eq(kvStore.key, key)))
        .limit(1);

      if (!row) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Key "${key}" not found in namespace "${namespace}".`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                namespace: row.namespace,
                key: row.key,
                value: row.value,
                updated_at: row.updatedAt,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── kv_delete ──
  server.registerTool(
    "kv_delete",
    {
      title: "KV Delete",
      description: "Delete a key-value pair.",
      inputSchema: {
        namespace: z
          .string()
          .optional()
          .describe("Namespace (default: 'default')"),
        key: z.string().describe("Key name"),
      },
    },
    async ({ namespace = "default", key }) => {
      const db = getDb();

      const [deleted] = await db
        .delete(kvStore)
        .where(and(eq(kvStore.namespace, namespace), eq(kvStore.key, key)))
        .returning({ id: kvStore.id });

      if (!deleted) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Key "${key}" not found in namespace "${namespace}".`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Deleted ${namespace}/${key}`,
          },
        ],
      };
    }
  );

  // ── kv_list ──
  server.registerTool(
    "kv_list",
    {
      title: "KV List",
      description: "List keys in a namespace, or list all namespaces.",
      inputSchema: {
        namespace: z
          .string()
          .optional()
          .describe(
            "Namespace to list keys from. Omit to list all namespaces."
          ),
      },
    },
    async ({ namespace }) => {
      const db = getDb();

      if (namespace) {
        // List keys in namespace
        const rows = await db
          .select({
            key: kvStore.key,
            updatedAt: kvStore.updatedAt,
          })
          .from(kvStore)
          .where(eq(kvStore.namespace, namespace))
          .orderBy(kvStore.key);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { namespace, keys: rows },
                null,
                2
              ),
            },
          ],
        };
      } else {
        // List all namespaces
        const rows = await db
          .select({
            namespace: kvStore.namespace,
            count: sql<number>`count(*)`.as("key_count"),
          })
          .from(kvStore)
          .groupBy(kvStore.namespace)
          .orderBy(kvStore.namespace);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ namespaces: rows }, null, 2),
            },
          ],
        };
      }
    }
  );
}
