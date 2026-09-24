// Hermes gateway runner for operating-agent runs (A24, optional).
//
// Same POST shape as lib/dev-agents.ts hermesChat (OpenAI-style
// /v1/chat/completions, streamed). The instruction block rides as a system
// message; tool progress events become the trace. Hermes reaches SJC OS
// through its OWN MCP registration (production), so this runner cannot point
// it at a harness database — evaluations use the Claude runner. Guarded: an
// unreachable gateway returns { ok:false, error } instead of throwing.

import { readFile } from "node:fs/promises";
import http from "node:http";

async function config() {
  let url = process.env.HERMES_AGENT_URL;
  let key = process.env.HERMES_AGENT_KEY;
  if (!url || !key) {
    let dotenv = "";
    try {
      dotenv = await readFile(`${process.env.HOME}/.hermes/.env`, "utf8");
    } catch {
      /* rely on env */
    }
    const val = (k) => {
      const m = dotenv.match(new RegExp(`^${k}=(.*)$`, "m"));
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
    };
    if (!url) url = `http://${val("API_SERVER_HOST") ?? "127.0.0.1"}:${val("API_SERVER_PORT") ?? "8642"}`;
    if (!key) key = val("API_SERVER_KEY") ?? val("HERMES_API_KEY");
  }
  if (!key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

export async function runHermesBusiness({ prompt, systemBlock, timeoutMs = 8 * 60 * 1000, model = process.env.HERMES_MODEL ?? "hermes-agent", sessionKey = "sjcos-business-agent" }) {
  const startedAt = Date.now();
  const cfg = await config();
  if (!cfg) return { ok: false, error: "Hermes gateway not configured (no API key)", trace: [], toolNames: [], resultText: "", durationMs: 0, costUsd: null, numTurns: null, model };
  const body = JSON.stringify({
    model,
    stream: true,
    messages: [
      { role: "system", content: systemBlock },
      { role: "user", content: prompt },
    ],
  });
  const trace = [];
  let answer = "";
  try {
    await new Promise((resolve, reject) => {
      const u = new URL(`${cfg.url}/v1/chat/completions`);
      const req = http.request(
        { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}`, "X-Hermes-Session-Key": sessionKey, "Content-Length": Buffer.byteLength(body) }, timeout: timeoutMs },
        (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Hermes HTTP ${res.statusCode}`));
            res.resume();
            return;
          }
          let buf = "";
          let event = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            buf += chunk;
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).replace(/\r$/, "");
              buf = buf.slice(nl + 1);
              if (line.startsWith("event:")) {
                event = line.slice(6).trim();
                continue;
              }
              if (!line.startsWith("data:")) {
                if (line === "") event = "";
                continue;
              }
              const data = line.slice(5).trim();
              if (data === "[DONE]") continue;
              let obj;
              try {
                obj = JSON.parse(data);
              } catch {
                continue;
              }
              if (event === "hermes.tool.progress") {
                if (obj.status === "started" || obj.status === "start") trace.push({ seq: trace.length + 1, tool: String(obj.tool ?? "?"), input: obj.args ?? null, result: null, is_error: false, at: new Date().toISOString() });
                event = "";
                continue;
              }
              const delta = obj.choices?.[0]?.delta?.content;
              if (typeof delta === "string") answer += delta;
            }
          });
          res.on("end", resolve);
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("TIMEOUT")));
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  } catch (err) {
    return { ok: false, error: `Hermes unreachable: ${err.message}`, trace, toolNames: [], resultText: answer, durationMs: Date.now() - startedAt, costUsd: null, numTurns: null, model };
  }
  return { ok: !!answer.trim(), error: answer.trim() ? null : "Hermes returned an empty response", trace, toolNames: [], toolListChecksum: null, resultText: answer.trim(), durationMs: Date.now() - startedAt, costUsd: null, numTurns: null, model, sessionId: null };
}
