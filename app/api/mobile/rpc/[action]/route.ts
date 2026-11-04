import { getUserFromRequest } from "@/lib/api-auth";
import { getCurrentUser, homeFor, homeForRole } from "@/lib/dal";
import { mobileActions } from "@/lib/mobile-rpc";
import { dispatchMobileAction } from "@/lib/mobile-rpc/dispatch";

export async function POST(req: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  return dispatchMobileAction(req, action, mobileActions, async (request) => {
    const bearerUser = await getUserFromRequest(request);
    if (!bearerUser) return null;
    // Actions use cookie-first DAL auth. Refuse a conflicting cookie rather
    // than let a caller authorize one principal and mutate as another.
    const actionUser = await getCurrentUser();
    return actionUser?.id === bearerUser.id ? bearerUser : null;
  }, user => [homeFor(user), homeForRole(user.role)]);
}
