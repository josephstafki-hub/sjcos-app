import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { buildCanvasRendererDocument, canvasResponseHeaders, CANVAS_BOOTSTRAP, CANVAS_PREVIEW_BOOTSTRAP, CANVAS_STYLE, CANVAS_IFRAME_SANDBOX, MERMAID_ASSET_PATH, MERMAID_VERSION } from '../lib/canvas-renderer.mjs';
const bundle = 'globalThis.mermaid = Object.freeze({});';
const hash = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const options = { mermaidBundle: bundle, mermaidSha256: hash(bundle) };
const tail = "script-src-attr 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
test('L1 exact CSP authorizes only the bytes of the fixed bootstrap and pinned bundle', () => {
    const { html, headers } = buildCanvasRendererDocument(options);
    assert.equal(headers['Content-Security-Policy'], `sandbox allow-scripts; default-src 'none'; script-src 'sha256-${hash(CANVAS_BOOTSTRAP)}' 'sha256-${hash(bundle)}'; ${tail}`);
    assert.deepEqual([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]), [bundle, CANVAS_BOOTSTRAP]);
    assert.equal(html.match(/<style>([\s\S]*?)<\/style>/)[1], CANVAS_STYLE);
    assert.ok(!html.includes('<script src='));
    assert.equal(MERMAID_VERSION, '12.3.0');
    assert.ok(MERMAID_ASSET_PATH.includes('12.3.0'));
});
test('missing asset, mismatched hash, HTML script-close and caller data fail closed', () => {
    for (const input of [undefined, {}, { ...options, mermaidSha256: hash('wrong') }, { mermaidBundle: '</ScRiPt><img>', mermaidSha256: hash('</ScRiPt><img>') }, { ...options, source: 'SECRET' }, { ...options, mermaidSha256: "x'; connect-src *" }])
        assert.throws(() => buildCanvasRendererDocument(input));
});
test('L2 CSP has only the fixed measurement bridge hash; errors cannot run scripts', () => {
    assert.equal(canvasResponseHeaders('preview')['Content-Security-Policy'], `sandbox allow-scripts; default-src 'none'; script-src 'sha256-${hash(CANVAS_PREVIEW_BOOTSTRAP)}'; ${tail}`);
    assert.equal(canvasResponseHeaders('error')['Content-Security-Policy'], `sandbox; default-src 'none'; script-src 'none'; ${tail}`);
});
test('wrapper and print deny frames without applying DENY to renderer/preview', () => {
    for (const type of ['wrapper', 'print']) {
        const headers = canvasResponseHeaders(type);
        assert.equal(headers['Content-Security-Policy'], "frame-ancestors 'none'");
        assert.equal(headers['X-Frame-Options'], 'DENY');
    }
    for (const type of ['renderer', 'preview', 'error', 'api', 'code']) {
        const headers = canvasResponseHeaders(type, type === 'renderer' ? options : undefined);
        assert.equal(headers['Cache-Control'], 'private, no-store');
        assert.equal(headers['Referrer-Policy'], 'no-referrer');
        assert.equal(headers['X-Content-Type-Options'], 'nosniff');
        assert.ok(!('Access-Control-Allow-Origin' in headers));
        assert.ok(!('Set-Cookie' in headers));
        if (['renderer', 'preview'].includes(type))
            assert.ok(!('X-Frame-Options' in headers));
        assert.ok(!/allow-same-origin|unsafe-eval|https?:|\*|nonce-|report-uri/.test(headers['Content-Security-Policy']));
    }
    assert.equal(canvasResponseHeaders('code')['Content-Type'], 'text/plain; charset=utf-8');
    assert.equal(canvasResponseHeaders('api')['Content-Type'], 'application/json; charset=utf-8');
    assert.throws(() => canvasResponseHeaders('unknown'));
    assert.equal(CANVAS_IFRAME_SANDBOX, 'allow-scripts');
});
test('fixed bridge pins strict Mermaid options and exposes no business or network API', () => {
    assert.match(CANVAS_BOOTSTRAP, /securityLevel: 'strict'/);
    assert.match(CANVAS_BOOTSTRAP, /htmlLabels: false/);
    assert.match(CANVAS_BOOTSTRAP, /maxEdges: 200/);
    assert.match(CANVAS_BOOTSTRAP, /maxTextSize: 32768/);
    for (const script of [CANVAS_BOOTSTRAP, CANVAS_PREVIEW_BOOTSTRAP]) {
        assert.ok(!/<\/script|fetch\(|XMLHttpRequest|sendBeacon|document\.cookie|localStorage|bindFunctions|import\(/i.test(script));
        assert.match(script, /event\.source !== parent/);
        assert.match(script, /event\.ports\.length !== 1/);
        assert.match(script, /nonce/);
    }
});
test('diagram bootstrap enforces its render/dispose protocol (page protocol has its own sandbox tests)', () => {
    for (const script of [CANVAS_BOOTSTRAP]) {
        const listeners = new Map(), announcements = [], messages = [];
        let config = null, cleared = false, closed = false, disconnected = false;
        const parent = { postMessage: (m) => announcements.push(m) };
        const root = { replaceChildren: () => { cleared = true; } };
        const context = { crypto: webcrypto, TextEncoder, performance: { now: () => 0 }, parent, document: { getElementById: () => root, documentElement: { scrollHeight: 9000 } }, mermaid: { initialize: (value) => { config = value; } }, setTimeout: () => 1, clearTimeout: () => { }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name), ResizeObserver: class {
                observe() { }
                disconnect() { disconnected = true; }
            } };
        runInNewContext(script, context, { timeout: 1000 });
        const ready = announcements[0];
        assert.match(ready.instance_id, /^[a-f0-9]{32}$/);
        assert.match(ready.nonce, /^[a-f0-9]{32}$/);
        if (script === CANVAS_BOOTSTRAP) {
            assert.equal(config.securityLevel, 'strict');
            assert.equal(config.flowchart.htmlLabels, false);
            assert.ok(config.secure.includes('secure'));
        }
        else
            assert.equal(config, null);
        const port = { postMessage: m => messages.push(m), start() { }, close() { closed = true; } };
        const data = { type: 'connect', instance_id: ready.instance_id, nonce: ready.nonce };
        const handshake = listeners.get('message');
        for (const event of [{ source: {}, origin: 'https://app.test', ports: [port], data }, { source: parent, origin: 'null', ports: [port], data }, { source: parent, origin: 'https://app.test', ports: [], data }, { source: parent, origin: 'https://app.test', ports: [port], data: { ...data, nonce: 'wrong' } }])
            handshake(event);
        assert.equal(messages.length, 0);
        handshake({ source: parent, origin: 'https://app.test', ports: [port], data });
        assert.equal(listeners.has('message'), false);
        assert.equal(messages[0].type, 'ready');
        assert.equal(messages[1].height, 8192);
        assert.equal(messages[1].overflow, true);
        for (const type of ['save', 'approve', 'navigate', 'tool_call'])
            port.onmessage({ data: { ...ready, type, sequence: 1 } });
        assert.equal(messages.length, 2);
        port.onmessage({ data: { type: 'dispose', instance_id: ready.instance_id, nonce: 'wrong', sequence: 1 } });
        assert.equal(closed, false);
        port.onmessage({ data: { type: 'dispose', instance_id: ready.instance_id, nonce: ready.nonce, sequence: 1 } });
        assert.equal(closed, true);
        assert.equal(cleared, true);
        assert.equal(disconnected, true);
    }
});

test('vendored Mermaid bundle bytes match the pinned digest and build a renderer document', async () => {
    const { readFileSync } = await import('node:fs');
    const { MERMAID_ASSET_SHA256 } = await import('../lib/canvas-renderer.mjs');
    const real = readFileSync(new URL('../' + MERMAID_ASSET_PATH, import.meta.url), 'utf8');
    assert.equal(typeof MERMAID_ASSET_SHA256, 'string');
    assert.equal(hash(real), MERMAID_ASSET_SHA256);
    assert.ok(!/<\/script/i.test(real) && !real.includes('<!--') && !real.includes('sourceMappingURL'));
    const { html, headers } = buildCanvasRendererDocument({ mermaidBundle: real, mermaidSha256: MERMAID_ASSET_SHA256 });
    assert.ok(html.includes(real));
    const csp = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-security-policy')[1];
    assert.ok(csp.includes(`'sha256-${MERMAID_ASSET_SHA256}'`));
    assert.ok(!csp.includes('allow-same-origin'));
});
