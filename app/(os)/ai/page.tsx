import { redirect } from "next/navigation";

/** The Ask page folded into the universal operator panel. Old deep links
 *  (?c=<conversation id> from ⌘K Claude launches, notifications, history)
 *  carry through — the panel opens that thread on arrival. */
export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  redirect(c ? `/today?c=${encodeURIComponent(c)}` : "/today");
}
