import { Eyebrow } from "@/components/ui";
import { portalSlug } from "@/lib/client-portal";
import { getClientSelections, EMPTY_SELECTIONS_VIEW } from "@/lib/selections";
import { ClientSelections } from "@/components/portal/ClientSelections";

// Client-portal selections: every decision Joe has pushed, options side by
// side with prices against allowances, running budget on top. Choosing an
// option (or declining the set) writes straight back to the board.
export default async function PortalSelectionsPage() {
  const slug = await portalSlug();
  const view = slug ? await getClientSelections(slug) : EMPTY_SELECTIONS_VIEW;

  return (
    <main className="mx-auto w-full max-w-3xl px-9 py-7">
      <Eyebrow>Selections</Eyebrow>
      <h1 className="mt-1 font-serif text-[26px] font-medium leading-tight text-accent-2">
        Your decisions, room by room.
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        Pick one option for each decision — the price against your allowance is shown up
        front, and the running budget updates as you choose.
      </p>
      <div className="my-5 border-t border-rule" />
      <ClientSelections view={view} />
    </main>
  );
}
