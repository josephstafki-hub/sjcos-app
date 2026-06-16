import { redirect } from "next/navigation";
import { Logo } from "@/components/shell/Logo";
import { LoginForm } from "@/components/auth/LoginForm";
import { getCurrentUser, homeForRole } from "@/lib/dal";

export const metadata = { title: "Sign in · SJC OS" };

/** Standalone login surface — no Shell. Already-authed users skip straight to
 *  their role home. */
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeForRole(user.role));

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

        <div className="rounded-xl border border-rule bg-card p-6 shadow-sm">
          <LoginForm />
        </div>

        <div className="mt-4 rounded-lg border border-dashed border-rule-soft bg-paper-2 px-4 py-3">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">
            Demo logins
          </div>
          <ul className="mt-1.5 space-y-0.5 text-[11px] text-ink-3">
            <li>
              <span className="text-ink-2">Owner</span> · josephstafki@sjcarpentryllc.com
            </li>
            <li>
              <span className="text-ink-2">Sub</span> · marco@trade.demo
            </li>
            <li>
              <span className="text-ink-2">Client</span> · henderson@client.demo
            </li>
            <li className="pt-0.5 text-ink-4">password for all: <code>sjcos</code></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
