import { createMcpHandler } from "mcp-handler";
import { initializeServer } from "@/lib/mcp/server";
import { verifyToken } from "@/lib/auth/tokens";

const handler = createMcpHandler(
  initializeServer,
  {
    serverInfo: {
      name: "psyche",
      version: "0.1.0",
    },
  },
  {
    basePath: "/api",
    maxDuration: 60,
  }
);

/**
 * Wraps the MCP handler with bearer token authentication.
 */
async function authenticatedHandler(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");

  // Allow unauthenticated GET for MCP discovery/SSE setup
  if (request.method === "GET") {
    return handler(request);
  }

  // POST requests require bearer token
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const rawToken = authHeader.slice(7);
  const token = await verifyToken(rawToken);

  if (!token) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  return handler(request);
}

export { authenticatedHandler as GET, authenticatedHandler as POST };
