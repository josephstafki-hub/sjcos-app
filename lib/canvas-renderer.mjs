import { createHash } from 'node:crypto';
import { createCanvasContentValidator } from './canvas-content.mjs';
export const MERMAID_VERSION = '12.3.0';
// TODO coordinator: package the verified standalone distribution at this SERVER-ONLY
// path (or resolve your own path). Read once, verify package integrity, then pass the
// exact UTF-8 bundle + its reviewed SHA-256 base64 digest. Never make this a script src.
export const MERMAID_ASSET_PATH = 'renderer-assets/mermaid-12.3.0.min.js';
export const MERMAID_ASSET_SHA256 = null; // Intentionally no invented digest or fallback.
export const CANVAS_IFRAME_SANDBOX = 'allow-scripts';
export const CANVAS_STYLE = ':root{color-scheme:light;font-family:system-ui,sans-serif;color:#172033;background:#fff}body{margin:0;padding:16px}svg{max-width:100%;height:auto;display:block}';
/** Runs only in the opaque child. The parent must additionally check the exact current
 * WindowProxy, null origin, instance ID and 128-bit nonce, then transfer ONE port.
 * There is deliberately no global command handler after the one-shot handshake.
 */
function bridgeMain(mode, makeValidator) {
    'use strict';
    const gates = makeValidator();
    const id = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
    const instance_id = id(), nonce = id();
    let port = null, sequence = 0, busy = false, disposed = false, lastHeight = -Infinity, lastMessage = -Infinity;
    let renderedOnce = false;
    let canvas_id = null, version = null;
    const pending = setTimeout(dispose, 10000);
    let observer = null;
    function dispose() { disposed = true; clearTimeout(pending); observer?.disconnect(); port?.close(); port = null; document.getElementById('canvas-root')?.replaceChildren(); }
    function send(type, extra = {}) { if (!disposed && port)
        port.postMessage({ type, instance_id, nonce, sequence, ...extra }); }
    function measure() {
        const now = performance.now();
        if (now - lastHeight < 200)
            return;
        lastHeight = now;
        send('height', { height: Math.min(8192, Math.max(0, Math.ceil(document.documentElement.scrollHeight))), overflow: document.documentElement.scrollHeight > 8192 });
    }
    // Parse as inert XML, translate ONLY the fixed theme, then independently validate
    // and reconstruct it with the same server SVG grammar. No upstream CSS survives.
    function drawing(raw) {
        if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 524288)
            throw new Error();
        const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
        if (doc.querySelector('parsererror') || doc.doctype || doc.documentElement.localName !== 'svg')
            throw new Error();
        const root = doc.documentElement;
        const all = [root, ...root.querySelectorAll('*')];
        if (all.length > 10000)
            throw new Error();
        const palette = { node: { fill: '#eef2ff', stroke: '#64748b' }, cluster: { fill: '#f8fafc', stroke: '#94a3b8' }, label: { fill: '#172033' }, edgeLabel: { fill: '#172033' }, 'edge-pattern-solid': { stroke: '#475569' }, 'edge-thickness-normal': { 'stroke-width': '1.5' } };
        const attrs = new Set(['id', 'xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill', 'stroke', 'color', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'dx', 'dy', 'marker-start', 'marker-mid', 'marker-end', 'clip-path', 'refX', 'refY', 'markerWidth', 'markerHeight', 'orient', 'markerUnits', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset', 'stop-color', 'stop-opacity', 'clipPathUnits', 'fx', 'fy', 'fr', 'textLength', 'lengthAdjust', 'pathLength', 'role', 'aria-label']);
        for (const element of all) {
            if (element.namespaceURI !== 'http://www.w3.org/2000/svg')
                throw new Error();
            if (element.localName === 'style') {
                element.remove();
                continue;
            }
            if (!['svg', 'g', 'defs', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'marker'].includes(element.localName))
                throw new Error();
            const classes = (element.getAttribute('class') || '').split(/\s+/);
            for (const attribute of [...element.attributes]) {
                if (/^on/i.test(attribute.name) || /href|src/i.test(attribute.name))
                    throw new Error();
                if (attribute.name === 'style') {
                    // Mermaid-generated presentation declarations only; no CSS parsing/URLs
                    // from the source. Layout-only CSS is discarded along with the stylesheet.
                    if (/url\s*\(|@|\\|expression|javascript/i.test(attribute.value))
                        throw new Error();
                    element.removeAttribute('style');
                    continue;
                }
                if (!attrs.has(attribute.name))
                    element.removeAttribute(attribute.name);
            }
            for (const name of classes)
                for (const [attr, value] of Object.entries(palette[name] || {}))
                    element.setAttribute(attr, value);
            if (['text', 'tspan'].includes(element.localName)) {
                element.setAttribute('font-family', 'system-ui');
                element.setAttribute('fill', '#172033');
            }
            if (element.localName === 'path' && !element.hasAttribute('fill'))
                element.setAttribute('fill', 'none');
        }
        const canonical = gates.validateCanvasSvg(new XMLSerializer().serializeToString(root));
        // Re-prefix all canonical IDs for this render; no cross-render fragment references.
        const svg = canonical.svg.replace(/(id="|url\(#)canvas-(\d+)/g, (_, lead, n) => lead + 'canvas-' + instance_id + '-' + sequence + '-' + n);
        if (new TextEncoder().encode(svg).length > 524288)
            throw new Error();
        return svg;
    }
    async function render(message) {
        try {
            const source = gates.validateDiagramSource(message.source);
            const diagram = await mermaid.mermaidAPI.getDiagramFromText(source.source);
            // Pinned-parser/model preflight. Unknown upstream DB shape fails closed; the
            // coordinator must exercise these accessors against all three 12.3.0 families.
            const db = diagram.db;
            const collectionSize = (value) => value instanceof Map ? value.size : Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : NaN;
            let nodeCount, edgeCount;
            if (source.family === 'flowchart') {
                nodeCount = collectionSize(db.getVertices());
                edgeCount = collectionSize(db.getEdges());
            }
            else if (source.family === 'sequence') {
                nodeCount = collectionSize(db.getActors());
                edgeCount = collectionSize(db.getMessages());
            }
            else {
                nodeCount = collectionSize(db.getStates());
                edgeCount = collectionSize(db.getRelations());
            }
            if (!Number.isFinite(nodeCount) || !Number.isFinite(edgeCount) || nodeCount > 100 || edgeCount > (source.family === 'flowchart' ? 200 : 400))
                throw new Error();
            const result = await mermaid.render('canvas-' + instance_id + '-' + sequence, source.source);
            if (disposed)
                return;
            const svg = drawing(result.svg);
            const safeDoc = new DOMParser().parseFromString(svg, 'image/svg+xml');
            const root = document.getElementById('canvas-root');
            root.replaceChildren(document.importNode(safeDoc.documentElement, true));
            const box = root.firstElementChild.getBoundingClientRect();
            if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width > 8192 || box.height > 8192)
                throw new Error();
            send('rendered', { canvas_id, version, sequence: message.sequence, svg, width: box.width, height: box.height });
            measure();
        }
        catch {
            if (!disposed) {
                document.getElementById('canvas-root').replaceChildren();
                send('error', { sequence: message.sequence, code: 'RENDER_FAILED' });
            }
        }
        finally {
            busy = false;
        }
    }
    function receive(event) {
        const message = event.data;
        if (disposed || !message || typeof message !== 'object' || Array.isArray(message) || message.instance_id !== instance_id || message.nonce !== nonce || !Number.isSafeInteger(message.sequence) || message.sequence !== sequence + 1)
            return;
        const now = performance.now();
        if (now - lastMessage < 200)
            return;
        if (message.type === 'dispose' && Object.keys(message).every(k => ['type', 'instance_id', 'nonce', 'sequence'].includes(k))) {
            dispose();
            return;
        }
        if (message.type === 'measure' && Object.keys(message).every(k => ['type', 'instance_id', 'nonce', 'sequence'].includes(k))) {
            sequence = message.sequence;
            lastMessage = now;
            measure();
            return;
        }
        if (mode !== 'diagram' || busy || renderedOnce || message.type !== 'render' || Object.keys(message).some(k => !['type', 'instance_id', 'nonce', 'sequence', 'canvas_id', 'version', 'source'].includes(k)) || typeof message.canvas_id !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(message.canvas_id) || !Number.isSafeInteger(message.version) || message.version < 1 || typeof message.source !== 'string' || new TextEncoder().encode(message.source).length > 32768)
            return;
        sequence = message.sequence;
        lastMessage = now;
        canvas_id = message.canvas_id;
        version = message.version;
        busy = true;
        renderedOnce = true;
        void render(message);
    }
    function handshake(event) {
        if (event.source !== parent || event.origin === 'null' || port || disposed || event.ports.length !== 1)
            return;
        const message = event.data;
        if (!message || message.type !== 'connect' || message.instance_id !== instance_id || message.nonce !== nonce || Object.keys(message).some(k => !['type', 'instance_id', 'nonce'].includes(k)))
            return;
        clearTimeout(pending);
        removeEventListener('message', handshake);
        port = event.ports[0];
        port.onmessage = receive;
        port.start();
        send('ready');
        measure();
    }
    if (mode === 'diagram') {
        try {
            mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, suppressErrorRendering: true, maxTextSize: 32768, maxEdges: 200, theme: 'base', fontFamily: 'system-ui', themeCSS: '', layout: 'dagre', flowchart: { htmlLabels: false }, themeVariables: { primaryColor: '#eef2ff', primaryTextColor: '#172033', primaryBorderColor: '#64748b', lineColor: '#475569', fontFamily: 'system-ui' }, secure: ['securityLevel', 'startOnLoad', 'suppressErrorRendering', 'maxTextSize', 'maxEdges', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'layout', 'htmlLabels', 'flowchart', 'secure'] });
        }
        catch {
            dispose();
            return;
        }
    }
    addEventListener('message', handshake);
    addEventListener('pagehide', dispose, { once: true });
    addEventListener('keydown', event => { if (event.key === 'Escape')
        send('escape'); });
    addEventListener('focusin', () => send('focus', { focused: true }));
    addEventListener('focusout', () => send('focus', { focused: false }));
    observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    parent.postMessage({ type: 'canvas-ready', instance_id, nonce }, '*');
}
// Both strings are source-independent. Changes invalidate their exact CSP hashes.
export const CANVAS_BOOTSTRAP = `(${bridgeMain.toString()})('diagram',${createCanvasContentValidator.toString()});`;
export const CANVAS_PREVIEW_BOOTSTRAP = `(${bridgeMain.toString()})('page',${createCanvasContentValidator.toString()});`;
const digest = (text) => createHash('sha256').update(text, 'utf8').digest('base64');
export const CANVAS_BOOTSTRAP_SHA256 = digest(CANVAS_BOOTSTRAP);
export const CANVAS_PREVIEW_BOOTSTRAP_SHA256 = digest(CANVAS_PREVIEW_BOOTSTRAP);
export const CANVAS_STYLE_SHA256 = digest(CANVAS_STYLE);
const POLICY_TAIL = "script-src-attr 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
export const CANVAS_PREVIEW_CSP = `sandbox allow-scripts; default-src 'none'; script-src 'sha256-${CANVAS_PREVIEW_BOOTSTRAP_SHA256}'; ${POLICY_TAIL}`;
export const CANVAS_ERROR_CSP = `sandbox; default-src 'none'; script-src 'none'; ${POLICY_TAIL}`;
export const CANVAS_PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), clipboard-read=(), clipboard-write=(), display-capture=(), fullscreen=()';
function checkedAsset(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['mermaidBundle', 'mermaidSha256'].includes(k)) || typeof options.mermaidBundle !== 'string' || !options.mermaidBundle || typeof options.mermaidSha256 !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(options.mermaidSha256) || digest(options.mermaidBundle) !== options.mermaidSha256)
        throw new TypeError('Verified Mermaid asset and SHA-256 digest required.');
    for (const script of [options.mermaidBundle, CANVAS_BOOTSTRAP, CANVAS_PREVIEW_BOOTSTRAP])
        if (/<\/script/i.test(script) || /<!--/.test(script) || /\bimport\s*\(/.test(script) || /sourceMappingURL\s*=/.test(script))
            throw new TypeError('Renderer script packaging rejected.');
    return options;
}
export function canvasResponseHeaders(type, options) {
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (type === 'wrapper' || type === 'print')
        return { ...headers, 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY' };
    let csp = CANVAS_ERROR_CSP;
    if (type === 'renderer') {
        const asset = checkedAsset(options);
        csp = `sandbox allow-scripts; default-src 'none'; script-src 'sha256-${CANVAS_BOOTSTRAP_SHA256}' 'sha256-${asset.mermaidSha256}'; ${POLICY_TAIL}`;
    }
    else if (type === 'preview')
        csp = CANVAS_PREVIEW_CSP;
    else if (type === 'api')
        headers['Content-Type'] = 'application/json; charset=utf-8';
    else if (type === 'code')
        headers['Content-Type'] = 'text/plain; charset=utf-8';
    else if (type !== 'error')
        throw new TypeError('Unknown canvas response type.');
    return { ...headers, 'Content-Security-Policy': csp, 'Permissions-Policy': CANVAS_PERMISSIONS_POLICY };
}
export function buildCanvasRendererDocument(options) {
    const asset = checkedAsset(options);
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Canvas</title><style>' + CANVAS_STYLE + '</style></head><body><main id="canvas-root" aria-label="Diagram"></main><script>' + asset.mermaidBundle + '</script><script>' + CANVAS_BOOTSTRAP + '</script></body></html>';
    return { html, headers: canvasResponseHeaders('renderer', asset), hashes: { bootstrap: CANVAS_BOOTSTRAP_SHA256, mermaid: asset.mermaidSha256, style: CANVAS_STYLE_SHA256 } };
}
