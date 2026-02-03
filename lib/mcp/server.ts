import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEntryTools } from "./tools/entries";
import { registerCollectionTools } from "./tools/collections";
import { registerTagTools } from "./tools/tags";
import { registerKvTools } from "./tools/kv";
import { registerSearchTools } from "./tools/search";
import { registerSqlTools } from "./tools/sql";
import { registerUtilityTools } from "./tools/utility";
import { registerStaticResources } from "./resources/static";
import { registerResourceTemplates } from "./resources/templates";
import { registerPrompts } from "./prompts";

/**
 * Initialize an MCP server with all tools, resources, and prompts registered.
 */
export function initializeServer(server: McpServer) {
  // Tools
  registerEntryTools(server);
  registerCollectionTools(server);
  registerTagTools(server);
  registerKvTools(server);
  registerSearchTools(server);
  registerSqlTools(server);
  registerUtilityTools(server);

  // Resources
  registerStaticResources(server);
  registerResourceTemplates(server);

  // Prompts
  registerPrompts(server);
}
