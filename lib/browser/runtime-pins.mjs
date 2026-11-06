/** Metadata only. No runtime install/import or browser launch. Security review,
 * separate runtime lock + patch attestation and actual fixtures remain required.
 */
export const RUNTIME_PINS=Object.freeze({
  playwrightCore:Object.freeze({version:'1.64.1',
    integrity:'sha512-BC4s8y6SEVA6Q1rSxZTto8hI1KUI3xXlHGZgvGqP4IqPdI/a6FX9H29IDNz7vKo9l21b6LfYosScPL6M3xxyDQ==',
    chromiumRevision:'1248',chromiumVersion:'156.0.8078.4'}),
  mcpSdk:Object.freeze({version:'1.29.0',
    integrity:'sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ=='}),
  comparatorOnly:Object.freeze({name:'@playwright/mcp',version:'0.0.81',runtimeDependency:false,
    integrity:'sha512-c4eVex1nS53IzLHlwAm0J9ZISDTvA7RndFX8oVcQOrmvIrKSkByazpq79lZHWJuWTB7Gpk0sLBQoRepyIgmneA=='}),
  // Plan names no exact gate/Unbound version. Do not invent a reviewed pin.
  mitmdump:null,unbound:null,playwrightPatchSha256:null,patchedBundleSha256:null,
  gateAddonSha256:null,gateDispatcherSha256:null,
});
export const DEFAULT_FLAGS=Object.freeze({
  'browser.enabled':false,'browser.staff_enabled':false,'browser.vault_enabled':false,
  'browser.files_enabled':false,'browser.final_steps_enabled':false,'browser.permit_handoff_enabled':false,
});
export function verifyInstalledMetadata({playwrightCore,browsers,mcpSdk,comparator}) {
  const chromium=browsers?.browsers?.find(x=>x.name==='chromium');
  return Object.freeze({ok:playwrightCore?.version===RUNTIME_PINS.playwrightCore.version
    &&chromium?.revision===RUNTIME_PINS.playwrightCore.chromiumRevision
    &&chromium?.browserVersion===RUNTIME_PINS.playwrightCore.chromiumVersion
    &&mcpSdk?.version===RUNTIME_PINS.mcpSdk.version
    &&comparator?.version===RUNTIME_PINS.comparatorOnly.version,
    releaseReady:false}); // Metadata cannot attest patches, binary, sandbox or safety.
}
