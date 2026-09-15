"use client";

// Route-segment error boundary (see node_modules/next/dist/docs/01-app/03-api-
// reference/03-file-conventions/error.md). Wraps every page under the root
// layout, so a render-time crash shows a real message in the app's flag
// styling with a "Try again" instead of a blank page. In production Next
// replaces a Server Component error's message with a generic one plus a
// digest; we show whatever we get and the digest so it can be matched to the
// server log.

import { useEffect } from "react";
import { ErrorPanel } from "@/components/ui/ErrorPanel";

export default function RouteError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <ErrorPanel error={error} onRetry={unstable_retry} />
    </div>
  );
}
