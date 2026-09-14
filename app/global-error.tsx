"use client";

// Root-layout error boundary: only fires when app/layout.tsx itself throws
// (a segment error is caught by app/error.tsx first). Must render its own
// <html>/<body> because it replaces the root layout — so it pulls in
// globals.css directly for the design tokens.

import "./globals.css";
import { ErrorPanel } from "@/components/ui/ErrorPanel";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en" className="antialiased">
      <body className="bg-paper text-ink">
        <div className="flex min-h-screen items-center justify-center p-6">
          <ErrorPanel error={error} onRetry={unstable_retry} />
        </div>
      </body>
    </html>
  );
}
