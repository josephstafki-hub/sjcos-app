"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Chip, SubmitButton, VoiceButton } from "@/components/ui";
import { addProjectDailyLog } from "@/lib/actions/projects";
import { appendTranscript } from "@/lib/append-transcript";

interface Log {
  id: string;
  iso: string;
  dateLabel: string;
  body: string;
  photos: number;
}

/** Project Daily-log tab — real, project-scoped log history with an add form.
 *  Owner posts a dated entry (upserts per day); the global /schedule log is
 *  separate. Voice dictation (7-voice) is offered when the server has whisper. */
export function ProjectDailyLog({
  slug,
  logs,
  voiceEnabled = false,
}: {
  slug: string;
  logs: Log[];
  voiceEnabled?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const [today] = useState(() => new Date().toLocaleDateString("en-CA"));
  const add = addProjectDailyLog.bind(null, slug);

  return (
    <div className="flex max-w-[680px] flex-col gap-3.5">
      {/* Composer */}
      <Card className="p-3.5">
        <form
          ref={formRef}
          action={async (fd) => {
            await add(fd);
            formRef.current?.reset();
            router.refresh();
          }}
          className="flex flex-col gap-2"
        >
          <div className="flex items-center gap-2">
            <h3 className="flex-1 font-serif text-[15px] font-semibold text-ink">Log the day</h3>
            <input
              name="date"
              type="date"
              defaultValue={today}
              className="rounded border border-rule bg-card px-1.5 py-0.5 text-[12px] text-ink-2 outline-none"
            />
          </div>
          <textarea
            ref={bodyRef}
            name="body"
            required
            rows={3}
            placeholder="What happened on site today…"
            className="w-full resize-y rounded border border-rule bg-card px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4"
          />
          <div className="flex items-center justify-end gap-2">
            {voiceEnabled && <VoiceButton onText={(t) => appendTranscript(bodyRef.current, t)} />}
            <SubmitButton className="rounded-md bg-ink px-3 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]">
              Save log
            </SubmitButton>
          </div>
        </form>
      </Card>

      {/* History */}
      {logs.length === 0 ? (
        <Card kind="dashed" className="p-8 text-center">
          <div className="font-serif text-[15px] font-semibold text-ink-2">No logs yet</div>
          <div className="mt-1 text-[12px] text-ink-3">Add the first entry above.</div>
        </Card>
      ) : (
        logs.map((l) => (
          <Card key={l.id} className="p-3.5">
            <div className="flex items-center">
              <h3 className="flex-1 font-serif text-[14px] font-semibold text-ink">{l.dateLabel}</h3>
              {l.photos > 0 && <Chip kind="ghost">{l.photos} photos</Chip>}
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-ink-2">{l.body}</p>
          </Card>
        ))
      )}
    </div>
  );
}
