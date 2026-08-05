import { redirect } from "next/navigation";

/** The operator console preview was promoted: its queue + chat columns are the
 *  persistent panel dock, and its workbench column lives on at /workbench. */
export default function TodayPreviewPage() {
  redirect("/today");
}
