import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

const DDL_PATTERN =
  /\b(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT)\b/i;
const DML_PATTERN = /\b(INSERT|UPDATE|DELETE|MERGE)\b/i;

export function registerSqlTools(server: McpServer) {
  server.registerTool(
    "execute_sql",
    {
      title: "Execute SQL",
      description:
        "Execute a raw SQL query. DDL is always blocked. DML (INSERT/UPDATE/DELETE) is blocked by default unless allow_mutations is true.",
      inputSchema: {
        query: z.string().describe("SQL query to execute"),
        allow_mutations: z
          .boolean()
          .optional()
          .describe("Set to true to allow INSERT/UPDATE/DELETE statements"),
      },
    },
    async ({ query, allow_mutations = false }) => {
      // Block DDL always
      if (DDL_PATTERN.test(query)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "DDL statements (CREATE, ALTER, DROP, etc.) are not allowed.",
            },
          ],
          isError: true,
        };
      }

      // Block DML unless explicitly allowed
      if (!allow_mutations && DML_PATTERN.test(query)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "DML statements (INSERT, UPDATE, DELETE) are blocked by default. Set allow_mutations=true to permit them.",
            },
          ],
          isError: true,
        };
      }

      const db = getDb();

      try {
        const result = await db.execute(sql.raw(query));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  rows: result.rows,
                  count: result.rows.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `SQL error: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
