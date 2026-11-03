"use client";
/**
 * Start/list (plan §6.3): TODAY · K Larson · Kitchen · 9am · Oak Ln, ON THIS DEVICE rows
 * for prepared visits, empty state. Online rows come from the server page; offline (cold
 * shell) only device enrollments are known — their names stay encrypted until the PIN.
 */
import { useEffect, useState } from "react";
import { listEnrollments, deviceId, type Enrollment } from "@/lib/consult/ui/controller";
import { statusLabel, W, fill } from "@/lib/consult/ui/words";
import { Eyebrow, LinkBtn } from "./primitives";
import { centralTime } from "./GetReady";

export interface ListVisit { id: string; status: string; scheduled_at: string; client: string; templates: string; address: string | null; visitor: string; open?: number }

function Row({ v, prepared, now }: { v: ListVisit; prepared?: Enrollment; now: number }) {
  const ready = !!prepared?.expires_at && prepared.expires_at > now;
  return (
    <li className="grid gap-3 border-b-2 border-rule-soft py-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <p className="font-semibold text-ink">{v.client}{v.templates ? ` · ${v.templates}` : ""}</p>
        <p className="text-[0.95em] text-ink-2">{centralTime(v.scheduled_at, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{v.address ? ` · ${v.address}` : ""} · {v.visitor}</p>
        {/* §6.3: a prepared, still-valid scheduled visit reads "Ready offline ✓ [Start visit]". */}
        <p className="text-[0.95em] font-semibold text-ink">{v.status === "scheduled" && ready ? W.readyOffline : `${statusLabel(v.status, v.open)}${ready ? ` · ${W.readyOffline}` : ""}`}</p>
      </div>
      <LinkBtn tone={v.status === "scheduled" || v.status === "in_progress" || v.status === "incomplete" ? "primary" : "secondary"} href={`/consult/${v.id}`}>
        {v.status === "scheduled" ? (prepared ? W.startVisit : W.getReady) : v.status === "in_progress" || v.status === "incomplete" ? "Open visit" : "Open"}
      </LinkBtn>
    </li>
  );
}

export function VisitList({ visits, owner }: { visits: ListVisit[] | null; owner?: boolean }) {
  const [device, setDevice] = useState<Enrollment[]>([]);
  const [now] = useState(() => Date.now());
  useEffect(() => { const d = deviceId(); void listEnrollments().then((e) => setDevice(e.filter((x) => x.device === d))); }, []);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(iso));
  const prepared = (id: string) => device.find((e) => e.identity.consult_id === id);
  const list = visits ?? [];
  const todays = list.filter((v) => day(v.scheduled_at) === today && v.status !== "cancelled");
  const upcoming = list.filter((v) => day(v.scheduled_at) > today && v.status !== "cancelled").reverse();
  const earlier = list.filter((v) => day(v.scheduled_at) < today && !["complete", "cancelled"].includes(v.status));
  const onDevice = device.filter((e) => !list.some((v) => v.id === e.identity.consult_id) || visits === null);
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-10 pt-4">
      <h1 className="flex min-h-14 items-center font-serif text-[1.5em] font-semibold leading-tight text-ink">{W.app}</h1>
      {visits === null && (
        <div role="status" className="mt-2 rounded-lg border-2 border-info bg-info-soft px-4 py-3 text-ink">{W.noSignal}. {W.unlockLead}</div>
      )}
      <section className="mt-4" aria-labelledby="today-h">
        <Eyebrow><span id="today-h">{W.today}</span></Eyebrow>
        {todays.length ? <ul>{todays.map((v) => <Row key={v.id} v={v} prepared={prepared(v.id)} now={now} />)}</ul> : <p className="py-3 text-ink-2">{visits === null ? W.openOnce : W.noneToday}</p>}
      </section>
      {onDevice.length > 0 && (
        <section className="mt-6" aria-labelledby="device-h">
          <Eyebrow><span id="device-h">{W.onThisDevice}</span></Eyebrow>
          <ul>
            {onDevice.map((e, i) => (
              <li key={`${e.identity.consult_id}-${i}`} className="grid gap-3 border-b-2 border-rule-soft py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div><p className="font-semibold text-ink">Prepared visit {i + 1}</p>
                  <p className="text-[0.95em] text-ink-2">{e.expires_at && e.expires_at > now ? fill(W.worksUntil, { time: centralTime(e.expires_at) }) : "Signed out — answers are safe on this device"}</p></div>
                <LinkBtn tone="primary" href={`/consult/${e.identity.consult_id}`}>{W.openVisit}</LinkBtn>
              </li>
            ))}
          </ul>
        </section>
      )}
      {upcoming.length > 0 && <section className="mt-6"><Eyebrow>{W.upcoming}</Eyebrow><ul>{upcoming.map((v) => <Row key={v.id} v={v} prepared={prepared(v.id)} now={now} />)}</ul></section>}
      {earlier.length > 0 && <section className="mt-6"><Eyebrow>{W.earlier}</Eyebrow><ul>{earlier.map((v) => <Row key={v.id} v={v} prepared={prepared(v.id)} now={now} />)}</ul></section>}
      {visits !== null && list.length === 0 && <p className="mt-2 text-ink-2">{W.noVisits}</p>}
      {/* The way out sits under the list on one line, never squeezed beside the title. */}
      <div className="mt-8 border-t-2 border-rule-soft pt-4"><LinkBtn wide tone="quiet" href={owner ? "/today" : "/"} className="whitespace-nowrap">‹ {W.back}</LinkBtn></div>
    </div>
  );
}
