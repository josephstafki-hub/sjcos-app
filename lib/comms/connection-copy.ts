/** Owner-facing connection failures. Raw provider diagnostics stay in the setup report. */
export function connectionCopy(kind: "sms" | "voice") {
  return kind === "sms" ? {
    title: "Finish texting setup",
    description: "Texting is off. Saved conversations remain available; new texts need a connected number.",
    error: "SMS is not connected yet. Open Messages and choose Connection help to finish setup. Nothing was sent.",
    steps: ["Confirm your business number is approved by the carrier for texting in Telnyx.", "Have your account administrator securely connect the number and incoming-message notifications to SJC OS.", "Return here and check the connection before sending a text."],
    help: "Open your Telnyx account and confirm your business number is approved by the carrier for texting. Connecting that number to SJC OS requires a one-time setup on the server, including secure credentials and message notifications. After setup, check the connection here.",
  } : {
    title: "Finish voice setup",
    description: "Calling is off. Saved calls, notes and transcripts remain available; new calls need a connected number.",
    error: "Voice is not connected yet. Open Calls and choose Connection help to finish setup. No call was placed.",
    steps: ["Confirm your business number supports calls in Telnyx.", "Have your account administrator securely connect calling, call notifications and the cell number that should ring first.", "Return here and check the connection before placing a call."],
    help: "Open your Telnyx account and confirm your business number supports calls. Connecting it to SJC OS requires a one-time setup on the server, including secure credentials, call notifications and the cell number that should ring first. After setup, check the connection here.",
  };
}
