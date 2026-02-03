"use client";

import { useState, useEffect, useCallback } from "react";

interface Token {
  id: string;
  name: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export default function TokensPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [newTokenName, setNewTokenName] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch("/api/tokens");
      if (res.ok) {
        const data = await res.json();
        setTokens(data.tokens);
      }
    } catch {
      // Ignore fetch errors on initial load
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  async function createToken() {
    if (!newTokenName.trim()) return;
    setLoading(true);
    setError(null);
    setCreatedToken(null);

    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTokenName.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create token");
        return;
      }

      const data = await res.json();
      setCreatedToken(data.token);
      setNewTokenName("");
      fetchTokens();
    } catch {
      setError("Failed to create token");
    } finally {
      setLoading(false);
    }
  }

  async function revokeToken(id: string) {
    if (!confirm("Revoke this token? Any clients using it will lose access.")) {
      return;
    }

    try {
      await fetch("/api/tokens", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      fetchTokens();
    } catch {
      setError("Failed to revoke token");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">API Tokens</h1>
        <p className="text-gray-400 mt-1">
          Manage bearer tokens for MCP client connections
        </p>
      </div>

      {/* Create token */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Create New Token</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={newTokenName}
            onChange={(e) => setNewTokenName(e.target.value)}
            placeholder="Token name (e.g. Claude Desktop)"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
            onKeyDown={(e) => e.key === "Enter" && createToken()}
          />
          <button
            onClick={createToken}
            disabled={loading || !newTokenName.trim()}
            className="px-4 py-2 bg-white text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>

        {error && (
          <div className="text-red-400 text-sm">{error}</div>
        )}

        {createdToken && (
          <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-4 space-y-2">
            <div className="text-yellow-400 text-sm font-medium">
              Token created — copy it now. It will not be shown again.
            </div>
            <code className="block bg-gray-800 px-3 py-2 rounded text-sm text-green-400 break-all select-all">
              {createdToken}
            </code>
          </div>
        )}
      </div>

      {/* Token list */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold">Active Tokens</h2>
        </div>
        {tokens.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500 text-sm">
            No tokens yet. Create one above to connect an AI assistant.
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="px-6 py-4 flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="font-medium text-sm">{token.name}</div>
                  <div className="text-xs text-gray-500 space-x-4">
                    <span>
                      Created{" "}
                      {new Date(token.createdAt).toLocaleDateString()}
                    </span>
                    {token.lastUsedAt && (
                      <span>
                        Last used{" "}
                        {new Date(token.lastUsedAt).toLocaleDateString()}
                      </span>
                    )}
                    {token.expiresAt && (
                      <span>
                        Expires{" "}
                        {new Date(token.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => revokeToken(token.id)}
                  className="text-sm text-red-400 hover:text-red-300 transition-colors"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
