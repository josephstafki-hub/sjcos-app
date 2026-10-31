import type { ComponentPropsWithoutRef, ReactNode } from "react";

type DivProps = ComponentPropsWithoutRef<"div">;
type TableProps = ComponentPropsWithoutRef<"table"> & {
  density?: "comfortable" | "compact";
};

/** Keep horizontal scrolling local to the table; use bare for a list on paper. */
export function TableWrapper({ bare, className = "", ...props }: DivProps & { bare?: boolean }) {
  return <div className={`overflow-x-auto ${bare ? "" : "rounded-lg border border-rule-soft bg-card"} ${className}`} {...props} />;
}

export function Table({ density = "comfortable", className = "", ...props }: TableProps) {
  return <table data-density={density} className={`group/table w-full border-collapse text-body ${className}`} {...props} />;
}

export function TableHead({ className = "", ...props }: ComponentPropsWithoutRef<"thead">) {
  return <thead className={className} {...props} />;
}

export function TableBody({ className = "", ...props }: ComponentPropsWithoutRef<"tbody">) {
  return <tbody className={className} {...props} />;
}

export function TableHeader({ numeric, className = "", ...props }: ComponentPropsWithoutRef<"th"> & { numeric?: boolean }) {
  return <th scope="col" className={`sticky top-0 z-10 h-9 border-b border-rule bg-card px-3 font-sans text-label font-medium text-ink-3 group-data-[density=compact]/table:h-8 ${numeric ? "text-right" : "text-left"} ${className}`} {...props} />;
}

export function TableRow({ selected, className = "", ...props }: ComponentPropsWithoutRef<"tr"> & { selected?: boolean }) {
  return <tr aria-selected={selected} className={`group border-b border-rule-soft last:border-0 hover:bg-hover ${props.onClick ? "cursor-pointer" : ""} ${selected ? "bg-selected" : ""} ${className}`} {...props} />;
}

export function TableCell({ numeric, twoLine, className = "", ...props }: ComponentPropsWithoutRef<"td"> & { numeric?: boolean; twoLine?: boolean }) {
  return <td className={`px-3 align-middle text-body ${twoLine ? "h-14 py-2.5 group-data-[density=compact]/table:h-12" : "h-11 py-2.5 group-data-[density=compact]/table:h-9"} group-data-[density=compact]/table:py-2 ${numeric ? "text-right tabular-nums text-ink" : "text-left"} ${className}`} {...props} />;
}

/** Name columns keep their minimum width; free-text columns should truncate first. */
export function TablePrimaryCell({ children, meta, className = "", ...props }: ComponentPropsWithoutRef<"td"> & { meta?: ReactNode }) {
  return (
    <TableCell twoLine={meta != null} className={`min-w-[180px] ${className}`} {...props}>
      <div className="text-subheading font-semibold text-ink">{children}</div>
      {meta != null && <div className="text-meta text-ink-3">{meta}</div>}
    </TableCell>
  );
}

export function TableGroupRow({ children, count, className = "", ...props }: ComponentPropsWithoutRef<"td"> & { count?: ReactNode }) {
  return (
    <tr><td className={`h-9 bg-paper-2/60 px-3 text-label font-semibold text-ink-2 ${className}`} {...props}>
      {children}{count != null && <span className="ml-1.5 font-normal text-ink-3">{count}</span>}
    </td></tr>
  );
}

/** Keep actions discoverable on keyboard focus and touch as well as hover. */
export function TableActions({ className = "", ...props }: DivProps) {
  return <div className={`flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 ${className}`} {...props} />;
}
