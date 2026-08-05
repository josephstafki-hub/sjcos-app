import { redirect } from "next/navigation";

/** The ⌘K popup is gone — the operator panel is the app's one Ask surface. */
export default function CmdkPage() {
  redirect("/today");
}
