import { redirect } from "next/navigation";
import { Logo } from "@/components/shell/Logo";
import { LoginForm } from "@/components/auth/LoginForm";
import { getCurrentUser, homeForRole } from "@/lib/dal";

export const metadata = { title: "Sign in · SJC OS" };

/** Why a sub-portal link dumped someone here instead of into their portal.
 *  Set by app/sub-portal/enter/route.ts. These people were promised "no account,
 *  no password" — landing them on a bare sign-in form with no explanation is how
 *  you get a phone call. */
const INVITE_NOTICE: Record<string, string> = {
  expired: "That job link has expired. Text Joe and he'll send you a fresh one.",
  inactive: "That account is no longer active. Reach out to Joe if this looks wrong.",
  missing: "That job link is incomplete — try opening it straight from the email.",
  failed: "Something went wrong opening that job link. Text Joe and he'll sort it out.",
};

/** Standalone login surface — no Shell. Already-authed users skip straight to
 *  their role home. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(homeForRole(user.role));

  const { invite } = await searchParams;
  const notice = invite ? (INVITE_NOTICE[invite] ?? INVITE_NOTICE.failed) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo />
          <div>
            <h1 className="font-serif text-[26px] font-medium leading-none text-accent-2">
              Welcome back
            </h1>
            <p className="mt-1.5 text-[12px] text-ink-3">
              Sign in to your SJ Carpentry workspace.
            </p>
          </div>
        </div>

        {notice && (
          <div className="mb-4 rounded-lg border border-flag/30 bg-flag/5 px-4 py-3 text-[12px] leading-snug text-ink-2">
            {notice}
          </div>
        )}

        <div className="rounded-xl border border-rule bg-card p-6 shadow-sm">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
