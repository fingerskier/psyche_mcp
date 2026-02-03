import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";

export default async function Home() {
  const session = await auth();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-md w-full text-center space-y-8">
        <h1 className="text-4xl font-bold tracking-tight">Psyche</h1>
        <p className="text-gray-400 text-lg">
          Personal knowledgebase MCP server
        </p>
        <div className="space-y-4 text-sm text-gray-500">
          <p>
            Connect your AI assistants to store, retrieve, organize, and search
            your personal knowledge.
          </p>
          <div className="pt-4">
            <a
              href="/api/auth/signin"
              className="inline-block px-6 py-3 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-200 transition-colors"
            >
              Sign in to manage
            </a>
          </div>
        </div>
        <div className="pt-8 text-xs text-gray-600 space-y-1">
          <p>MCP Endpoint: <code className="bg-gray-800 px-2 py-0.5 rounded">/api/mcp</code></p>
        </div>
      </div>
    </main>
  );
}
