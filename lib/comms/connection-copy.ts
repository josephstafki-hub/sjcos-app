/** Owner-facing connection failures. Raw provider diagnostics stay in the setup report. */
export function connectionCopy(kind: "sms" | "voice") {
  return kind === "sms" ? {
    title: "SMS not connected",
    description: "Texting is off. Saved conversations remain available; new texts need a connected number.",
    error: "SMS is not connected yet. Open Messages and choose Connection help to finish setup. Nothing was sent.",
    help: "Open your Telnyx account and confirm your business number is approved by the carrier for texting. Connecting that number to SJC OS requires a one-time setup on the server, including secure credentials and message notifications. After setup, check the connection here.",
  } : {
    title: "Voice not connected",
    description: "Calling is off. Saved calls, notes and transcripts remain available; new calls need a connected number.",
    error: "Voice is not connected yet. Open Calls and choose Connection help to finish setup. No call was placed.",
    help: "Open your Telnyx account and confirm your business number supports calls. Connecting it to SJC OS requires a one-time setup on the server, including secure credentials, call notifications and the cell number that should ring first. After setup, check the connection here.",
  };
}
