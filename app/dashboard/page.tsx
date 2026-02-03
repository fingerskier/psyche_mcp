import { sql, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { entries, collections, tags, kvStore } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let stats = {
    entries: 0,
    withEmbeddings: 0,
    collections: 0,
    tags: 0,
    kvPairs: 0,
  };

  try {
    const db = getDb();

    const [entryStats] = await db
      .select({
        total: sql<number>`count(*)`,
        withEmbedding: sql<number>`count(embedding)`,
      })
      .from(entries)
      .where(isNull(entries.deletedAt));

    const [collectionCount] = await db
      .select({ total: sql<number>`count(*)` })
      .from(collections);

    const [tagCount] = await db
      .select({ total: sql<number>`count(*)` })
      .from(tags);

    const [kvCount] = await db
      .select({ total: sql<number>`count(*)` })
      .from(kvStore);

    stats = {
      entries: Number(entryStats.total),
      withEmbeddings: Number(entryStats.withEmbedding),
      collections: Number(collectionCount.total),
      tags: Number(tagCount.total),
      kvPairs: Number(kvCount.total),
    };
  } catch {
    // DB may not be set up yet — show zeros
  }

  const cards = [
    { label: "Entries", value: stats.entries },
    { label: "With Embeddings", value: stats.withEmbeddings },
    { label: "Collections", value: stats.collections },
    { label: "Tags", value: stats.tags },
    { label: "KV Pairs", value: stats.kvPairs },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-gray-400 mt-1">Knowledgebase overview</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4"
          >
            <div className="text-2xl font-bold">{card.value}</div>
            <div className="text-sm text-gray-500 mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Connect AI Assistants</h2>
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-gray-400 mb-1">MCP Endpoint</div>
            <code className="block bg-gray-800 px-3 py-2 rounded text-green-400">
              {"{your-domain}"}/api/mcp
            </code>
          </div>
          <div>
            <div className="text-gray-400 mb-1">Transport</div>
            <code className="block bg-gray-800 px-3 py-2 rounded">
              Streamable HTTP
            </code>
          </div>
          <div>
            <div className="text-gray-400 mb-1">Authentication</div>
            <code className="block bg-gray-800 px-3 py-2 rounded">
              Authorization: Bearer {"<token>"}
            </code>
          </div>
          <p className="text-gray-500 pt-2">
            Create an API token on the{" "}
            <a
              href="/dashboard/tokens"
              className="text-blue-400 hover:underline"
            >
              Tokens page
            </a>{" "}
            to connect your AI assistants.
          </p>
        </div>
      </div>
    </div>
  );
}
