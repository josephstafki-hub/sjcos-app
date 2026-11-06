// Realistic model-written static page fragments; responsive without stylesheets.
export const layouts = [
`<main style="max-width:1100px;margin:0 auto;padding:24px;font-family:system-ui,sans-serif;color:#2c3326"><header><p style="font-size:12px;letter-spacing:2px;text-transform:uppercase">SJ Carpentry · Internal draft</p><h1>Weekly job board</h1><p>Selections, site visits &amp; next steps</p></header><section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px"><article style="border:1px solid #ddd;border-radius:12px;padding:16px"><h2>Kitchen</h2><p>Cabinet samples are ready.</p><ul><li>Confirm finish</li><li>Book site visit</li></ul></article><article style="background:#f3f0e7;padding:16px;border-radius:12px"><h2>Bath</h2><p>Tile arrives Thursday.</p></article></section><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><caption>Upcoming work</caption><thead><tr><th scope="col">Day</th><th scope="col">Task</th></tr></thead><tbody><tr><th scope="row">Monday</th><td>Measure cabinets</td></tr><tr><th scope="row">Thursday</th><td>Check delivery</td></tr></tbody></table></div></main>`,
`<article style="display:flex;flex-wrap:wrap;gap:24px;padding:16px"><section style="flex:1 1 280px"><h1>Permit steps</h1><p>This drawing is a process guide.</p></section><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 240" width="640" height="240" role="img" aria-label="Permit process"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#5b7e72"/></marker></defs><g transform="translate(20,20)" stroke="#5b7e72" stroke-width="2"><rect x="0" y="40" width="180" height="80" rx="12" fill="#fbfaf4"/><path d="M180 80 L360 80" stroke-dasharray="6 4" marker-end="url(#arrow)"/><circle cx="440" cy="80" r="70" fill="#fbfaf4"/><text x="90" y="86" text-anchor="middle" font-size="18" fill="#2c3326" stroke="none">Apply</text><text x="440" y="86" text-anchor="middle" font-size="18" fill="#2c3326" stroke="none">Review</text></g></svg></article>`
];
// Expectations precede implementation/execution: all 25 are rejected, never stripped.
export const adversarial = [
'<div onclick="alert(1)">x</div>', '<SCRIPT>alert(1)</SCRIPT>', '<a href="#x">x</a>',
'<form action="/api"><button>go</button></form>', '<base href="https://evil.test">',
'<meta http-equiv="refresh" content="0;url=/">', '<img src="https://evil.test/a">',
'<div style="background:url(https://evil.test)">x</div>', '<div style="color:var(--x)">x</div>',
'<div style="--x:red">x</div>', '<div style="background:im\\61ge-set(\'x\')">x</div>',
'<div style="color:&#117;rl(x)">x</div>', '<div style="color:red/*x*/">x</div>',
'<div style="position:fixed">x</div>', '<svg><foreignObject><div>x</div></foreignObject></svg>',
'<svg><use href="#x"/></svg>', '<svg><animate attributeName="x"/></svg>',
'<svg xmlns="http://evil.test"><path d="M0 0 L1 1"/></svg>', '<div><span></div></span>',
'<table><div>x</div></table>', '<p><section>x</section></p>', '<div id="x" id="y">x</div>',
'<div style="grid-template-columns:repeat(99999,1fr)">x</div>', '<div style="width:999999px">x</div>',
'<svg><path d="M0 0 L1e99 0"/></svg>'
];
