"use client";

import { useEffect, useState } from "react";

function currentSignInHref() {
  const { pathname, search, hash } = window.location;
  return `/login?returnTo=${encodeURIComponent(pathname + search + hash)}`;
}

/** Keep the server/hydration snapshot stable; resolve the return page on mount. */
export function AskSignInLink() {
  const [href, setHref] = useState("/login");
  useEffect(() => { setHref(currentSignInHref()); }, []);
  return <a href={href} onClick={event => { event.currentTarget.href = currentSignInHref(); }} className="inline-flex min-h-11 items-center text-ai-2">Sign in</a>;
}
