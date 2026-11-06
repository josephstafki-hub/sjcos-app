// Gate simulations run at next Central noon, after all real SQL now() writes.
// Stamp newly counted deliveries into that same clock before the next gate.
// Lease timestamps deliberately stay on real time (the executors use SQL now()).
export async function pushClock(f) {
  const [row] = await f.run(`SELECT ((now() AT TIME ZONE 'America/Chicago')::date + 1 + time '12:00') AT TIME ZONE 'America/Chicago' AS awake,
    ((now() AT TIME ZONE 'America/Chicago')::date + 1) AT TIME ZONE 'America/Chicago' AS midnight`);
  const awake = new Date(row.awake), midnight = new Date(row.midnight);
  const stamp = async (at) => {
    await f.run(`UPDATE push_outbox SET counted_at=$1 WHERE counted_at IS NOT NULL AND counted_at<$2`, [at, midnight]);
    // Newly created approval fixtures live at this same simulated time; only
    // tests that explicitly age an item should create a stale-item nudge.
    await f.run(`ALTER TABLE work_items DISABLE TRIGGER trg_work_items_updated_at`);
    try { await f.run(`UPDATE work_items SET updated_at=$1 WHERE updated_at<$2`, [at, midnight]); }
    finally { await f.run(`ALTER TABLE work_items ENABLE TRIGGER trg_work_items_updated_at`); }
  };
  const wrap = (fn, getNow) => async (...args) => {
    const at = getNow(...args);
    await stamp(at);
    const result = await fn(...args);
    await stamp(at);
    return result;
  };
  const retry = async () => {
    const [r] = await f.run(`SELECT greatest($1::timestamptz + interval '2 hours',max(send_after)+interval '1 second',max(counted_at)+interval '1 hour 1 second') AS at FROM push_outbox`, [awake]);
    const [daytime] = await f.run(`SELECT CASE WHEN extract(hour FROM $1::timestamptz AT TIME ZONE 'America/Chicago')>=21 THEN ((($1::timestamptz AT TIME ZONE 'America/Chicago')::date+1)+time '12:00') AT TIME ZONE 'America/Chicago' WHEN extract(hour FROM $1::timestamptz AT TIME ZONE 'America/Chicago')<7 THEN (($1::timestamptz AT TIME ZONE 'America/Chicago')::date+time '12:00') AT TIME ZONE 'America/Chicago' ELSE $1::timestamptz END AS at`, [r.at]);
    return new Date(daytime.at);
  };
  return { awake, quiet: new Date(awake.getTime()-9*3600000), night: new Date(awake.getTime()+15*3600000), retry,
    notify: fn => wrap(fn, (_, at=awake) => at), drain: fn => wrap(fn, (opts={}) => opts.now??awake) };
}
