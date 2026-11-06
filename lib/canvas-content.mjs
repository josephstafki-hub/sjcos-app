/** Dependency-free, fail-closed Phase 1 grammar. This is NOT the full Mermaid grammar.
 * Source validation is an early ceiling; renderer/parser and SVG gates remain mandatory.
 * The factory is self-contained so the identical gates can run inside the opaque frame.
 */
export function createCanvasContentValidator() {
    const limits = Object.freeze({ page_bytes: 262144, diagram_bytes: 32768, nodes: 100, edges: 200, diagram_depth: 12, statements: 400, svg_bytes: 524288, elements: 10000, svg_depth: 32, path_units: 100000, dimension: 8192 });
    const messages = { INVALID_INPUT: 'Invalid canvas input.', UNSUPPORTED_KIND: 'Canvas kind is not supported.', UNSAFE_CONTENT: 'Canvas content is not allowed.', CONTENT_TOO_LARGE: 'Canvas content is too large.', TOO_COMPLEX: 'Canvas content is too complex.' };
    class ContentError extends Error {
        constructor(code, details) { super(messages[code]); this.name = 'CanvasContentError'; this.code = code; this.retryable = false; this.details = details; this.status = ({ INVALID_INPUT: 400, UNSUPPORTED_KIND: 422, UNSAFE_CONTENT: 422, CONTENT_TOO_LARGE: 413, TOO_COMPLEX: 422 })[code]; }
        toJSON() { return { ok: false, code: this.code, message: this.message, retryable: false, ...(this.details ? { details: this.details } : {}) }; }
    }
    const fail = (code, details) => { throw new ContentError(code, details); };
    const unsafe = (rule) => fail('UNSAFE_CONTENT', { rule });
    const bytes = (s) => new TextEncoder().encode(s).length;
    const wellFormed = (s) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);
    function boundedSource(source, max) {
        if (typeof source !== 'string' || !source.trim() || !wellFormed(source))
            fail('INVALID_INPUT', { fields: ['source'] });
        const count = bytes(source);
        if (count > max)
            fail('CONTENT_TOO_LARGE', { max_bytes: max, received_bytes: count });
        return source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    }
    // Decode only for detection, never to change stored source. Repeated encodings fail
    // closed after a bounded number of passes. Mermaid also has #decimal; entities.
    function securityText(source) {
        let text = source;
        const named = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n' };
        for (let pass = 0; pass < 12; pass++) {
            const next = text.replace(/%([\da-f]{2})/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
                .replace(/&#(x[\da-f]+|\d+);?|#(x[\da-f]+|\d+);/gi, (_, html, mermaid) => { const n = html ?? mermaid; const v = /^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n); return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : '\0'; })
                .replace(/[&#](lt|gt|amp|quot|apos|colon|tab|newline);/gi, (_, n) => named[n.toLowerCase()])
                .replace(/\\([\da-f]{1,6})\s?/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)));
            if (next === text)
                return text;
            text = next;
        }
        unsafe('ENCODING');
    }
    function sourceSafety(source) {
        const decoded = securityText(source);
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(decoded))
            unsafe('CONTROL_CHARACTER');
        if (/^[ \t]*---(?:[ \t]*$|[ \t]*\n)/m.test(decoded) || /%%\s*\{/i.test(decoded))
            unsafe('AUTHOR_CONFIG');
        if (/<\s*(?:\/?[a-z!]|\?)/i.test(decoded))
            unsafe('HTML');
        if (/(?:javascript|vbscript|data)\s*:/i.test(decoded.replace(/[\s\u200B-\u200F\uFEFF]/gu, '')))
            unsafe('URL');
        if (/\burl\s*\(|@\s*import\b|\b(?:image-set|expression)\s*\(/i.test(decoded))
            unsafe('CSS');
        if (/!?\[[^\]\n]*\]\s*\([^\n)]*\)/.test(decoded))
            unsafe('LINK');
        if (/\b(?:fa[brs]?:fa-|https?:\/\/|ftp:\/\/)|@\s*\{/i.test(decoded))
            unsafe('RESOURCE');
        if (/\\(?!")/.test(source))
            unsafe('ESCAPE');
    }
    function statements(source, family) {
        const out = [];
        let current = '', quoted = false;
        const stack = [];
        const pairs = { ']': '[', ')': '(', '}': '{' };
        for (let i = 0; i < source.length; i++) {
            const c = source[i];
            if (c === '"' && source[i - 1] !== '\\')
                quoted = !quoted;
            if (!quoted) {
                if (c === '%' && source[i + 1] === '%') {
                    while (i < source.length && source[i] !== '\n')
                        i++;
                    if (current.trim())
                        out.push(current.trim());
                    current = '';
                    continue;
                }
                if ('[('.includes(c) || (c === '{' && family === 'flowchart')) {
                    stack.push(c);
                    if (stack.length > limits.diagram_depth)
                        fail('TOO_COMPLEX', { depth: stack.length });
                }
                if ('])'.includes(c) || (c === '}' && family === 'flowchart')) {
                    if (stack.pop() !== pairs[c])
                        fail('INVALID_INPUT', { fields: ['source'] });
                }
                if ((c === '\n' || c === ';') && stack.length === 0) {
                    if (current.trim())
                        out.push(current.trim());
                    current = '';
                    continue;
                }
            }
            if (c === '\n' && (quoted || stack.length))
                fail('INVALID_INPUT', { fields: ['source'] });
            current += c;
        }
        if (quoted || stack.length)
            fail('INVALID_INPUT', { fields: ['source'] });
        if (current.trim())
            out.push(current.trim());
        return out;
    }
    function validateDiagramSource(input) {
        const source = boundedSource(input, limits.diagram_bytes);
        sourceSafety(source);
        const first = source.replace(/^[ \t]*%%[^\n]*(?:\n|$)/gm, '').trimStart().match(/^([\w-]+)/)?.[1];
        const family = first === 'flowchart' || first === 'graph' ? 'flowchart' : first === 'sequenceDiagram' ? 'sequence' : first === 'stateDiagram-v2' ? 'state' : null;
        if (!family)
            fail('UNSUPPORTED_KIND');
        const lines = statements(source, family);
        const header = lines.shift();
        if (family === 'flowchart' ? !/^(?:flowchart|graph)(?:\s+(?:TD|TB|BT|LR|RL))?$/.test(header) : header !== first)
            fail('INVALID_INPUT', { fields: ['source'] });
        const nodes = new Set();
        let edges = 0, depth = 0, maxDepth = 0, count = 0;
        const blocks = [];
        let inStateNote = false;
        // A hyphen belongs to an identifier only when another identifier character
        // follows it. Otherwise it starts an edge (A-->B must never lex as A--).
        const id = '[A-Za-z_](?:[A-Za-z0-9_]|-(?=[A-Za-z0-9_]))*';
        const node = (name) => { if (name !== '[*]')
            nodes.add(family === 'state' ? blocks.join('/') + '/' + name : name); };
        const open = (kind) => { blocks.push(kind); depth++; maxDepth = Math.max(depth, maxDepth); };
        function check() {
            if (nodes.size > limits.nodes || (family === 'flowchart' && edges > limits.edges) || maxDepth > limits.diagram_depth || (family !== 'flowchart' && count > limits.statements))
                fail('TOO_COMPLEX', { nodes: nodes.size, edges, depth: maxDepth, statements: count });
        }
        function flowNode(text) {
            const match = text.match(new RegExp('^(' + id + ')'));
            if (!match)
                unsafe('GRAMMAR');
            node(match[1]);
            let rest = text.slice(match[0].length).trimStart();
            if (/^[\[({]/.test(rest)) {
                const stack = [];
                let quote = false, index = 0;
                for (; index < rest.length; index++) {
                    const c = rest[index];
                    if (c === '"' && rest[index - 1] !== '\\')
                        quote = !quote;
                    if (!quote) {
                        if ('[({'.includes(c))
                            stack.push(c);
                        else if ('])}'.includes(c)) {
                            const expected = { ']': '[', ')': '(', '}': '{' }[c];
                            if (stack.pop() !== expected)
                                unsafe('GRAMMAR');
                            if (!stack.length) {
                                index++;
                                break;
                            }
                        }
                    }
                }
                if (stack.length || quote)
                    fail('INVALID_INPUT', { fields: ['source'] });
                rest = rest.slice(index).trimStart();
            }
            return rest;
        }
        function group(text) {
            let rest = flowNode(text), size = 1;
            while (rest.startsWith('&')) {
                rest = flowNode(rest.slice(1).trimStart());
                size++;
            }
            return { rest, size };
        }
        for (const line of lines) {
            count++;
            if (family === 'state' && inStateNote) {
                if (line === 'end note') inStateNote = false;
                // Notes are bounded plain text, never another syntax/config channel.
                else if (line.length > 500 || /[<>{}]/.test(line) || /^(?:note|end|state|click|style|classDef)\b/.test(line)) unsafe('GRAMMAR');
                check();
                continue;
            }
            if (/^(?:click|callback|href|link|links|style|classDef|class|linkStyle|accTitle|accDescr|layout|icon|image)\b/i.test(line) || line.includes(':::'))
                unsafe('DIRECTIVE');
            if (family === 'flowchart') {
                if (/^subgraph\s+/.test(line)) {
                    let label = line.slice(9).trim();
                    if (!label || !new RegExp('^(?:' + id + '(?:\\[.*\\])?|"[^"\\n]+")$').test(label))
                        unsafe('GRAMMAR');
                    // Clusters also cost layout work, including repeated/anonymous ones.
                    nodes.add('!cluster-' + count);
                    open('subgraph');
                    check();
                    continue;
                }
                if (line === 'end') {
                    if (!blocks.length)
                        fail('INVALID_INPUT', { fields: ['source'] });
                    blocks.pop();
                    depth--;
                    continue;
                }
                if (/^direction (?:TD|TB|BT|LR|RL)$/.test(line)) {
                    if (!blocks.length)
                        unsafe('GRAMMAR');
                    continue;
                }
                let { rest, size } = group(line);
                while (rest) {
                    // The alternative label form is deliberately plain text, never syntax.
                    const labelled = rest.match(/^(?:--\s+[^<>|;]+?\s+-->|-\.\s+[^<>|;]+?\s+\.->|==\s+[^<>|;]+?\s+==>)/);
                    const arrow = labelled ?? rest.match(/^(?:<-->|<==>|<-\.->|-->|---|-\.->|==>|~~~|--x|--o|o--o|x--x|<--|<==|===)/);
                    if (!arrow)
                        unsafe('GRAMMAR');
                    rest = rest.slice(arrow[0].length).trimStart();
                    if (rest.startsWith('|')) {
                        const end = rest.indexOf('|', 1);
                        if (end < 0)
                            fail('INVALID_INPUT', { fields: ['source'] });
                        rest = rest.slice(end + 1).trimStart();
                    }
                    const next = group(rest);
                    edges += size * next.size;
                    rest = next.rest;
                    size = next.size;
                    check();
                }
            }
            else if (family === 'sequence') {
                let match;
                if ((match = line.match(new RegExp('^(?:participant|actor)\\s+(' + id + ')(?:\\s+as\\s+.+)?$'))))
                    node(match[1]);
                else if ((match = line.match(new RegExp('^(' + id + ')\\s*(?:--?>>|--?>|--?x|--?\\)|--?\\)\\))([+-]?)\\s*(' + id + ')\\s*:\\s*.+$')))) {
                    node(match[1]);
                    node(match[3]);
                    edges++;
                }
                else if ((match = line.match(new RegExp('^Note\\s+(?:right of|left of|over)\\s+(' + id + ')(?:\\s*,\\s*(' + id + '))?\\s*:\\s*.+$')))) {
                    node(match[1]);
                    if (match[2])
                        node(match[2]);
                }
                else if (/^(?:loop|alt|opt|par|critical|break)\s+.+$/.test(line))
                    open(line.split(' ')[0]);
                else if (/^(?:else|and|option)(?:\s+.+)?$/.test(line)) {
                    if (!blocks.length)
                        unsafe('GRAMMAR');
                }
                else if (line === 'end') {
                    if (!blocks.length)
                        fail('INVALID_INPUT', { fields: ['source'] });
                    blocks.pop();
                    depth--;
                }
                else if ((match = line.match(new RegExp('^(?:activate|deactivate)\\s+(' + id + ')$'))))
                    node(match[1]);
                else if (!/^autonumber(?:\s+\d+(?:\s+\d+)?)?$/.test(line))
                    unsafe('GRAMMAR');
            }
            else {
                let match;
                const note = line.match(new RegExp('^note\\s+(?:right|left) of\\s+(' + id + ')(?:\\s*:\\s*(.+))?$'));
                if (note) {
                    node(note[1]);
                    if (note[2] && (note[2].length > 500 || /[<>{}]/.test(note[2]))) unsafe('GRAMMAR');
                    inStateNote = !note[2];
                    check();
                    continue;
                }
                const state = '(?:' + id + '|\\[\\*\\])';
                if ((match = line.match(new RegExp('^(' + state + ')\\s*-->\\s*(' + state + ')(?:\\s*:\\s*.+)?$')))) {
                    node(match[1]);
                    node(match[2]);
                    edges++;
                }
                else if ((match = line.match(new RegExp('^state\\s+(?:"[^"\\n]+"\\s+as\\s+)?(' + id + ')(\\s*\\{)?$')))) {
                    node(match[1]);
                    if (match[2])
                        open(match[1]);
                }
                else if (line === '}') {
                    if (!blocks.length)
                        fail('INVALID_INPUT', { fields: ['source'] });
                    blocks.pop();
                    depth--;
                }
                else if ((match = line.match(new RegExp('^(' + id + ')\\s*:\\s*.+$'))))
                    node(match[1]);
                else if (!/^direction (?:TD|TB|BT|LR|RL)$/.test(line) && line !== '--')
                    unsafe('GRAMMAR');
            }
            check();
        }
        if (blocks.length || inStateNote)
            fail('INVALID_INPUT', { fields: ['source'] });
        if (!nodes.size)
            fail('INVALID_INPUT', { fields: ['source'] });
        return { kind: 'diagram', family, source, source_bytes: bytes(source), validator_version: 1, counts: { nodes: nodes.size, edges, depth: maxDepth, statements: count } };
    }
    /** Small XML drawing grammar, independently reconstructed; no browser DOM required.
     * Unknown attributes/elements, entity declarations and malformed markup are errors.
     * CSS is never accepted here. The trusted renderer translates its fixed theme first.
     */
    function validateCanvasSvg(input) {
        const source = boundedSource(input, limits.svg_bytes);
        if (/<!|<\?|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(source))
            unsafe('SVG_XML');
        const tags = new Set(['svg', 'g', 'defs', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'marker']);
        const numeric = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'stroke-miterlimit', 'stroke-dashoffset', 'font-size', 'refX', 'refY', 'markerWidth', 'markerHeight', 'fx', 'fy', 'fr', 'textLength']);
        const presentation = new Set(['fill', 'stroke', 'color', 'stop-color', 'fill-opacity', 'stroke-opacity', 'opacity', 'stop-opacity', 'fill-rule', 'clip-rule', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'vector-effect', 'paint-order', 'visibility']);
        // Numeric stroke attributes are value-checked by numbers() below; admitting the
        // name was missed, so every Mermaid drawing with lines failed (real-browser QA).
        const common = new Set(['id', 'transform', 'role', 'aria-label', 'stroke-width', 'stroke-miterlimit', 'stroke-dashoffset', ...presentation]);
        const specific = { svg: ['xmlns', 'viewBox', 'width', 'height', 'preserveAspectRatio'], g: [], defs: [], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'], polyline: ['points'], polygon: ['points'], path: ['d', 'pathLength'], text: ['x', 'y', 'dx', 'dy', 'textLength', 'lengthAdjust'], tspan: ['x', 'y', 'dx', 'dy', 'textLength', 'lengthAdjust'], title: [], desc: [], linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod'], radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'fr', 'gradientUnits', 'gradientTransform', 'spreadMethod'], stop: ['offset'], clipPath: ['clipPathUnits'], marker: ['viewBox', 'refX', 'refY', 'markerWidth', 'markerHeight', 'markerUnits', 'orient', 'preserveAspectRatio'] };
        const referenceAttrs = new Set(['fill', 'stroke', 'clip-path', 'marker-start', 'marker-mid', 'marker-end']);
        const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        function unescape(text) {
            if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(text))
                unsafe('SVG_ENTITY');
            return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, n) => {
                const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
                if (named[n])
                    return named[n];
                const value = n[1] === 'x' ? parseInt(n.slice(2), 16) : Number(n.slice(1));
                if (!value || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff))
                    unsafe('SVG_ENTITY');
                return String.fromCodePoint(value);
            });
        }
        const numberPattern = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
        const numberRe = new RegExp('^' + numberPattern + '$');
        function numbers(value) {
            const list = value.trim().split(/[\s,]+/);
            if (!list.length || list.some(n => !numberRe.test(n) || !Number.isFinite(Number(n)) || Math.abs(Number(n)) > 8192))
                unsafe('SVG_NUMBER');
            return list.map(Number);
        }
        function color(value) { return /^(?:none|transparent|currentColor|#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]{1,24}|(?:rgb|rgba)\([\d.,%\s]+\))$/i.test(value); }
        const roots = [], stack = [], ids = new Map(), refs = [];
        let elements = 0, maxDepth = 0, pathUnits = 0, offset = 0;
        while (offset < source.length) {
            if (source[offset] !== '<') {
                const end = source.indexOf('<', offset), at = end < 0 ? source.length : end;
                const text = unescape(source.slice(offset, at));
                if (text.trim() && !['text', 'tspan', 'title', 'desc'].includes(stack.at(-1)?.tag))
                    unsafe('SVG_TEXT');
                if (stack.length)
                    stack.at(-1).children.push(escape(text));
                else if (text.trim())
                    unsafe('SVG_XML');
                offset = at;
                continue;
            }
            const closing = source.slice(offset).match(/^<\/([A-Za-z][A-Za-z0-9]*)\s*>/);
            if (closing) {
                if (stack.pop()?.tag !== closing[1])
                    unsafe('SVG_XML');
                offset += closing[0].length;
                continue;
            }
            const start = source.slice(offset).match(/^<([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/);
            if (!start || !tags.has(start[1]))
                unsafe('SVG_ELEMENT');
            const tag = start[1];
            offset += start[0].length;
            if (!stack.length && (tag !== 'svg' || roots.length))
                unsafe('SVG_XML');
            if (stack.length && tag === 'svg')
                unsafe('SVG_ELEMENT');
            const element = { tag, attrs: [], children: [] };
            const seen = new Set();
            let selfClosing = false;
            for (;;) {
                const end = source.slice(offset).match(/^\s*(\/?)>/);
                if (end) {
                    selfClosing = !!end[1];
                    offset += end[0].length;
                    break;
                }
                const attribute = source.slice(offset).match(/^\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/);
                if (!attribute)
                    unsafe('SVG_ATTRIBUTE');
                offset += attribute[0].length;
                const name = attribute[1], value = unescape(attribute[2] ?? attribute[3]);
                if (seen.has(name))
                    unsafe('SVG_ATTRIBUTE');
                seen.add(name);
                if (!common.has(name) && !specific[tag].includes(name) && !referenceAttrs.has(name))
                    unsafe('SVG_ATTRIBUTE');
                if (name === 'xmlns') {
                    if (value !== 'http://www.w3.org/2000/svg' || tag !== 'svg')
                        unsafe('SVG_NAMESPACE');
                }
                else if (name === 'id') {
                    if (!/^[A-Za-z_][\w.-]{0,127}$/.test(value) || ids.has(value))
                        unsafe('SVG_ID');
                    ids.set(value, `canvas-${ids.size}`);
                }
                else if (referenceAttrs.has(name) && /^url\(/.test(value)) {
                    const ref = value.match(/^url\(#([A-Za-z_][\w.-]{0,127})\)$/);
                    if (!ref)
                        unsafe('SVG_REFERENCE');
                    refs.push({ element, name, target: ref[1] });
                }
                else if (name === 'viewBox') {
                    const ns = numbers(value);
                    if (ns.length !== 4 || ns[2] <= 0 || ns[3] <= 0)
                        unsafe('SVG_NUMBER');
                }
                else if (numeric.has(name) || name === 'pathLength') {
                    if (!numberRe.test(value))
                        unsafe('SVG_NUMBER');
                    const ns = numbers(value);
                    if (ns.length !== 1 || (!['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'fx', 'fy', 'refX', 'refY', 'stroke-dashoffset'].includes(name) && ns[0] < 0))
                        unsafe('SVG_NUMBER');
                }
                else if (['dx', 'dy', 'stroke-dasharray', 'points'].includes(name)) {
                    const ns = numbers(value);
                    if (name === 'points') {
                        if (ns.length % 2)
                            unsafe('SVG_PATH');
                        pathUnits += ns.length / 2;
                    }
                    else if (name === 'stroke-dasharray' && ns.some(n => n < 0))
                        unsafe('SVG_NUMBER');
                }
                else if (name === 'd') {
                    const tokens = value.match(new RegExp('[a-zA-Z]|' + numberPattern, 'g')) ?? [];
                    if (!tokens.length || !/^[Mm]$/.test(tokens[0]) || value.replace(new RegExp('[a-zA-Z]|' + numberPattern, 'g'), '').replace(/[\s,]/g, ''))
                        unsafe('SVG_PATH');
                    const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
                    let i = 0;
                    while (i < tokens.length) {
                        const command = tokens[i++], need = arity[command.toUpperCase()];
                        if (need === undefined)
                            unsafe('SVG_PATH');
                        pathUnits++;
                        const values = [];
                        while (i < tokens.length && numberRe.test(tokens[i]))
                            values.push(Number(tokens[i++]));
                        if ((need === 0 && values.length) || (need > 0 && (!values.length || values.length % need)) || values.some(n => !Number.isFinite(n) || Math.abs(n) > 8192))
                            unsafe('SVG_PATH');
                        if (command.toUpperCase() === 'A')
                            for (let j = 0; j < values.length; j += 7)
                                if (values[j] < 0 || values[j + 1] < 0 || ![0, 1].includes(values[j + 3]) || ![0, 1].includes(values[j + 4]))
                                    unsafe('SVG_PATH');
                        pathUnits += Math.ceil(values.length / 2);
                    }
                }
                else if (name === 'transform' || name === 'gradientTransform') {
                    let rest = value;
                    let transforms = 0;
                    while (rest.trim()) {
                        const m = rest.trimStart().match(/^(matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)/);
                        if (!m)
                            unsafe('SVG_TRANSFORM');
                        const n = numbers(m[2]);
                        const allowed = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] };
                        if (!allowed[m[1]].includes(n.length) || ++transforms > 32)
                            unsafe('SVG_TRANSFORM');
                        rest = rest.trimStart().slice(m[0].length);
                    }
                }
                else if (['fill', 'stroke', 'color', 'stop-color'].includes(name)) {
                    if (!color(value))
                        unsafe('SVG_COLOR');
                }
                else if (['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'offset'].includes(name)) {
                    if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?|(?:\d{1,2}|100)(?:\.\d+)?%)$/.test(value) || Number(value.replace('%', '')) > (value.endsWith('%') ? 100 : 1))
                        unsafe('SVG_NUMBER');
                }
                else if (name === 'aria-label') {
                    if (value.length > 500)
                        unsafe('SVG_ATTRIBUTE');
                }
                else {
                    const enums = { role: ['img', 'presentation', 'graphics-document'], 'font-family': ['system-ui', 'sans-serif', 'Arial'], 'font-weight': ['normal', 'bold', '400', '500', '600', '700'], 'font-style': ['normal', 'italic'], 'text-anchor': ['start', 'middle', 'end'], 'dominant-baseline': ['auto', 'middle', 'central', 'alphabetic', 'text-before-edge', 'hanging'], 'alignment-baseline': ['auto', 'middle', 'central', 'baseline', 'alphabetic'], 'fill-rule': ['nonzero', 'evenodd'], 'clip-rule': ['nonzero', 'evenodd'], 'stroke-linecap': ['butt', 'round', 'square'], 'stroke-linejoin': ['miter', 'round', 'bevel'], 'vector-effect': ['non-scaling-stroke', 'none'], 'paint-order': ['normal', 'stroke', 'fill', 'stroke fill'], visibility: ['visible', 'hidden'], gradientUnits: ['userSpaceOnUse', 'objectBoundingBox'], clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'], spreadMethod: ['pad', 'reflect', 'repeat'], markerUnits: ['strokeWidth', 'userSpaceOnUse'], lengthAdjust: ['spacing', 'spacingAndGlyphs'] };
                    if (name === 'orient') {
                        if (!['auto', 'auto-start-reverse'].includes(value))
                            numbers(value);
                    }
                    else if (name === 'preserveAspectRatio') {
                        if (!/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(value))
                            unsafe('SVG_ATTRIBUTE');
                    }
                    else if (!enums[name]?.includes(value))
                        unsafe('SVG_ATTRIBUTE');
                }
                element.attrs.push([name, value]);
                if (pathUnits > limits.path_units)
                    fail('TOO_COMPLEX', { path_units: pathUnits });
            }
            elements++;
            maxDepth = Math.max(maxDepth, stack.length + 1);
            if (elements > limits.elements || maxDepth > limits.svg_depth)
                fail('TOO_COMPLEX', { elements, depth: maxDepth });
            if (stack.length)
                stack.at(-1).children.push(element);
            else
                roots.push(element);
            if (!selfClosing)
                stack.push(element);
        }
        if (stack.length || roots.length !== 1)
            unsafe('SVG_XML');
        for (const ref of refs) {
            if (!ids.has(ref.target))
                unsafe('SVG_REFERENCE');
        }
        function serialize(element) {
            if (typeof element === 'string')
                return element;
            const attrs = element.attrs.map(([name, value]) => {
                if (name === 'id')
                    value = ids.get(value);
                if (referenceAttrs.has(name) && value.startsWith('url('))
                    value = `url(#${ids.get(value.slice(5, -1))})`;
                return ` ${name}="${escape(value)}"`;
            }).join('');
            return `<${element.tag}${attrs}>${element.children.map(serialize).join('')}</${element.tag}>`;
        }
        const svg = serialize(roots[0]);
        const outputBytes = bytes(svg);
        if (outputBytes > limits.svg_bytes)
            fail('CONTENT_TOO_LARGE', { max_bytes: limits.svg_bytes, received_bytes: outputBytes });
        return { svg, source_bytes: bytes(source), svg_bytes: outputBytes, validator_version: 1, counts: { elements, depth: maxDepth, path_units: pathUnits } };
    }
    /** Closed static HTML fragment grammar. Reconstruct rather than repair browser HTML.
     * Inline CSS has no escape/comment/custom-property syntax and only named functions.
     * SVG is delegated to the independent drawing gate; no HTML integration points.
     */
    function validatePageSource(input) {
        let source = boundedSource(input, limits.page_bytes);
        // Accept only an innocuous document envelope, never author head resources.
        source=source.replace(/^\s*<!doctype html>\s*/i,'');
        if(/^\s*<html[\s>]/i.test(source)){
            const envelope=source.match(/^\s*<html(?:\s+lang=(?:"[a-z-]{1,24}"|'[a-z-]{1,24}'))?\s*>\s*(?:<head>\s*(?:<title>([^<]*)<\/title>\s*)?<\/head>\s*)?<body((?:\s+[^<>]*)?)>([\s\S]*)<\/body>\s*<\/html>\s*$/i);
            if(!envelope)unsafe('PAGE_HTML');
            if(envelope[1])decode(envelope[1]);
            source='<div'+envelope[2]+'>'+envelope[3]+'</div>';
        }
        const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        function decode(s) {
            if (/&(?!(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);)/i.test(s)) unsafe('PAGE_ENTITY');
            return s.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/g, (_, n) => {
                const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'};
                if (Object.hasOwn(named,n)) return named[n];
                const v = /^#x/.test(n) ? parseInt(n.slice(2),16) : Number(n.slice(1));
                if (!v || v>0x10ffff || (v>=0xd800&&v<=0xdfff)) unsafe('PAGE_ENTITY');
                return String.fromCodePoint(v);
            });
        }
        const forbidden = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
        const props = new Set(('color background background-color display flex flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-content align-self justify-content justify-items justify-self gap row-gap column-gap grid-template-columns grid-template-rows grid-column grid-row width height min-width max-width min-height max-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-top border-right border-bottom border-left border-color border-width border-style border-radius border-collapse border-spacing box-sizing box-shadow font-family font-size font-weight font-style line-height letter-spacing text-align text-transform text-decoration white-space overflow overflow-x overflow-y overflow-wrap word-break vertical-align list-style-type opacity position').split(' '));
        function style(raw) {
            if (raw.length>4096 || /[^\x20-\x7e]/.test(raw) || /[\\@{}<>"'!]|\/\*|\*\/|--|url|image-set|expression|var\s*\(/i.test(raw)) unsafe('PAGE_CSS');
            const declarations = new Map();
            for (const chunk of raw.split(';')) {
                if (!chunk.trim()) continue;
                const m = chunk.trim().match(/^([a-z-]+)\s*:\s*(.+)$/i);
                if (!m || !props.has(m[1].toLowerCase())) unsafe('PAGE_CSS');
                const name=m[1].toLowerCase(), value=m[2].trim().replace(/\s+/g,' ');
                if (declarations.has(name) || !/^[a-zA-Z0-9#.,%()+ /-]+$/.test(value)) unsafe('PAGE_CSS');
                const length='(?:0|(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:px|rem|em|%))';
                const lengths=new RegExp('^'+length+'(?: '+length+'){0,3}$');
                const color='(?:#[a-fA-F0-9]{3,4}|#[a-fA-F0-9]{6}|#[a-fA-F0-9]{8}|[a-zA-Z]{1,24}|(?:rgb|rgba|hsl|hsla)\\([\\d.,% ]+\\))';
                const enums={position:['static','relative'],display:['block','inline','inline-block','flex','inline-flex','grid','none'], 'flex-direction':['row','column','row-reverse','column-reverse'],'flex-wrap':['wrap','nowrap','wrap-reverse'],'font-style':['normal','italic'],'text-align':['left','right','center','start','end','justify'],'text-transform':['none','uppercase','lowercase','capitalize'],'text-decoration':['none','underline','line-through'],'white-space':['normal','nowrap','pre','pre-wrap','pre-line'],'overflow':['auto','hidden','scroll','visible'],'overflow-x':['auto','hidden','scroll','visible'],'overflow-y':['auto','hidden','scroll','visible'],'overflow-wrap':['normal','break-word','anywhere'],'word-break':['normal','break-all','keep-all'],'box-sizing':['border-box','content-box'],'border-collapse':['collapse','separate'],'border-style':['solid','dashed','dotted','double','none'],'vertical-align':['top','middle','bottom','baseline'],'list-style-type':['none','disc','circle','square','decimal']};
                let valid=false;
                if(Object.hasOwn(enums,name))valid=enums[name].includes(value);
                else if(name==='font-family')valid=/^(?:system-ui|sans-serif|serif|monospace|Arial|Georgia)(?:,\s*(?:system-ui|sans-serif|serif|monospace|Arial|Georgia))*$/.test(value);
                else if(['color','background','background-color','border-color'].includes(name))valid=new RegExp('^'+color+'$').test(value);
                else if(/^border(?:-(?:top|right|bottom|left))?$/.test(name))valid=value==='none'||new RegExp('^'+length+' (?:solid|dashed|dotted|double) '+color+'$').test(value);
                else if(name==='box-shadow')valid=value==='none'||new RegExp('^'+length+' '+length+' '+length+'(?: '+length+')? '+color+'$').test(value);
                else if(/^(?:margin|padding|gap|row-gap|column-gap|border-width|border-radius|border-spacing)(?:-(?:top|right|bottom|left))?$/.test(name))valid=lengths.test(value)||name.startsWith('margin')&&/^(?:0|auto)(?: (?:0|auto)){0,3}$/.test(value);
                else if(/^(?:(?:min-|max-)?(?:width|height)|flex-basis)$/.test(name))valid=new RegExp('^(?:auto|none|'+length+')$').test(value);
                else if(name==='font-size'||name==='letter-spacing')valid=new RegExp('^'+length+'$').test(value);
                else if(name==='font-weight')valid=/^(?:normal|bold|[1-9]00)$/.test(value);
                else if(name==='line-height')valid=new RegExp('^(?:normal|[0-9](?:\\.\\d+)?|'+length+')$').test(value);
                else if(name==='opacity')valid=/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value);
                else if(['flex-grow','flex-shrink'].includes(name))valid=/^(?:\d|1\d|20)$/.test(value);
                else if(name==='flex')valid=new RegExp('^(?:none|auto|initial|\\d{1,2} \\d{1,2} (?:auto|'+length+'))$').test(value);
                else if(/^(?:align|justify)-(?:items|content|self)$/.test(name))valid=/^(?:normal|auto|start|end|center|stretch|baseline|flex-start|flex-end|space-between|space-around|space-evenly)$/.test(value);
                else if(name==='grid-column'||name==='grid-row')valid=/^(?:auto|span (?:[1-9]|1\d|2[0-4]))$/.test(value);
                else if(name==='grid-template-columns'||name==='grid-template-rows'){
                    const track='(?:auto|'+length+'|(?:[1-9]|1\\d|2[0-4])fr)';
                    const minmax='minmax\\('+'(?:'+length+'|auto)'+', ?'+track+'\\)';
                    const t='(?:'+track+'|'+minmax+')';
                    valid=new RegExp('^(?:none|'+t+'(?: '+t+'){0,23}|repeat\\((?:[1-9]|1\\d|2[0-4]|auto-fit|auto-fill), ?'+t+'\\))$').test(value);
                }
                if(!valid)unsafe('PAGE_CSS');
                for(const n of value.replace(/#[a-f0-9]{3,8}/gi,'').matchAll(/(?:\d+(?:\.\d*)?|\.\d+)/g))if(!Number.isFinite(Number(n[0]))||Number(n[0])>8192)fail('TOO_COMPLEX');
                for(const part of value.matchAll(/(\d+(?:\.\d+)?|\.\d+)(px|rem|em|%)/g))if(Number(part[1])>({px:8192,rem:64,em:64,'%':100})[part[2]])fail('TOO_COMPLEX');
                declarations.set(name,value);
            }
            return [...declarations].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}:${v}`).join(';');
        }
        const tags=new Set('main article section header footer aside div span p h1 h2 h3 h4 h5 h6 strong em b i u s small sub sup mark code pre blockquote ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td br hr'.split(' '));
        const voids=new Set(['br','hr','col']);
        const phrasing=new Set('span strong em b i u s small sub sup mark code br'.split(' '));
        const restricted={table:['caption','colgroup','thead','tbody','tfoot'],colgroup:['col'],thead:['tr'],tbody:['tr'],tfoot:['tr'],tr:['th','td'],ul:['li'],ol:['li'],dl:['dt','dd']};
        const parentOnly={caption:['table'],colgroup:['table'],col:['colgroup'],thead:['table'],tbody:['table'],tfoot:['table'],tr:['thead','tbody','tfoot'],th:['tr'],td:['tr'],li:['ul','ol'],dt:['dl'],dd:['dl']};
        const stack=[],out=[],ids=new Set();let offset=0,elements=0,svgCount=0,pathUnits=0;
        while(offset<source.length){
            if(source[offset]!=='<'){
                const end=source.indexOf('<',offset),at=end<0?source.length:end;
                const text=decode(source.slice(offset,at));
                if(forbidden.test(text)||(text.trim()&&restricted[stack.at(-1)]))unsafe('PAGE_TEXT');
                out.push(escape(text));offset=at;continue;
            }
            if(source.startsWith('<'+'!--',offset)){
                const end=source.indexOf('-->',offset+4);if(end<0)unsafe('PAGE_HTML');offset=end+3;continue;
            }
            const close=source.slice(offset).match(/^<\/([a-z][a-z0-9]*)\s*>/i);
            if(close){if(stack.pop()!==close[1].toLowerCase())unsafe('PAGE_HTML');out.push(`</${close[1].toLowerCase()}>`);offset+=close[0].length;continue;}
            const start=source.slice(offset).match(/^<([a-z][a-z0-9]*)(?=[\s/>])/i);
            if(!start)unsafe('PAGE_HTML');
            const tag=start[1].toLowerCase(),parent=stack.at(-1);
            if(restricted[parent]&&!restricted[parent].includes(tag))unsafe('PAGE_NESTING');
            if(parentOnly[tag]&&!parentOnly[tag].includes(parent))unsafe('PAGE_NESTING');
            if(stack.some(t=>phrasing.has(t)||/^h[1-6]$/.test(t)||t==='p')&&!phrasing.has(tag))unsafe('PAGE_NESTING');
            if(tag==='svg'){
                const end=source.indexOf('</svg>',offset);if(end<0)unsafe('PAGE_SVG');
                const valid=validateCanvasSvg(source.slice(offset,end+6));
                const prefix=`page${svgCount++}-`;
                out.push(valid.svg.replace(/(id="|url\(#)canvas-(\d+)/g,(_,lead,n)=>lead+prefix+'canvas-'+n));
                // Revalidation canonicalizes these ids back to canvas-N; prefix is stable per root.
                elements+=valid.counts.elements;pathUnits+=valid.counts.path_units;offset=end+6;
            }else{
                if(!tags.has(tag))unsafe('PAGE_ELEMENT');offset+=start[0].length;
                const attrs=new Map();let self=false;
                for(;;){
                    const end=source.slice(offset).match(/^\s*(\/?)>/);
                    if(end){self=!!end[1];offset+=end[0].length;break;}
                    const a=source.slice(offset).match(/^\s+([a-z][a-z0-9-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/i);
                    if(!a)unsafe('PAGE_ATTRIBUTE');offset+=a[0].length;
                    const name=a[1].toLowerCase();let value=decode(a[2]??a[3]);
                    if(attrs.has(name)||forbidden.test(value))unsafe('PAGE_ATTRIBUTE');
                    if(name==='style')value=style(value);
                    else if(name==='id')unsafe('PAGE_ID');
                    else if(name==='class')unsafe('PAGE_ATTRIBUTE');
                    else if(['title','aria-label'].includes(name)){if(value.length>500)unsafe('PAGE_ATTRIBUTE');}
                    else if(name==='role'){if(!['img','presentation','table','note','region'].includes(value))unsafe('PAGE_ATTRIBUTE');}
                    else if(name==='scope'&&tag==='th'){if(!['row','col','rowgroup','colgroup'].includes(value))unsafe('PAGE_ATTRIBUTE');}
                    else if(['colspan','rowspan'].includes(name)&&['th','td'].includes(tag)){if(!/^(?:[1-9]|1\d|20)$/.test(value))unsafe('PAGE_ATTRIBUTE');}
                    else if(name==='start'&&tag==='ol'){if(!/^\d{1,3}$/.test(value))unsafe('PAGE_ATTRIBUTE');}
                    else unsafe('PAGE_ATTRIBUTE');
                    attrs.set(name,value);
                }
                if(self&&!voids.has(tag))unsafe('PAGE_HTML');
                out.push(`<${tag}${[...attrs].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>` ${k}="${escape(v)}"`).join('')}>`);
                if(!voids.has(tag))stack.push(tag);elements++;
            }
            if(elements>5000||stack.length>24||pathUnits>limits.path_units||svgCount>32)fail('TOO_COMPLEX');
        }
        if(stack.length||!elements)unsafe('PAGE_HTML');
        const canonical=out.join('');if(bytes(canonical)>limits.page_bytes||bytes(JSON.stringify({html:canonical,validator_version:2}))>limits.page_bytes)fail('CONTENT_TOO_LARGE');
        return {kind:'page',source:canonical,source_bytes:bytes(canonical),validator_version:2,counts:{elements,path_units:pathUnits}};
    }
    function validateCanvasContent(content) {
        if (!content || typeof content !== 'object' || Array.isArray(content) || ![Object.prototype, null].includes(Object.getPrototypeOf(content)) || !Object.hasOwn(content, 'kind') || typeof content.kind !== 'string')
            fail('INVALID_INPUT', { fields: ['content'] });
        if (!['diagram','page'].includes(content.kind))
            fail('UNSUPPORTED_KIND');
        if (Object.keys(content).some(k => !['kind', 'source'].includes(k)) || !Object.hasOwn(content, 'source'))
            fail('INVALID_INPUT', { fields: ['content'] });
        return content.kind === 'page' ? validatePageSource(content.source) : validateDiagramSource(content.source);
    }
    return { limits, validateDiagramSource, validateCanvasSvg, validatePageSource, validateCanvasContent };
}
const runtime = createCanvasContentValidator();
export const CANVAS_LIMITS = runtime.limits;
export const validateDiagramSource = runtime.validateDiagramSource;
export const validateCanvasSvg = runtime.validateCanvasSvg;
export const validateCanvasContent = runtime.validateCanvasContent;

export const validatePageSource = runtime.validatePageSource;
