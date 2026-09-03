// Next.js instrumentation hook — runs once when the server process starts.
// Used for the loud comms startup validation (constraint 3 of the SMS/voice
// build: every provider integration names exactly what is missing at boot,
// and a broken enabled feature files a work item + pushes Joe instead of
// logging into the void). Node runtime only; the edge bundle has no db.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    const { commsStartupCheck } = await import("./lib/comms-health");
    await commsStartupCheck();
  } catch (err) {
    console.error("[comms] startup check crashed", err);
  }
}
