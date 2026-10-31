"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui";
import { restoreSubAssignment } from "@/lib/actions/directory-maintenance";
import { runAction } from "@/lib/run-action";
export function RestoreAssignmentButton({
  projectSlug,
  subSlug,
}: {
  projectSlug: string;
  subSlug: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await runAction(() => restoreSubAssignment(projectSlug, subSlug));
        })
      }
    >
      {pending ? "Restoring…" : "Restore assignment"}
    </Button>
  );
}
