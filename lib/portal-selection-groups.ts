import type { SelectionGroup } from "./selections";

/** Retain room context while keeping only the decisions for each section. */
export function splitSelectionGroups(groups: SelectionGroup[]) {
  const filter = (items: SelectionGroup[], pending: boolean): SelectionGroup[] =>
    items.flatMap((group) => {
      const selections = group.selections.filter((s) => (s.status === "pending") === pending);
      const children = filter(group.children, pending);
      return selections.length || children.length ? [{ ...group, selections, children }] : [];
    });
  return { pending: filter(groups, true), history: filter(groups, false) };
}
