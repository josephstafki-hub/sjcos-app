"use client";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui";
import { useRouter } from "next/navigation";
import { connectionCopy } from "@/lib/comms/connection-copy";

export function ConnectionNotice({ kind }: { kind: "sms" | "voice" }) {
  const copy = connectionCopy(kind);
  const router = useRouter();
  return (
    <div className="border-b border-warn/20 bg-warn-soft px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-warn" />
        <div className="min-w-0">
          <p className="text-subheading font-semibold text-ink">{copy.title}</p>
          <p className="mt-1 text-body text-ink-2">{copy.description}</p>
        </div>
      </div>
      <details className="mt-2 text-body text-ink-2">
        <summary className="w-fit cursor-pointer rounded-md py-1 font-semibold focus-visible:outline-2 focus-visible:outline-focus">
          Connection help
        </summary>
        <p className="mt-2 max-w-prose">{copy.help}</p>
        <Button href="https://portal.telnyx.com/" variant="secondary" size="sm" className="mr-2 mt-3">Open Telnyx setup</Button>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => router.refresh()}
        >
          Check connection
        </Button>
      </details>
    </div>
  );
}
