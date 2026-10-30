"use server";
import { searchPanel } from "@/lib/panel-search";
export async function searchPanelAction(query: string, recordsOnly = false) {
  return searchPanel(query, recordsOnly);
}
