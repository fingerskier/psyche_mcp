import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import Link from "next/link";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect("/api/auth/signin");
  }

  return (
    <div className="min-h-screen">
      <nav className="border-b border-gray-800 bg-gray-900/50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href="/dashboard"
              className="text-lg font-semibold tracking-tight"
            >
              Psyche
            </Link>
            <div className="flex gap-4 text-sm text-gray-400">
              <Link
                href="/dashboard"
                className="hover:text-white transition-colors"
              >
                Overview
              </Link>
              <Link
                href="/dashboard/tokens"
                className="hover:text-white transition-colors"
              >
                API Tokens
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-500">{session.user?.email}</span>
            <a
              href="/api/auth/signout"
              className="text-gray-400 hover:text-white transition-colors"
            >
              Sign out
            </a>
          </div>
        </div>
      </nav>
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
