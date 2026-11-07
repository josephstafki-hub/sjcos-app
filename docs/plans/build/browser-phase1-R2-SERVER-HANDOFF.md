# R2 SERVER: production endpoint interface (QA overlay seam)

`lib/browser/runtime-endpoints.ts` is the **only** file the separate QA-only source overlay replaces. Production has no QA import or selector.

```ts
browserWebEndpoint(): {
 control: string; // /run/sjcos-browser/control.sock
 frames: string; // /run/sjcos-browser/frames.sock
 socketPath(kind: 'control'|'frames'): Promise<string>; // validates fixed root-owned socket
 keys(): {key: Buffer; responseKey: Buffer; frameKey: Buffer};
}
loadWebsiteTrust(input: {db: Pool; key: Buffer; controller: WebController}): Promise<WebsiteHooks>
readinessSource(): {evaluateFlags: typeof evaluatePhase1Flags}
```

Production keys are the existing SJC_BROWSER_WEB_RPC_KEY, SJC_BROWSER_WEB_RESPONSE_KEY and SJC_BROWSER_FRAME_KEY hex values. Production socket validation lives in socketPath in this leaf. Production trust loads the fixed protected installed website bridge, catalog, audit/evidence and runner dependencies. Readiness evaluates the existing production enable/pilot switches; the protected bridge/service retain all actual runtime/independent evidence checks. No QA env or database-name branch exists in this leaf or its production consumers.

Implementation/results appended below.
