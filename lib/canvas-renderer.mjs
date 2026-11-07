import { createHash } from 'node:crypto';
import { validatePageSource, createCanvasContentValidator } from './canvas-content.mjs';
export const MERMAID_VERSION = '12.3.0';
// TODO coordinator: package the verified standalone distribution at this SERVER-ONLY
// path (or resolve your own path). Read once, verify package integrity, then pass the
// exact UTF-8 bundle + its reviewed SHA-256 base64 digest. Never make this a script src.
export const MERMAID_ASSET_PATH = 'renderer-assets/mermaid-12.3.0.min.js';
// Pinned 2026-11-05 by the coordinator over the reviewed bytes of renderer-assets/mermaid-12.3.0.min.js (see renderer-assets/README.md).
export const MERMAID_ASSET_SHA256 = 'O7YtQ7scm1a5PiqMsp3oLImchSSI9PwMR5h0OQtjSjk=';
export const CANVAS_IFRAME_SANDBOX = 'allow-scripts';
export const CANVAS_STYLE = ':root{color-scheme:light;font-family:system-ui,sans-serif;color:#2c3326;background:#fbfaf4}body{margin:0;padding:16px}svg{max-width:100%;height:auto;display:block}';
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
        const complex = () => { throw Object.assign(new Error(), { code: 'TOO_COMPLEX' }); };
        if (typeof raw !== 'string') throw new Error();
        if (new TextEncoder().encode(raw).length > 524288) complex();
        const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
        if (doc.querySelector('parsererror') || doc.doctype || doc.documentElement.localName !== 'svg')
            throw new Error();
        const root = doc.documentElement;
        // Mermaid's responsive SVG uses width="100%" (and sometimes no height).
        // Our drawing grammar deliberately accepts numeric dimensions only. Adopt
        // the intrinsic viewBox size, then let the independent gate bound it.
        const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/);
        const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
        if (viewBox.length !== 4 || viewBox.some(n => !number.test(n) || !Number.isFinite(Number(n))) || Number(viewBox[2]) <= 0 || Number(viewBox[3]) <= 0)
            throw new Error();
        if (viewBox.some(n => Math.abs(Number(n)) > 8192)) complex();
        root.setAttribute('width', viewBox[2]);
        root.setAttribute('height', viewBox[3]);
        // Mermaid supplies an ARIA 1.0 fallback role. Keep the supported SVG role.
        if (root.getAttribute('role') === 'graphics-document document')
            root.setAttribute('role', 'graphics-document');
        root.setAttribute('font-size', '16');
        // Mermaid 12.3.0 adds decorative, unreferenced extras that are outside the
        // drawing grammar: drop shadows (<filter><feDropShadow/></filter> plus
        // filter="url(#…)"), an unused <linearGradient> with % coordinates and hsl()
        // stops, and unused <symbol> icon definitions in sequence diagrams. Remove
        // whole subtrees and filter references before the allow-list pass; never
        // admit them. Anything that still references a removed id then fails the
        // shared gate (fail closed).
        for (const element of [...root.querySelectorAll('*')]) {
            if (['filter', 'linearGradient', 'radialGradient', 'symbol'].includes(element.localName))
                element.remove();
            else if (element.hasAttribute('filter'))
                element.removeAttribute('filter');
        }
        const all = [root, ...root.querySelectorAll('*')];
        if (all.length > 10000) complex();
        const paper = { fill: '#fbfaf4', stroke: '#5f6454' };
        const edge = { fill: 'none', stroke: '#5b7e72' };
        const marker = { fill: '#5b7e72', stroke: '#5b7e72' };
        const palette = {
            node: paper, cluster: paper, actor: paper, note: paper, 'state-note': paper,
            'statediagram-note': paper, labelBox: paper, background: { fill: '#fbfaf4', stroke: 'none' },
            label: { fill: '#2c3326' }, edgeLabel: { fill: '#2c3326' }, messageText: { fill: '#2c3326' },
            'edge-pattern-solid': edge, 'edge-pattern-dashed': { ...edge, 'stroke-dasharray': '3 3' },
            'edge-pattern-dotted': { ...edge, 'stroke-dasharray': '2 3' },
            'edge-thickness-normal': { 'stroke-width': '1.5' },
            'actor-line': edge, messageLine0: edge, messageLine1: { ...edge, 'stroke-dasharray': '3 3' },
            loopLine: { ...edge, 'stroke-width': '2', 'stroke-dasharray': '2 2' },
            'note-edge': { ...edge, 'stroke-dasharray': '5 5' },
            arrowheadPath: marker, arrowMarkerPath: marker, 'state-start': marker, 'state-end': marker,
        };
        // Snapshot approved class selectors before stripping attributes. Never evaluate
        // upstream CSS; these are the pinned theme's drawing semantics only.
        const markerShapes = new Set(root.querySelectorAll('marker path,marker polygon,marker circle,marker polyline'));
        const centeredLabels = new Set(root.querySelectorAll('.flowchart .node .label text,.flowchart .cluster-label text'));
        const presentationEnums = {
            'text-anchor': ['start', 'middle', 'end'],
            'dominant-baseline': ['auto', 'middle', 'central', 'alphabetic', 'text-before-edge', 'hanging'],
            'alignment-baseline': ['auto', 'middle', 'central', 'baseline', 'alphabetic'],
            'font-weight': ['normal', 'bold', '400', '500', '600', '700'],
            'font-style': ['normal', 'italic'],
        };
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
                    // Translate only finite presentation properties, never CSS rules or URLs.
                    if (/url\s*\(|@|\\|expression|javascript/i.test(attribute.value))
                        throw new Error();
                    for (const declaration of attribute.value.split(';')) {
                        const part = declaration.trim().match(/^([a-z-]+)\s*:\s*(.*?)\s*$/i);
                        if (!part) continue;
                        const [, name, value] = part;
                        if (Object.hasOwn(presentationEnums, name)) {
                            if (!presentationEnums[name].includes(value)) throw new Error();
                            element.setAttribute(name, value);
                        }
                        if (name === 'font-size') {
                            const size = /^(10|12|14|16|18|20|24|32)(?:px)?$/.exec(value);
                            if (!size) throw new Error();
                            element.setAttribute(name, size[1]);
                        }
                    }
                    element.removeAttribute('style');
                    continue;
                }
                if (!attrs.has(attribute.name)) {
                    element.removeAttribute(attribute.name);
                    continue;
                }
                // The shared gate admits width/height only on <svg> and <rect>; Mermaid
                // also emits them on state-diagram start/end circles.
                if ((attribute.name === 'width' || attribute.name === 'height') && !['svg', 'rect'].includes(element.localName)) {
                    element.removeAttribute(attribute.name);
                    continue;
                }
                // Sequence diagrams use unit lengths (stroke-width="1pt"). Keep the gate's
                // plain-number grammar: convert pt/px to user units, drop anything else.
                if (attribute.name === 'stroke-width' && !number.test(attribute.value)) {
                    const unit = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(pt|px)$/.exec(attribute.value.trim());
                    if (unit)
                        element.setAttribute('stroke-width', String(Number(unit[1]) * (unit[2] === 'pt' ? 4 / 3 : 1)));
                    else
                        element.removeAttribute('stroke-width');
                }
            }
            for (const name of classes)
                for (const [attr, value] of Object.entries(palette[name] || {}))
                    element.setAttribute(attr, value);
            if (markerShapes.has(element))
                for (const [attr, value] of Object.entries(marker)) element.setAttribute(attr, value);
            if (centeredLabels.has(element)) element.setAttribute('text-anchor', 'middle');
            if (['text', 'tspan'].includes(element.localName)) {
                element.setAttribute('font-family', 'system-ui');
                element.setAttribute('fill', '#2c3326');
                element.setAttribute('stroke', 'none');
                // The pinned non-HTML label renderer emits y/dy in em. Preserve
                // those offsets at the inherited, allowlisted font size. No CSS
                // lengths enter the independent server/shared SVG grammar.
                let ancestor = element, fontSize = 16;
                while (ancestor) {
                    if (ancestor.hasAttribute('font-size')) { fontSize = Number(ancestor.getAttribute('font-size')); break; }
                    ancestor = ancestor.parentElement;
                }
                for (const attr of ['x', 'y', 'dx', 'dy']) {
                    const value = element.getAttribute(attr);
                    if (value?.endsWith('em') && number.test(value.slice(0, -2)))
                        element.setAttribute(attr, String(Number(value.slice(0, -2)) * fontSize));
                }
            }
            if (element.localName === 'path' && !element.hasAttribute('fill'))
                element.setAttribute('fill', 'none');
        }
        const canonical = gates.validateCanvasSvg(new XMLSerializer().serializeToString(root));
        // Re-prefix all canonical IDs for this render; no cross-render fragment references.
        const svg = canonical.svg.replace(/(id="|url\(#)canvas-(\d+)/g, (_, lead, n) => lead + 'canvas-' + instance_id + '-' + sequence + '-' + n);
        if (new TextEncoder().encode(svg).length > 524288) complex();
        return svg;
    }
    async function render(message) {
        let diagnostic = 'SOURCE_REJECTED';
        try {
            const source = gates.validateDiagramSource(message.source);
            diagnostic = 'SYNTAX_ERROR';
            const diagram = await mermaid.mermaidAPI.getDiagramFromText(source.source);
            // Pinned-parser/model preflight. Unknown upstream DB shape fails closed; the
            // coordinator must exercise these accessors against all three 12.3.0 families.
            diagnostic = 'LAYOUT_FAILED';
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
            if (!Number.isFinite(nodeCount) || !Number.isFinite(edgeCount)) throw new Error();
            if (nodeCount > 100 || edgeCount > (source.family === 'flowchart' ? 200 : 400))
                throw Object.assign(new Error(), { code: 'TOO_COMPLEX' });
            const result = await mermaid.render('canvas-' + instance_id + '-' + sequence, source.source);
            if (disposed)
                return;
            diagnostic = 'DRAWING_REJECTED';
            const svg = drawing(result.svg);
            const safeDoc = new DOMParser().parseFromString(svg, 'image/svg+xml');
            const root = document.getElementById('canvas-root');
            root.replaceChildren(document.importNode(safeDoc.documentElement, true));
            const box = root.firstElementChild.getBoundingClientRect();
            if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) throw new Error();
            if (box.width > 8192 || box.height > 8192) throw Object.assign(new Error(), { code: 'TOO_COMPLEX' });
            send('rendered', { canvas_id, version, sequence: message.sequence, svg, width: box.width, height: box.height });
            measure();
        }
        catch (error) {
            if (!disposed) {
                document.getElementById('canvas-root').replaceChildren();
                send('error', { sequence: message.sequence, code: ['TOO_COMPLEX', 'CONTENT_TOO_LARGE'].includes(error?.code) ? 'TOO_COMPLEX' : 'RENDER_FAILED', diagnostic });
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
            mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, suppressErrorRendering: true, maxTextSize: 32768, maxEdges: 200, theme: 'base', fontFamily: 'system-ui', themeCSS: '', layout: 'dagre', flowchart: { htmlLabels: false }, themeVariables: { background: '#fbfaf4', primaryColor: '#fbfaf4', primaryTextColor: '#2c3326', primaryBorderColor: '#5f6454', secondaryColor: '#fbfaf4', tertiaryColor: '#fbfaf4', noteBkgColor: '#fbfaf4', noteTextColor: '#2c3326', noteBorderColor: '#5f6454', actorBkg: '#fbfaf4', actorTextColor: '#2c3326', actorBorder: '#5f6454', signalColor: '#5b7e72', signalTextColor: '#2c3326', lineColor: '#5b7e72', fontFamily: 'system-ui' }, secure: ['securityLevel', 'startOnLoad', 'suppressErrorRendering', 'maxTextSize', 'maxEdges', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'layout', 'htmlLabels', 'flowchart', 'secure'] });
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
// Page bridge is a fixed measurement/focus protocol; content never enters this function.
function pageBridgeMain() {
    'use strict';
    const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
    const instance_id=token(),nonce=token();let port=null,last=-Infinity,observer,trailing;
    const timer=setTimeout(dispose,10000);
    function dispose(){clearTimeout(timer);clearTimeout(trailing);observer?.disconnect();port?.close();port=null;removeEventListener('message',connect);}
    function send(type,extra={}){port?.postMessage({type,instance_id,nonce,sequence:0,...extra});}
    // The body is a flow root with no margins/min-height: its box measures
    // content, independent of the iframe viewport, and includes floats/padding.
    function report(type='height',extra={}){if(!port)return;clearTimeout(trailing);trailing=undefined;last=performance.now();const h=document.body.getBoundingClientRect().height;send(type,{height:Math.min(8192,Math.max(200,Math.ceil(h))),overflow:h>8192,...extra});}
    function measure(){if(!port)return;const remaining=200-(performance.now()-last);if(remaining>0){if(trailing===undefined)trailing=setTimeout(()=>report(),remaining);return;}report();}
    function connect(event){const m=event.data;
        if(port||event.source !== parent||event.origin==='null'||!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).sort().join(',')!=='instance_id,nonce,type'||m.type!=='connect'||m.instance_id!==instance_id||m.nonce!==nonce||event.ports.length !== 1)return;
        port=event.ports[0];clearTimeout(timer);removeEventListener('message',connect);
        port.onmessage=event=>{const m=event.data;if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).sort().join(',')!=='instance_id,layout_id,nonce,print,sequence,type'||m.type!=='print-layout'||m.instance_id!==instance_id||m.nonce!==nonce||m.sequence!==1||typeof m.print!=='boolean'||!Number.isSafeInteger(m.layout_id)||m.layout_id<1)return;document.documentElement.setAttribute('data-print',String(m.print));report('print-height',{layout_id:m.layout_id});};
        port.start();send('ready');report();
    }
    addEventListener('message',connect);
    addEventListener('pagehide',dispose,{once:true});
    addEventListener('error',()=>send('error',{code:'LOAD_FAILED'}));
    addEventListener('keydown',e=>{if(e.key==='Escape')send('escape');if(e.key==='Tab'){e.preventDefault();send('boundary',{backward:e.shiftKey});}});
    addEventListener('focusin',()=>send('focus',{focused:true}));addEventListener('focusout',()=>send('focus',{focused:false}));
    observer=new ResizeObserver(measure);observer.observe(document.documentElement);
    parent.postMessage({type:'canvas-ready',instance_id,nonce},'*');
}

// Both strings are source-independent. Changes invalidate their exact CSP hashes.
export const CANVAS_BOOTSTRAP = `(${bridgeMain.toString()})('diagram',${createCanvasContentValidator.toString()});`;
export const CANVAS_PREVIEW_BOOTSTRAP = `(${pageBridgeMain.toString()})();`;
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

export const CANVAS_PAGE_STYLE = CANVAS_STYLE+'*{box-sizing:border-box}body{display:flow-root;height:auto;min-height:0;overflow-wrap:break-word}table{max-width:100%}th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd}html[data-print="true"] body{padding:0;overflow:visible}html[data-print="true"] tr{break-inside:avoid}@media print{body{padding:0}h1,h2,h3{break-after:avoid}tr,svg{break-inside:avoid}}';
const escapePage = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export const CANVAS_PAGE_FILE_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
function pageDocument(source,title,head,tail,caption=''){
 const page=validatePageSource(source);
 return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+head+'<meta name="viewport" content="width=device-width, initial-scale=1"><title>'+escapePage(title)+'</title><style>'+CANVAS_PAGE_STYLE+'</style></head><body>'+caption+page.source+tail+'</body></html>';
}
export function buildCanvasPageDocument(source){return {html:pageDocument(source,'Canvas page','', '<script>'+CANVAS_PREVIEW_BOOTSTRAP+'</script>'),headers:canvasResponseHeaders('preview')};}
export function buildCanvasPageFile(source,title,version,summary='',created_at=''){return pageDocument(source,title+' · Version '+version,'<meta http-equiv="Content-Security-Policy" content="'+escapePage(CANVAS_PAGE_FILE_CSP)+'">','', '<header><h1>'+escapePage(title)+'</h1><p>Made by Claude · Version '+version+' · Internal draft</p><p>'+escapePage(created_at instanceof Date?created_at.toISOString():created_at)+'</p><p>'+escapePage(summary)+'</p></header>');}
