"use client";

import { Button, Card } from "@/components/ui";
import { useTodayQueue } from "./TodayQueueContext";

/** A compact index; the complete, grouped list remains in the main column. */
export function TodayWaitingSummary() {
  const { waiting } = useTodayQueue();
  const items = waiting.filter(item => !item.waitingOnSub);
  return (
    <Card className="p-4">
      <h2 className="font-serif text-heading text-ink">Waiting on me <span className="ml-1 font-sans text-meta text-ink-3">{items.length}</span></h2>
      <div className="mt-3 divide-y divide-rule-soft">
        {items.slice(0, 5).map(item => (
          <a key={item.id} href="#today-rest" className="block rounded-md py-2.5 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
            <p className="text-body font-semibold text-ink">{item.title}</p>
            <p className="mt-0.5 text-meta text-ink-3">{item.group.name}{item.due ? ` · Due ${item.due}` : ""}</p>
          </a>
        ))}
        {!items.length && <p className="py-3 text-body text-ink-3">Your remaining work appears here after Up next.</p>}
      </div>
      {items.length > 0 && <Button href="#today-rest" variant="ghost" size="sm" className="mt-2">View full list</Button>}
    </Card>
  );
}
