// Client-portal demo seed (SYNTHETIC data only; no real client records).
// Builds one showcase project — "Birchwood Kitchen & Main Floor" for Dana &
// Marcus Holt — with content in every portal section: floor plans (one
// approved, one awaiting approval), a mood board, selections with options,
// a sent estimate + signed contract + sent change order (all through the
// e-sign engine), invoices, schedule, daily logs, messages, and punch items.
//
// Idempotent: deletes the demo project/user/files by their demo keys, then
// reinserts. Dates are computed from now() so the demo always reads fresh.
//
//   node db/seed-portal-demo.mjs
//
// Demo logins (password for both: sjcos)
//   owner   josephstafki@sjcarpentryllc.com
//   client  client@demo.test

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import PDFDocument from "pdfkit";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const SLUG = "birchwood-kitchen";
const CLIENT_EMAIL = "client@demo.test";
// scrypt salt:hash for the demo password "sjcos" (same as db/seed.sql).
const DEMO_HASH =
  "40676a86efbd86836c89a27ef60bb454:5ef3dfb212f1dbd1aaa746f37e245d9d3c0b160f8e0ac3a2a681ad3d66dda4c5d2494df8f38b1c3eff9ebe7b2b387ddfb034ed6ece57bc84ee9dffcb50f03b8b";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

/* ── SVG placeholder art ──────────────────────────────────────────────────── */

const svgDoc = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

/** Product-shot style tile: soft gradient + big label. */
function productSvg(label, from, to, sub = "") {
  return svgDoc(
    640,
    480,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
     </linearGradient></defs>
     <rect width="640" height="480" fill="url(#g)"/>
     <rect x="24" y="24" width="592" height="432" rx="10" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2"/>
     <text x="320" y="240" text-anchor="middle" font-family="Georgia, serif" font-size="34" fill="#ffffff" fill-opacity="0.95">${label}</text>
     ${sub ? `<text x="320" y="282" text-anchor="middle" font-family="monospace" font-size="17" fill="#ffffff" fill-opacity="0.8">${sub}</text>` : ""}`,
  );
}

/* ── PDF generation ───────────────────────────────────────────────────────────
   The real app issues plans and signable documents as PDFs (pdfkit), so the
   demo does too — that's what gives the client in-browser view + download +
   print. Palette mirrors lib/documents.ts. */

const INK = "#283021";
const GRAY = "#6b6b63";
const ACCENT = "#4c5a40";

function pdfBuffer(options, build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(options);
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    doc.end();
  });
}

/** Blueprint-style plan sheet (landscape letter). `rev` toggles the
 *  pantry/island variant so v1 and v2 are visibly different. */
function planPdf(rev) {
  return pdfBuffer({ size: "LETTER", layout: "landscape", margin: 36 }, (doc) => {
    const x0 = 96, y0 = 110, w = 600, h = 360;
    doc.rect(0, 0, doc.page.width, doc.page.height).fill("#f6f3ec");
    // survey grid
    doc.strokeColor(INK).opacity(0.14).lineWidth(0.7);
    for (let x = x0; x <= x0 + w; x += 30) doc.moveTo(x, y0).lineTo(x, y0 + h).stroke();
    for (let y = y0; y <= y0 + h; y += 30) doc.moveTo(x0, y).lineTo(x0 + w, y).stroke();
    doc.opacity(1);
    // walls
    doc.strokeColor(INK).lineWidth(3);
    doc.rect(x0, y0, w, h).stroke();
    doc.moveTo(x0 + 270, y0).lineTo(x0 + 270, y0 + 195).stroke();
    doc.moveTo(x0 + 270, y0 + 195).lineTo(x0, y0 + 195).stroke();
    doc.moveTo(x0 + 420, y0 + (rev ? 165 : 195)).lineTo(x0 + w, y0 + (rev ? 165 : 195)).stroke();
    doc.lineWidth(2);
    if (rev) doc.rect(x0 + 310, y0 + 90, 150, 68).stroke();
    else doc.rect(x0 + 500, y0 + 15, 75, 105).stroke();
    // labels
    doc.fillColor(INK).font("Courier-Bold").fontSize(11);
    doc.text("KITCHEN", x0 + 40, y0 + 60);
    doc.text("DINING", x0 + 40, y0 + 280);
    doc.text("LIVING", x0 + 350, y0 + 280);
    doc.fontSize(9);
    doc.text(rev ? "PANTRY > MUDROOM" : "MUDROOM", x0 + 440, y0 + 30);
    if (rev) doc.text("ISLAND 8FT", x0 + 340, y0 + 118);
    else doc.text("PANTRY", x0 + 508, y0 + 60);
    // title block
    doc.font("Courier").fontSize(10).fillColor(GRAY);
    doc.text(
      `SJ CARPENTRY LLC · BIRCHWOOD KITCHEN & MAIN FLOOR · REV ${rev ? "B" : "A"} · SCALE 1/4" = 1'-0"`,
      x0,
      y0 + h + 22,
    );
  });
}

/** Signable-document PDF on company letterhead (portrait letter), matching the
 *  look of lib/documents.ts renderers. */
function docPdf({ title, subtitle, body, signedLine = null }) {
  return pdfBuffer({ size: "LETTER", margin: 56 }, (doc) => {
    const w = doc.page.width - 112;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(13)
      .text("SJ CARPENTRY LLC", 56, doc.y, { width: w, align: "center", characterSpacing: 0.5 });
    doc.moveDown(0.15);
    doc.font("Helvetica").fontSize(8.5).fillColor(GRAY)
      .text("Minnetonka, MN   ·   josephstafki@sjcarpentryllc.com", { width: w, align: "center" });
    doc.moveDown(0.5);
    doc.strokeColor(ACCENT).lineWidth(1.5).moveTo(56, doc.y).lineTo(56 + w, doc.y).stroke();
    doc.moveDown(0.6);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(title.toUpperCase());
    doc.font("Helvetica").fontSize(9.5).fillColor(GRAY).text(subtitle);
    doc.fillColor(INK).moveDown(0.6);
    doc.font("Helvetica").fontSize(10).text(body, { lineGap: 3 });
    if (signedLine) {
      doc.moveDown(1);
      doc.strokeColor(GRAY).lineWidth(0.7).moveTo(56, doc.y).lineTo(56 + 220, doc.y).stroke();
      doc.moveDown(0.2);
      doc.font("Helvetica-Oblique").fontSize(10).text(signedLine);
    }
    doc.moveDown(1.2);
    doc.font("Helvetica").fontSize(8.5).fillColor(GRAY)
      .text(
        "This document is signed electronically through the SJ Carpentry client portal. " +
          "The signature record — typed name, timestamp, and consent — is retained alongside this document.",
      );
  });
}

/* ── Document bodies (shared by the PDFs and the signature-request rows) ───── */

const CONTRACT_BODY =
  'This Agreement is between SJ Carpentry LLC ("Contractor") and Dana & Marcus Holt ("Client") ' +
  "for the remodel of the kitchen and main floor at 4211 Birchwood Ln, Minnetonka, MN, for the " +
  "Total Price of $78,430 per the attached Scope of Work and Estimate. Payments are due per the " +
  "Payment Schedule within 7 days of each invoice. Any change to the scope must be authorized in " +
  "writing via a signed Change Order before the work proceeds. Contractor warrants its workmanship " +
  "for one (1) year from substantial completion.";

const ESTIMATE_BODY = [
  "ESTIMATE — Birchwood Kitchen & Main Floor",
  "",
  "Kitchen",
  "  Demo & disposal ............................................ $5,520",
  "  Custom cabinetry — perimeter + island, white oak .......... $36,800",
  "  Quartz countertops, 62 sq ft installed ..................... $7,843",
  "Flooring",
  "  White oak flooring, 5 in select, 640 sq ft ................ $10,672",
  "  Refinish stair treads to match ............................. $2,415",
  "General",
  "  Electrical rough-in + fixture install ...................... $8,970",
  "  Plumbing rough-in + trim-out ............................... $6,210",
  "",
  "Subtotal (cost) ............................................. $68,200",
  "Overhead & profit ........................................... $10,230",
  "TOTAL ....................................................... $78,430",
  "",
  "Payment schedule: 10% deposit · 40% at rough-in · 30% at cabinets · 20% at substantial completion.",
  "",
  "By signing, you approve this estimate and authorize SJ Carpentry LLC to proceed to contract.",
].join("\n");

const CO_BODY = [
  "CHANGE ORDER 01 — Birchwood Kitchen & Main Floor",
  "",
  "Add a dedicated switched circuit over the island and hang two client-supplied pendants. " +
    "Includes patch + paint at the switch leg.",
  "",
  "Change-order amount: $1,850 · added to the final invoice.",
  "",
  "By signing, you approve this change to the scope of work and the associated price. " +
    "This amount is in addition to your original contract.",
].join("\n");

/** [file id, display name, async () => Buffer] — PDFs written to uploads/. */
const PDFS = [
  ["demo-fp-1", "Main floor plan — Rev A.pdf", () => planPdf(false)],
  ["demo-fp-2", "Main floor plan — Rev B.pdf", () => planPdf(true)],
  ["demo-doc-contract", "Construction contract.pdf", () =>
    docPdf({
      title: "Construction contract",
      subtitle: "Birchwood Kitchen & Main Floor — Dana & Marcus Holt",
      body: CONTRACT_BODY,
      signedLine: "Dana Holt — signed electronically",
    })],
  ["demo-doc-estimate", "Final estimate.pdf", () =>
    docPdf({
      title: "Final estimate — main floor remodel",
      subtitle: "Birchwood Kitchen & Main Floor — $78,430",
      body: ESTIMATE_BODY,
    })],
  ["demo-doc-co", "Change order 01.pdf", () =>
    docPdf({
      title: "CO-01 · Island pendant circuit",
      subtitle: "Birchwood Kitchen & Main Floor — +$1,850",
      body: CO_BODY,
    })],
];

/** [file id, display name, svg string] */
const ART = [
  ["demo-mood-1", "White oak cabinetry.svg", productSvg("White oak cabinetry", "#b99e77", "#8a7250")],
  ["demo-mood-2", "Matte black pendant.svg", productSvg("Matte black pendant", "#4a4a4a", "#1f1f1f")],
  ["demo-mood-3", "Zellige backsplash.svg", productSvg("Zellige tile", "#dfe5dc", "#aebfa8")],
  ["demo-sel-1", "Delta Trinsic faucet.svg", productSvg("Delta Trinsic", "#5b6770", "#2f3a42", "matte black")],
  ["demo-sel-2", "Moen Align faucet.svg", productSvg("Moen Align", "#8d99a6", "#5a6672", "brushed nickel")],
  ["demo-sel-3", "Emtek knob set.svg", productSvg("Emtek Trinity", "#7a6a58", "#4d4237", "knob set")],
  ["demo-sel-4", "Top Knobs Barrington.svg", productSvg("Top Knobs", "#9a8b7a", "#6b5d4e", "Barrington")],
  ["demo-sel-5", "Zellige 2x6 weathered white.svg", productSvg("Zellige 2×6", "#e8e4d8", "#c5bfae", "weathered white")],
  ["demo-sel-6", "Marble herringbone.svg", productSvg("Herringbone", "#d8dbe0", "#a8aeb8", "honed marble")],
  ["demo-sel-7", "Cedar and Moss sconce.svg", productSvg("Cedar & Moss", "#c98f5a", "#96602f", "double sconce")],
  ["demo-sel-8", "Rejuvenation sconce.svg", productSvg("Rejuvenation", "#b8b3a7", "#807a6c", "single sconce")],
];

/* ── Seed ─────────────────────────────────────────────────────────────────── */

const client = new pg.Client({ connectionString: url });
await client.connect();
const sql = (text, params = []) => client.query(text, params);

try {
  await sql("BEGIN");

  /* Clean out any previous demo run. Project cascade takes every
     project-scoped row (invoices, selections, mood, plans, punch, estimates,
     signature requests, schedule blocks, daily logs) with it. */
  await sql(`DELETE FROM projects WHERE slug = $1`, [SLUG]);
  await sql(`DELETE FROM chat_messages WHERE channel_key = $1`, [`portal:${SLUG}`]);
  await sql(`DELETE FROM client_portal_invites WHERE project_slug = $1`, [SLUG]);
  await sql(`DELETE FROM files WHERE id LIKE 'demo-%'`);

  /* Blobs + file rows. */
  for (const [id, name, svg] of ART) {
    const storage = `${id}.svg`;
    writeFileSync(path.join(UPLOAD_DIR, storage), svg, "utf8");
    await sql(
      `INSERT INTO files (id, project_key, type, name, tag, storage_path, mime_type, modified_label, size_label)
       VALUES ($1, $2, 'img', $3, 'DEMO', $4, 'image/svg+xml', 'today', '4 KB')`,
      [id, SLUG, name, storage],
    );
  }
  for (const [id, name, build] of PDFS) {
    const storage = `${id}.pdf`;
    writeFileSync(path.join(UPLOAD_DIR, storage), await build());
    await sql(
      `INSERT INTO files (id, project_key, type, name, tag, storage_path, mime_type, modified_label, size_label)
       VALUES ($1, $2, 'doc', $3, 'DEMO', $4, 'application/pdf', 'today', '12 KB')`,
      [id, SLUG, name, storage],
    );
  }

  /* Project. */
  const { rows: [proj] } = await sql(
    `INSERT INTO projects (slug, name, status, client_name, client_email, address,
                           contract_value, collected_to_date, progress,
                           value_display, sub_label, stage_label,
                           start_date, target_end_date)
     VALUES ($1, 'Birchwood Kitchen & Main Floor', 'construction',
             'Dana & Marcus Holt', $2, '4211 Birchwood Ln, Minnetonka',
             7843000, 784300, 45,
             '$78,430', 'Minnetonka · started 3 weeks ago', 'Rough-in phase',
             CURRENT_DATE - 21, CURRENT_DATE + 60)
     RETURNING id`,
    [SLUG, CLIENT_EMAIL],
  );
  const pid = proj.id;

  /* Client account (password "sjcos") + a live invite link. Upsert keeps the
     user id stable across reseeds — deleting + reinserting would strand any
     logged-in demo browser on a stale session cookie. */
  await sql(
    `INSERT INTO users (email, password_hash, name, role, initials, link_slug)
     VALUES ($1, $2, 'Dana Holt', 'client', 'DH', $3)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name,
           role = 'client', initials = 'DH', link_slug = EXCLUDED.link_slug,
           active = true, portal_claimed_at = NULL`,
    [CLIENT_EMAIL, DEMO_HASH, SLUG],
  );
  await sql(
    `INSERT INTO client_portal_invites (project_slug, to_email, to_name, token, expires_at, status)
     VALUES ($1, $2, 'Dana Holt', 'demo0aa1bb2cc3dd4ee5ff6007281994aabbccddeeff0011', now() + interval '30 days', 'active')`,
    [SLUG, CLIENT_EMAIL],
  );

  /* Floor plans: Rev A approved earlier, Rev B awaiting approval. Both
     published — plans reach the portal only once published_at is set. */
  await sql(
    `INSERT INTO project_floorplans (project_id, version, file_id, notes, created_at, published_at, client_approved_at, client_approved_name)
     VALUES ($1, 1, 'demo-fp-1', 'Original layout from the site measure.', now() - interval '18 days', now() - interval '18 days', now() - interval '15 days', 'Dana Holt'),
            ($1, 2, 'demo-fp-2', 'Rev B — pantry folded into the mudroom wall, island stretched to 8 ft. This is the version we''d build from.', now() - interval '2 days', now() - interval '2 days', NULL, '')`,
    [pid],
  );

  /* Mood board — one kitchen canvas with placed items, published to the
     portal (boards are owner-only until published_at is set). */
  await sql(
    `INSERT INTO project_mood_boards (project_id, room, title, bg_color, published_at)
     VALUES ($1, 'Kitchen', 'Warm modern kitchen', '', now() - interval '9 days')`,
    [pid],
  );
  const mood = [
    // [kind, note, label, price_label, swatch, image, x, y, w, rot, z]
    ["pin", "", "White oak cabinetry", "$185 / sq ft", "", "demo-mood-1", 0.03, 0.06, 0.3, -1.5, 1],
    ["pin", "over the island", "Matte black pendant", "$240 ea", "", "demo-mood-2", 0.36, 0.04, 0.24, 1, 2],
    ["pin", "", "Zellige backsplash", "$28 / sq ft", "", "demo-mood-3", 0.63, 0.1, 0.31, 2, 3],
    ["swatch", "cabinet sage", "Sage green", "", "#8a9a7b", null, 0.08, 0.58, 0.12, 0, 4],
    ["swatch", "island oak", "Warm oak", "", "#c8a97a", null, 0.23, 0.63, 0.12, 3, 5],
    ["text", "", "Warm woods, matte black accents, tile with movement.", "", "", null, 0.44, 0.6, 0.32, -1, 6],
  ];
  for (const [kind, note, label, price, swatch, img, x, y, w, rot, z] of mood) {
    await sql(
      `INSERT INTO project_mood (project_id, room, kind, note, label, price_label, swatch,
                                 image_file_id, pos_x, pos_y, pos_w, pos_rot, sort_order)
       VALUES ($1, 'Kitchen', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [pid, kind, note, label, price, swatch, img, x, y, w, rot, z],
    );
  }

  /* Selections: two rooms, five decisions in every state. Dollars, not cents. */
  const { rows: [kitchen] } = await sql(
    `INSERT INTO project_sections (project_id, name, budget, sort_order) VALUES ($1, 'Kitchen', 18000, 1) RETURNING id`,
    [pid],
  );
  const { rows: [bath] } = await sql(
    `INSERT INTO project_sections (project_id, name, budget, sort_order) VALUES ($1, 'Primary bath', 6500, 2) RETURNING id`,
    [pid],
  );

  async function decision(sectionId, area, choice, allowance, status, options, chosenIdx = -1) {
    const { rows: [d] } = await sql(
      `INSERT INTO project_selections (project_id, section_id, area, choice, allowance, status, pushed_at, decided_at, price)
       VALUES ($1, $2, $3, $4, $5, $6,
               now() - interval '6 days',
               CASE WHEN $6 IN ('approved','declined') THEN now() - interval '3 days' END,
               0)
       RETURNING id`,
      [pid, sectionId, area, choice, allowance, status],
    );
    let chosen = null;
    for (let i = 0; i < options.length; i++) {
      const [name, brand, price, img, note] = options[i];
      const { rows: [o] } = await sql(
        `INSERT INTO project_selection_options (selection_id, name, brand, price, image_file_id, note, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [d.id, name, brand, price, img, note, i + 1],
      );
      if (i === chosenIdx) chosen = o.id;
    }
    if (chosen) {
      const price = options[chosenIdx][2];
      await sql(
        `UPDATE project_selections SET chosen_option_id = $2, price = $3 WHERE id = $1`,
        [d.id, chosen, price],
      );
    }
  }

  await decision(kitchen.id, "Kitchen faucet", "pull-down, single handle", 450, "pending", [
    ["Trinsic pull-down, matte black", "Delta", 389, "demo-sel-1", "In stock at Ferguson"],
    ["Align pull-down, brushed nickel", "Moen", 520, "demo-sel-2", "2-week lead time"],
  ]);
  await decision(kitchen.id, "Cabinet hardware", "knobs on doors, pulls on drawers", 480, "pending", [
    ["Trinity knob + pull set", "Emtek", 415, "demo-sel-3", ""],
    ["Barrington set, ash bronze", "Top Knobs", 540, "demo-sel-4", "matches pendant finish"],
  ]);
  await decision(kitchen.id, "Backsplash tile", "full height behind range", 1200, "approved", [
    ["Zellige 2×6, weathered white", "Clé", 1150, "demo-sel-5", "handmade — expect variation"],
    ["Herringbone mosaic, honed marble", "AKDO", 1680, "demo-sel-6", ""],
  ], 0);
  await decision(bath.id, "Vanity lighting", "two fixtures over mirrors", 380, "pending", [
    ["Double sconce, aged brass", "Cedar & Moss", 340, "demo-sel-7", ""],
    ["Single sconce ×2, satin bronze", "Rejuvenation", 430, "demo-sel-8", ""],
  ]);
  await decision(bath.id, "Shower floor tile", "", 900, "declined", [
    ["Penny round, carrara", "Daltile", 860, null, ""],
    ["Hex 2in, thassos", "AKDO", 1240, null, ""],
  ]);

  /* Estimate (sent, awaiting signature) with lines + payment schedule. */
  const { rows: [est] } = await sql(
    `INSERT INTO estimates (project_id, title, rail, status, subtotal, markup_total, total, sent_at, draw_schedule, created_at)
     VALUES ($1, 'Main floor remodel — final estimate', 'design_build', 'sent',
             6820000, 1023000, 7843000, now() - interval '4 days',
             '[{"label":"Deposit","percent":10},{"label":"Rough-in complete","percent":40},{"label":"Cabinets installed","percent":30},{"label":"Substantial completion","percent":20}]',
             now() - interval '5 days')
     RETURNING id`,
    [pid],
  );
  const estLines = [
    ["Kitchen", "Demo & disposal", "ls", 1, 480000, 552000],
    ["Kitchen", "Custom cabinetry — perimeter + island, white oak", "ls", 1, 3200000, 3680000],
    ["Kitchen", "Quartz countertops, 62 sq ft installed", "sqft", 62, 11000, 784300],
    ["Flooring", "White oak flooring, 5 in select, 640 sq ft", "sqft", 640, 1450, 1067200],
    ["Flooring", "Refinish stair treads to match", "ls", 1, 210000, 241500],
    ["General", "Electrical rough-in + fixture install", "ls", 1, 780000, 897000],
    ["General", "Plumbing rough-in + trim-out", "ls", 1, 540000, 621000],
  ];
  for (let i = 0; i < estLines.length; i++) {
    const [section, desc, unit, qty, unitCost, extended] = estLines[i];
    await sql(
      `INSERT INTO estimate_lines (estimate_id, description, section, unit, qty, unit_cost, markup, extended, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, 15, $7, $8)`,
      [est.id, desc, section, unit, qty, unitCost, extended, i + 1],
    );
  }

  /* Change order (sent). */
  const { rows: [co] } = await sql(
    `INSERT INTO change_orders (project_id, title, description, price_cents, status, created_at)
     VALUES ($1, 'CO-01 · Island pendant circuit', 'Add a dedicated switched circuit over the island and hang two client-supplied pendants. Includes patch + paint at the switch leg.', 185000, 'sent', now() - interval '2 days')
     RETURNING id`,
    [pid],
  );

  /* Signature requests: contract already signed; estimate + CO awaiting. Each
     carries its PDF (file_id) — the portal displays, downloads, and prints it. */
  await sql(
    `INSERT INTO signature_requests (project_id, doc_type, title, body, file_id, status, signer_name, signer_email,
                                     signed_name, signed_at, consent, sent_at, created_at)
     VALUES ($1, 'contract', 'Construction contract — Birchwood Kitchen & Main Floor',
             $3, 'demo-doc-contract',
             'signed', 'Dana Holt', $2, 'Dana Holt', now() - interval '14 days', true,
             now() - interval '16 days', now() - interval '16 days')`,
    [pid, CLIENT_EMAIL, CONTRACT_BODY],
  );
  await sql(
    `INSERT INTO signature_requests (project_id, doc_type, title, body, file_id, status, signer_name, signer_email,
                                     estimate_id, sent_at, created_at)
     VALUES ($1, 'estimate', 'Final estimate — main floor remodel ($78,430)',
             $4, 'demo-doc-estimate',
             'sent', 'Dana Holt', $2, $3, now() - interval '4 days', now() - interval '4 days')`,
    [pid, CLIENT_EMAIL, est.id, ESTIMATE_BODY],
  );
  await sql(
    `INSERT INTO signature_requests (project_id, doc_type, title, body, file_id, status, signer_name, signer_email,
                                     change_order_id, sent_at, created_at)
     VALUES ($1, 'change_order', 'CO-01 · Island pendant circuit (+$1,850)',
             $4, 'demo-doc-co',
             'sent', 'Dana Holt', $2, $3, now() - interval '2 days', now() - interval '2 days')`,
    [pid, CLIENT_EMAIL, co.id, CO_BODY],
  );

  /* Invoices: deposit paid, rough-in draw open. */
  await sql(
    `INSERT INTO invoices (project_id, number, milestone, amount, line_items, status, sent_at, paid_at, created_at)
     VALUES ($1, 'INV-001', 'Deposit (10%)', 784300,
             '[{"label":"Deposit per contract — 10% of $78,430","amount":784300}]',
             'paid', now() - interval '13 days', now() - interval '11 days', now() - interval '13 days'),
            ($1, 'INV-002', 'Rough-in complete (40%)', 3137200,
             '[{"label":"Progress draw — rough-in complete","amount":2800000},{"label":"Electrical fixture allowance drawn","amount":337200}]',
             'sent', now() - interval '5 days', NULL, now() - interval '5 days')`,
    [pid],
  );

  /* Schedule: a believable three weeks around today. */
  const blocks = [
    [-2, "8:00", 480, "Electrical rough-in — Twin City Electric", "accent"],
    [-1, "AM", 540, "Plumbing top-out — Reyes Plumbing", "ghost"],
    [0, "1:00", 780, "City inspection — rough-in", "accent"],
    [2, "all", 0, "Insulation", "ghost"],
    [5, "8:00", 480, "Drywall hang starts", "accent"],
    [9, "all", 0, "Drywall finish + sand", "ghost"],
    [12, "AM", 540, "Cabinet delivery", "accent"],
    [14, "8:00", 480, "Cabinet install week begins", "accent"],
  ];
  for (const [off, time, sortMin, label, tone] of blocks) {
    await sql(
      `INSERT INTO schedule_blocks (project_id, block_date, time_label, sort_min, label, tone)
       VALUES ($1, CURRENT_DATE + $2::int, $3, $4, $5, $6)`,
      [pid, off, time, sortMin, label, tone],
    );
  }

  /* Daily logs → the portal journal. */
  const logs = [
    [-6, "Demo wrapped and the floor is clean. Found knob-and-tube in the west wall — already priced into the electrical line, no surprise cost. Framing corrections start tomorrow."],
    [-3, "Framing corrections done and the island footprint is snapped on the slab. Electricians rough in Thursday, plumber follows Friday. It'll look like chaos — that's normal for this week."],
    [-1, "Electrical rough-in is 80% done; plumbing top-out finishes tomorrow morning. City inspector is booked for the rough-in check. If that passes we insulate this week and you'll see drywall by next Friday."],
  ];
  for (const [off, body] of logs) {
    await sql(
      `INSERT INTO daily_logs (project_id, log_date, body) VALUES ($1, CURRENT_DATE + $2::int, $3)`,
      [pid, off, body],
    );
  }

  /* Portal message thread. */
  const msgs = [
    ["owner", "Joe Stafki", "JS", "Welcome to your project portal! Everything lives here — plans, selections, documents, schedule, invoices. Fastest way to reach me is right in this thread.", 7],
    ["user", "Dana Holt", "DH", "This is great. Quick one — can the island end panel match the perimeter door style?", 6],
    ["owner", "Joe Stafki", "JS", "Yes — same shaker profile, grain running vertical. I'll have the shop drawing in your next plan revision (Rev B, it's up now under Floor plans).", 6],
    ["user", "Dana Holt", "DH", "Saw it, looks right. We'll pick the faucet + hardware tonight.", 1],
  ];
  for (const [kind, name, initials, body, daysAgo] of msgs) {
    await sql(
      `INSERT INTO chat_messages (channel_key, author_kind, author_name, author_initials, body, created_at)
       VALUES ($1, $2, $3, $4, $5, now() - ($6 || ' days')::interval)`,
      [`portal:${SLUG}`, kind, name, initials, body, String(daysAgo)],
    );
  }

  /* Punch: one confirmed, one waiting on the client, one still open. */
  await sql(
    `INSERT INTO project_punch (project_id, item, owner_name, done, sort_order, client_confirmed_at) VALUES
       ($1, 'Touch up paint — stair stringer', 'Joe', true, 1, now() - interval '2 days'),
       ($1, 'Adjust pantry door reveal', 'Joe', true, 2, NULL),
       ($1, 'Install closet shelving', 'Joe', false, 3, NULL)`,
    [pid],
  );

  await sql("COMMIT");
  console.log("portal demo seeded.");
  console.log("  client login:  client@demo.test / sjcos");
  console.log("  owner login:   josephstafki@sjcarpentryllc.com / sjcos");
  console.log(`  invite link:   /client-portal/enter?token=demo0aa1bb2cc3dd4ee5ff6007281994aabbccddeeff0011`);
} catch (e) {
  await sql("ROLLBACK");
  throw e;
} finally {
  await client.end();
}
