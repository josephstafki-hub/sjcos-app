import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCanvasContent, validateDiagramSource, validateCanvasSvg, CANVAS_LIMITS } from '../lib/canvas-content.mjs';
import { assertEveryToolClassified, validateClassificationRegistry, classifyToolAreas } from '../lib/canvas-classification.mjs';
import { adversarialDiagrams, validDiagrams, validSvg } from './fixtures/canvas-adversarial.mjs';
function rejects(fn, code) {
    assert.throws(fn, (e) => e.code === code && e.retryable === false && !e.message.includes('evil.test'));
}
for (const [name, source] of validDiagrams)
    test(`accept ${name}`, () => {
        const result = validateDiagramSource(source);
        assert.equal(result.source, source);
        assert.ok(result.counts.nodes <= 100);
    });
for (const [name, source] of adversarialDiagrams)
    test(`reject ${name}`, () => rejects(() => validateDiagramSource(source), 'UNSAFE_CONTENT'));
test('normalizes BOM and CRLF without altering Unicode or labels', () => {
    assert.equal(validateDiagramSource('\ufeffflowchart LR\r\nA["造作 🪚"]\r\n').source, 'flowchart LR\nA["造作 🪚"]\n');
});
test('UTF-8 input limit is inclusive and checked before normalization', () => {
    const prefix = 'flowchart LR\nA["';
    const suffix = '"]';
    const source = prefix + 'é'.repeat(16374) + suffix;
    const pad = ' '.repeat(32768 - Buffer.byteLength(source));
    assert.equal(validateDiagramSource(source + pad).source_bytes, 32768);
    rejects(() => validateDiagramSource(source + pad + 'é'), 'CONTENT_TOO_LARGE');
    rejects(() => validateDiagramSource('\ufeff' + source + pad), 'CONTENT_TOO_LARGE');
});
test('strict content shape, unsupported kinds and families', () => {
    for (const input of [null, {}, { kind: 'diagram' }, { kind: 'diagram', source: 1 }, { kind: 'diagram', source: 'x', csp: 'x' }])
        rejects(() => validateCanvasContent(input), 'INVALID_INPUT');
    rejects(() => validateCanvasContent({ kind: 'page', source: '<svg><script/></svg>' }), 'UNSUPPORTED_KIND');
    for (const source of ['pie\n"X":2', 'mindmap\nroot', 'stateDiagram\nA-->B'])
        rejects(() => validateDiagramSource(source), 'UNSUPPORTED_KIND');
    rejects(() => validateDiagramSource('<svg><path/></svg>'), 'UNSAFE_CONTENT');
    for (const source of ['', '  ', '\ud800', 'flowchart LR\nA["unterminated]'])
        rejects(() => validateDiagramSource(source), 'INVALID_INPUT');
});
test('100 unique nodes, aliases and repeated references counted structurally', () => {
    const source = 'flowchart LR\n' + Array.from({ length: 100 }, (_, i) => `N${i}["node --> fake${i}"]`).join('\n');
    assert.equal(validateDiagramSource(source).counts.nodes, 100);
    rejects(() => validateDiagramSource(source + '\nN100'), 'TOO_COMPLEX');
    assert.equal(validateDiagramSource('flowchart LR\nA-->B\nA-->B').counts.nodes, 2);
});
test('200 edges inclusive; chained and fan-out edges cannot hide counts', () => {
    const source = 'flowchart LR\n' + 'A-->B\n'.repeat(200);
    assert.equal(validateDiagramSource(source).counts.edges, 200);
    rejects(() => validateDiagramSource(source + 'A-->B'), 'TOO_COMPLEX');
    assert.equal(validateDiagramSource('flowchart LR\nA & B --> C & D --> E').counts.edges, 6);
});
test('nesting 12 inclusive and balanced', () => {
    const source = 'flowchart LR\n' + 'subgraph Group\n'.repeat(12) + 'A-->B\n' + 'end\n'.repeat(12);
    assert.equal(validateDiagramSource(source).counts.depth, 12);
    rejects(() => validateDiagramSource(source.replace('A-->B', 'subgraph Extra\nA-->B\nend')), 'TOO_COMPLEX');
    rejects(() => validateDiagramSource('flowchart LR\nend'), 'INVALID_INPUT');
});
test('sequence/state participant, state and statement ceilings', () => {
    for (const header of ['sequenceDiagram', 'stateDiagram-v2']) {
        const lines = header === 'sequenceDiagram' ? Array.from({ length: 100 }, (_, i) => `participant A${i}`) : Array.from({ length: 100 }, (_, i) => `state A${i}`);
        assert.equal(validateDiagramSource(header + '\n' + lines.join('\n')).counts.nodes, 100);
        rejects(() => validateDiagramSource(header + '\n' + lines.join('\n') + '\n' + (header === 'sequenceDiagram' ? 'participant Extra' : 'state Extra')), 'TOO_COMPLEX');
    }
    assert.equal(validateDiagramSource('sequenceDiagram\n' + 'Note right of A: wait\n'.repeat(400)).counts.statements, 400);
    rejects(() => validateDiagramSource('sequenceDiagram\n' + 'Note right of A: wait\n'.repeat(401)), 'TOO_COMPLEX');
});
test('SVG reconstructs safe drawing, rewrites IDs and resolves only local refs', () => {
    const result = validateCanvasSvg(validSvg);
    assert.match(result.svg, /id="canvas-0"/);
    assert.match(result.svg, /url\(#canvas-0\)/);
    assert.ok(!result.svg.includes('id="arrow"'));
    assert.equal(validateCanvasSvg(result.svg).svg, result.svg);
});
test('SVG script, malformed XML, CSS, entity and resource vectors fail closed', () => {
    const bad = ['<svg><g></svg>', '<svg><script>alert(1)</script></svg>', '<svg onload="x"/>', '<svg><foreignObject/></svg>', '<svg><use href="#x"/></svg>', '<svg><a href="https://evil.test"/></svg>', '<svg><image href="data:x"/></svg>', '<svg><animate/></svg>', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>', '<svg><style>@import "x";</style></svg>', '<svg><path fill="url(https://evil.test)"/></svg>', '<svg><path fill="url(#missing)"/></svg>', '<svg><g id="x"/><g id="x"/></svg>', '<svg><g style="fill:red"/></svg>', '<svg><text>&unknown;</text></svg>', '<svg><path d="M NaN 0"/></svg>', '<svg viewBox="0 0 1e99 10"/>'];
    for (const svg of bad)
        rejects(() => validateCanvasSvg(svg), 'UNSAFE_CONTENT');
});
test('SVG byte, element, nesting and aggregate path budgets', () => {
    rejects(() => validateCanvasSvg('<svg><text>' + 'x'.repeat(524288) + '</text></svg>'), 'CONTENT_TOO_LARGE');
    assert.equal(validateCanvasSvg('<svg>' + '<g/>'.repeat(9999) + '</svg>').counts.elements, 10000);
    rejects(() => validateCanvasSvg('<svg>' + '<g/>'.repeat(10000) + '</svg>'), 'TOO_COMPLEX');
    assert.equal(validateCanvasSvg('<svg>' + '<g>'.repeat(31) + '</g>'.repeat(31) + '</svg>').counts.depth, 32);
    rejects(() => validateCanvasSvg('<svg>' + '<g>'.repeat(32) + '</g>'.repeat(32) + '</svg>'), 'TOO_COMPLEX');
    // A command and each coordinate pair consume a path unit; 100,000 fits below 512 KiB.
    assert.equal(validateCanvasSvg('<svg><path d="M' + '0 0 '.repeat(99999) + '"/></svg>').counts.path_units, 100000);
    rejects(() => validateCanvasSvg('<svg><path d="M' + '0 0 '.repeat(100000) + '"/></svg>'), 'TOO_COMPLEX');
    assert.equal(CANVAS_LIMITS.diagram_bytes, 32768);
});
test('errors expose fixed codes/rules/counts, no hostile source', () => {
    try {
        validateDiagramSource('flowchart LR\nclick SECRET_PAYLOAD callback');
    }
    catch (e) {
        const wire = JSON.stringify(e.toJSON());
        assert.ok(!wire.includes('SECRET_PAYLOAD'));
        assert.deepEqual(Object.keys(e.details), ['rule']);
    }
});
test('Markdown relative links, escaped config and bracket bombs are rejected', () => {
    for (const label of ['`[press](/api/secret)`', '`![icon](//evil.test/i)`', 'java%0ascript:alert(1)', '%25%25%7Binit%3A%7B%7D%7D%25%25', '&amp;lt;img onerror=x&amp;gt;', 'java#x73;cript#colon;alert(1)', '#lt;script#gt;'])
        rejects(() => validateDiagramSource('flowchart LR\nA["' + label + '"]'), 'UNSAFE_CONTENT');
    rejects(() => validateDiagramSource('flowchart LR\nA' + '['.repeat(13) + 'x' + ']'.repeat(13)), 'TOO_COMPLEX');
});
test('ordinary labels, default direction and local-only SVG bounds', () => {
    assert.equal(validateDiagramSource('flowchart\nA -- click here --> B -. wait .-> C == ready ==> D').counts.edges, 3);
    const prefix = '<svg viewBox="0 0 8192 8192"><text>';
    const suffix = '</text></svg>';
    const svg = prefix + 'x'.repeat(524288 - prefix.length - suffix.length) + suffix;
    assert.equal(validateCanvasSvg(svg).svg_bytes, 524288);
    rejects(() => validateCanvasSvg(svg.replace('>x', '>é')), 'CONTENT_TOO_LARGE');
    rejects(() => validateCanvasSvg('<svg><path d="M' + '0 0 '.repeat(49999) + '"/><path d="M' + '0 0 '.repeat(50000) + '"/></svg>'), 'TOO_COMPLEX');
});
test('clusters and namespaced nested states count toward 100 layout nodes', () => {
    const clusters = 'flowchart LR\n' + Array.from({ length: 100 }, (_, i) => `subgraph G${i}\nA\nend`).join('\n');
    rejects(() => validateDiagramSource(clusters), 'TOO_COMPLEX');
    const nested = 'stateDiagram-v2\n' + Array.from({ length: 34 }, (_, i) => `state S${i} {\nA --> B\n}`).join('\n');
    rejects(() => validateDiagramSource(nested), 'TOO_COMPLEX');
    assert.equal(validateDiagramSource('sequenceDiagram\n' + 'A->>B: ok\n'.repeat(400)).counts.statements, 400);
});
test('classification registry is exhaustive, strict and does not infer actor permissions', () => {
    const registry = { version: 1, content_areas: ['invoices', 'money'], tools: { read: { areas: ['money'], variants: { invoice: { areas: ['invoices'] } } }, docs: { areas: [] } } };
    const normalized = validateClassificationRegistry(registry);
    assert.equal(assertEveryToolClassified(['read', 'docs'], normalized), true);
    assert.throws(() => assertEveryToolClassified(['read', 'new_tool'], normalized));
    assert.deepEqual(classifyToolAreas('read', normalized, 'invoice'), { areas: ['invoices', 'money'], complete: true });
    assert.deepEqual(classifyToolAreas('read', normalized, 'unknown'), { areas: ['invoices', 'money'], complete: false });
    assert.deepEqual(classifyToolAreas('missing', normalized), { areas: ['invoices', 'money'], complete: false });
    assert.deepEqual(classifyToolAreas('docs', normalized), { areas: [], complete: true });
    for (const invalid of [{ ...registry, extra: 1 }, { ...registry, content_areas: ['ai'] }, { ...registry, content_areas: ['projects'] }, { ...registry, tools: { read: { areas: ['bogus'] } } }, { ...registry, tools: { read: { areas: ['money', 'money'] } } }, { ...registry, tools: JSON.parse('{"__proto__":{"areas":[]}}') }])
        assert.throws(() => validateClassificationRegistry(invalid));
});

// Real-browser QA (2026-11-05): every Mermaid drawing failed because stroke-width
// was value-checked but never admitted. Admit plain numbers only.
test('SVG gate admits numeric stroke-width and still rejects units, refs and huge values', async () => {
  const { validateCanvasSvg } = await import('../lib/canvas-content.mjs');
  const wrap = (attrs) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><path d="M0,0L10,10" ${attrs}/></svg>`;
  validateCanvasSvg(wrap('stroke-width="1.5"'));
  validateCanvasSvg(wrap('stroke-width="0"'));
  for (const bad of ['stroke-width="1pt"', 'stroke-width="url(#x)"', 'stroke-width="99999"', 'stroke-width="1;x"']) {
    let threw = false; try { validateCanvasSvg(wrap(bad)); } catch { threw = true; }
    if (!threw) throw new Error('accepted ' + bad);
  }
});
