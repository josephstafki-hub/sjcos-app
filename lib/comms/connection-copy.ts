/** Owner-facing connection failures. Raw provider diagnostics stay in the setup report. */
export function connectionCopy(kind: "sms" | "voice") {
  return kind === "sms" ? {
    title: "SMS not connected",
    description: "Texting is off. Saved conversations are still available here.",
    error: "SMS is not connected yet. Open Messages and choose Connection help to finish setup. Nothing was sent.",
    help: "Ask the person who manages SJC OS to connect your Telnyx business number for texting and confirm that the carrier has approved it. Once they confirm setup, check the connection again.",
  } : {
    title: "Voice not connected",
    description: "Calling is off. Saved calls, notes and transcripts are still available here.",
    error: "Voice is not connected yet. Open Calls and choose Connection help to finish setup. No call was placed.",
    help: "Ask the person who manages SJC OS to connect your Telnyx business number for calls and confirm the cell number calls should ring. Once they confirm setup, check the connection again.",
  };
}
