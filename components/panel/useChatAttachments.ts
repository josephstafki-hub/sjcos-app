"use client";

import { useRef, useState } from "react";
import { uploadChatFilesAction, type ChatAttachment } from "@/lib/actions/ai-chat";

/** Mirror of MAX_UPLOAD_BYTES in lib/actions/ai-chat.ts. Checked here too
 *  because Next's serverActions.bodySizeLimit (25mb, next.config.ts) measures
 *  the whole encoded request: a file at exactly the cap throws inside Next
 *  before the action can run and return its own tidy error. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Files staged for the next chat turn. Shared by the Ask window
 * (AssistantChat) and the command bar (CommandBar, which is the AI box on
 * Projects / Leads / Warranty) so the upload rules can't drift apart.
 *
 * Uploads one file per request rather than one FormData for the batch: two
 * 15MB photos sum past the body limit, and Next rejects the whole batch with
 * an opaque throw — one request each keeps a good file from being lost to a
 * bad neighbour.
 */
export function useChatAttachments(onError: (msg: string) => void) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  // A count, not a boolean: pasting a second screenshot while the first is
  // still uploading has to attach both. A boolean either rejects the second
  // batch (silently dropping it) or lets the first batch finishing clear the
  // flag while the second is still in flight, which would re-open sending.
  const [uploadCount, setUploadCount] = useState(0);
  const uploading = uploadCount > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(list: FileList | null) {
    if (!list?.length) return;
    setUploadCount((n) => n + 1);
    const errors: string[] = [];
    try {
      for (const f of Array.from(list)) {
        if (f.size > MAX_UPLOAD_BYTES) {
          errors.push(`${f.name} is over the 25 MB limit.`);
          continue;
        }
        try {
          const fd = new FormData();
          fd.append("files", f);
          const r = await uploadChatFilesAction(fd);
          if (r.ok) setAttachments((a) => [...a, ...r.files]);
          else errors.push(r.error);
        } catch {
          // A rejected action (over the body limit, auth, network) would
          // otherwise be an unhandled rejection with no sign the file dropped.
          errors.push(`${f.name} couldn't be uploaded.`);
        }
      }
    } finally {
      setUploadCount((n) => n - 1);
      // Reset so re-picking the same file fires onChange again.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    if (errors.length) onError(errors.join(" "));
  }

  /** Pull files out of a paste (screenshots) or a drop; ignores plain text. */
  const uploadFromTransfer = (dt: DataTransfer | null) => {
    if (!dt?.files?.length) return false;
    void uploadFiles(dt.files);
    return true;
  };

  const removeAttachment = (i: number) =>
    setAttachments((cur) => cur.filter((_, j) => j !== i));

  return {
    attachments,
    setAttachments,
    uploading,
    fileInputRef,
    uploadFiles,
    uploadFromTransfer,
    removeAttachment,
  };
}
