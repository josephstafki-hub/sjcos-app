// PURE ledger scenario only. Does not satisfy §12's real parser/RSS/packet gate.
export const responseBudgetScenario = Object.freeze({
  contexts:['joe','staff'],connectionCandidatesPerContext:8,
  requestBytes:25*1024*1024,responseBytes:25*1024*1024,
  requestCopies:2,responseReservationBytes:56*1024*1024,
  slowReaderChunkBytes:64*1024,deadlineMs:60_000,
  requiredRuntimeEvidence:[
    'pinned-parser-before-allocation','socket-backpressure-before-read',
    'peak-rss-and-cgroup-at-most-336MiB','baseline-at-most-144MiB',
    'zero-unapproved-upstream-bytes','consumed-write-unknown-no-retry',
  ],
});
