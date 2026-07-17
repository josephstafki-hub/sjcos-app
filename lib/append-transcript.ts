// Merge a dictated transcript into existing composer text, adding a space as
// needed. Shared by every voice-enabled input in the app (7-voice).

/** Append `text` to `current`, separating with a single space unless empty. */
export function mergeTranscript(current: string, text: string): string {
  if (!text) return current;
  const cur = current.trimEnd();
  return cur ? `${cur} ${text}` : text;
}

/** Append a dictated transcript into an (uncontrolled) textarea/input element.
 *  Used by the project + sub daily-log composers, which hold their body in a
 *  ref rather than React state. */
export function appendTranscript(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  text: string,
) {
  if (!el || !text) return;
  el.value = mergeTranscript(el.value, text);
  el.focus();
}
