// Append a dictated transcript into an (uncontrolled) textarea, adding a space
// or newline as needed. Shared by the project + sub daily-log composers (7-voice).

export function appendTranscript(el: HTMLTextAreaElement | null, text: string) {
  if (!el || !text) return;
  const cur = el.value.trimEnd();
  el.value = cur ? `${cur} ${text}` : text;
  el.focus();
}
