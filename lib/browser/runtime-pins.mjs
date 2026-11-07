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
  // Candidate exact artifacts, not installed/accepted runtime attestations.
  mitmdump:Object.freeze({version:'12.3.1',python:'>=3.12',wheelSha256:'87afb808ac8d55383dbe6aa30eadeb0fedaeffd26210e7e23c25c9cd43bdb36a'}),
  unbound:Object.freeze({version:'1.26.2',sourceSha256:'d8ee7aa6bbb3ff1be7d9e57637d0d0ec2f18273a8efff1a0afe2c665858b96f7'}),
  upstreamBundleSha256:'829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d',
  playwrightPatchSha256:null,patchedBundleSha256:null,parserPatchSha256:'1cf731ab44e87f409012af1ccf54eb1cb2d2a4158a2cd98306a7d655602dd44b',pythonTransitiveLockSha256:'eba221bfad4290320bd1dabec0ab76583d5b84505b9fdfa0e9d675eb9d777885',
  gateAddonSha256:'7c6e18d4091f1c3c0358c70e41d1e62edd9b577e3fe9d4d48d627d649255979a',
  gateDispatcherSha256:'f60f792cb7c55c6693d343da5762c9de3a0e43f6b73ecbfefb1d34a82eade2aa',
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
