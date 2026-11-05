import { isAskFailure } from "../ask-result-codes.ts";
import { z } from "zod";
import { isRedirectError } from "next/dist/client/components/redirect-error.js";
import { getURLFromRedirectError } from "next/dist/client/components/redirect.js";
import type { CurrentUser } from "../dal";
import type { PermissionKey } from "../permissions";

export interface MobileAction {
  area: PermissionKey;
  ownerOnly?: boolean;
  invoke: (body: unknown, user: CurrentUser) => Promise<unknown>;
}
export function defineAction<S extends z.ZodType, R>(definition: {
  input: S;
  area?: PermissionKey;
  ownerOnly?: boolean;
  run: (input: z.output<S>, user: CurrentUser) => Promise<R>;
}): MobileAction {
  return {
    area: definition.area ?? "today",
    ownerOnly: definition.ownerOnly,
    invoke: async (body, user) => definition.run(definition.input.parse(body), user),
  };
}

/** Explicit client-safe failures only; arbitrary errors may contain SQL/secrets. */
export class MobileInputError extends Error {}
export async function dispatchMobileAction(
  req: Request, name: string, registry: Record<string, MobileAction>,
  authenticate: (req: Request) => Promise<CurrentUser | null>,
  authHomes: (user: CurrentUser) => string[],
): Promise<Response> {
  const action = Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (!action) return Response.json({ error: "Unknown action." }, { status: 404 });
  try {
    const user = await authenticate(req);
    if (!user) return Response.json(action.area==="ai"?{ok:false,code:"SIGN_IN_AGAIN"}:{ error: "Unauthorized" }, { status: 401 });
    if ((action.ownerOnly && user.role !== "owner") ||
        (user.role !== "owner" && !(user.role === "staff" && user.permissions.includes(action.area)))) {
      return Response.json(action.area==="ai"?{ok:false,code:"CHAT_OFF"}:{ error: "You don't have access to that." }, { status: 403 });
    }
    let body: unknown;
    try { body = await req.json(); }
    catch { return Response.json({ error: "Expected a JSON body." }, { status: 400 }); }
    try {
      const result = await action.invoke(body, user);
      if(isAskFailure(result))return Response.json(result,{status:result.code==="ASK_PAUSED"?503:result.code==="SIGN_IN_AGAIN"?401:result.code==="CHAT_OFF"?403:409});
      if (typeof result === "object" && result !== null && "ok" in result && result.ok === false && "error" in result) {
        return Response.json({ error: result.error }, { status: 400 });
      }
      return Response.json({ ok: true, result: result ?? null });
    } catch (error) {
      if (isRedirectError(error)) {
        const path = getURLFromRedirectError(error);
        const pathname = new URL(path, "http://mobile.local").pathname;
        if (["/login", "/logout", ...authHomes(user)].includes(pathname)) {
          return Response.json(action.area==="ai"?{ok:false,code:"CHAT_OFF"}:{ error: "You don't have access to that." }, { status: 403 });
        }
        return Response.json({ ok: true, redirect: path });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    if (error instanceof MobileInputError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[mobile-rpc] Action failed", name, error);
    return Response.json(action.area==="ai"?{ok:false,code:"ASK_PAUSED"}:{ error: "Something went wrong. Please try again." }, { status: action.area==="ai"?503:500 });
  }
}
