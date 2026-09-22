// Project financials — fixtures. Client-safe data only (no db, no runtime
// imports): raw rows for lib/budget-assemble.ts, used by the tests, by the dev
// preview of the panel, and as the worked examples for agents filling a job
// from documents. Expected numbers live in tests/budget-*.test.mjs and in
// docs/project-financials-plan.md §9.

import type { RawProjectMoney } from "./budget-assemble.ts";

const c = (dollars: number) => Math.round(dollars * 100);

/** The day the kitchen fixture's numbers are true. */
export const KITCHEN_AS_OF = "2026-09-21";

/** A synthetic fixed-price kitchen, chosen so every number can be checked by
 *  hand. One $18,000 cabinet PO shows all three states of real money at once:
 *  a $10,000 deposit paid against it (spent), $12,000 of boxes received so
 *  $2,000 is received-not-billed (owed), and $6,000 still to arrive (on order).
 *  CO-1 is signed with no cost plan and part of its cost linked; CO-2 is NOT
 *  signed and already has $300 of material bought for it. */
export const KITCHEN_RAW: RawProjectMoney = {
  project: {
    slug: "sample-kitchen",
    name: "Sample kitchen",
    status: "construction",
    clientName: "Sample Client",
    basis: "fixed_price",
    priceCentsOverride: null,
    contractValueDollars: 60000,
    collectedToDateDollars: 30000,
    approvedEstimateTotalCents: c(60000),
    budgetComplete: true,
    costsThrough: "2026-09-14",
    billingSource: "invoices",
    openingCollectedCents: 0,
    openingBilledCents: 0,
  },
  lines: [
    { id: 1, key: "demo", trade: "Demo", kind: "trade", budgetCents: c(3000), priceCents: c(4000), estToFinishCents: 0, percentComplete: null, status: "Complete", statusKind: "money", creditedCoId: null },
    { id: 2, key: "cabinets", trade: "Cabinets", kind: "trade", budgetCents: c(20000), priceCents: c(27000), estToFinishCents: c(3000), percentComplete: null, status: "In progress", statusKind: "accent", creditedCoId: null },
    { id: 3, key: "electrical", trade: "Electrical", kind: "trade", budgetCents: c(5000), priceCents: c(8000), estToFinishCents: 0, percentComplete: null, status: "Rough-in done", statusKind: "accent", creditedCoId: null },
    { id: 4, key: "labor", trade: "SJ Carpentry labor", kind: "trade", budgetCents: c(15000), priceCents: c(21000), estToFinishCents: c(9000), percentComplete: null, status: "In progress", statusKind: "accent", creditedCoId: null },
  ],
  changeOrders: [
    { id: 11, number: "CO-1", title: "Island outlet", priceCents: c(1200), status: "approved", budgetCostCents: null, estToFinishCents: null, credits: [] },
    { id: 12, number: "CO-2", title: "Pantry", priceCents: c(5000), status: "sent", budgetCostCents: null, estToFinishCents: null, credits: [] },
  ],
  invoices: [
    { number: "INV-001", milestone: "Deposit + demo", amountCents: c(30000), status: "paid", createdOn: "2026-08-01", sentOn: "2026-08-01", paidOn: "2026-08-10" },
    { number: "INV-002", milestone: "Cabinet delivery", amountCents: c(12000), status: "sent", createdOn: "2026-09-04", sentOn: "2026-09-04", paidOn: null },
  ],
  purchaseOrders: [
    { id: 31, poNumber: "PO-001", vendorName: "Northland Cabinets", title: "Kitchen cabinets", status: "partial", subtotalCents: c(18000), receivedValueCents: c(12000), on: "2026-08-12", budgetLineId: 2, changeOrderId: null },
  ],
  subInvoices: [
    { id: 41, vendor: "Rivera Demo", amountCents: c(3200), status: "paid", on: "2026-08-08", budgetLineId: 1, changeOrderId: null, purchaseOrderId: null, sourceRef: "rivera:1021" },
    { id: 42, vendor: "Volt Electric", amountCents: c(4800), status: "approved", note: "Rough-in", on: "2026-09-02", budgetLineId: 3, changeOrderId: null, purchaseOrderId: null, sourceRef: "volt:884" },
    { id: 43, vendor: "Volt Electric", amountCents: c(700), status: "submitted", note: "Island outlet rough-in", on: "2026-09-10", budgetLineId: null, changeOrderId: 11, purchaseOrderId: null, sourceRef: "volt:891" },
  ],
  expenses: [
    { id: 51, vendorLabel: "Northland Cabinets", kind: "material", amountCents: c(10000), memo: "Cabinet deposit, check 2204", on: "2026-08-12", budgetLineId: null, changeOrderId: null, purchaseOrderId: 31, sourceRef: "check:2204" },
    { id: 52, vendorLabel: "SJ Carpentry", kind: "labor", amountCents: c(6000), memo: "Crew hours through Sep 14", on: "2026-09-14", budgetLineId: 4, changeOrderId: null, purchaseOrderId: null },
    { id: 53, vendorLabel: "Menards", kind: "material", amountCents: c(300), memo: "Pantry shelving stock", on: "2026-09-12", budgetLineId: null, changeOrderId: 12, purchaseOrderId: null },
  ],
  parties: [],
  fundingEvents: [],
};

/** The day the Egan numbers are true (from Joe's packet). */
export const EGAN_AS_OF = "2026-09-18";

/** The Egan insurance restoration, converted from the packet's sample to v2
 *  semantics. Differences from the packet, all deliberate:
 *   - What subs charged is COST (spent / owed). What the client paid is
 *     BILLING (collected), with the $10,000 carried on the Houzz estimate as
 *     the opening balance — so collected is $31,666.36, never $21,666.36.
 *   - Each trade's planned cost is set equal to the carrier's line price, and
 *     GC overhead & profit carries a price and no cost, so the PLANNED profit
 *     is exactly the O&P ($14,223.72). That is an assumption, stated in notes.
 *   - Kunkel's $15,860 is split across what it actually covers: the base
 *     contract, CO-3, and $525 nobody has placed yet (left unassigned).
 *   - The insulation and bathroom lines are credited to CO-1 / CO-2, but those
 *     are not signed, so the lines stay in the cost until they are. */
export const EGAN_RAW: RawProjectMoney = {
  project: {
    slug: "molly-egan",
    name: "Molly Egan",
    status: "construction",
    clientName: "Client",
    basis: "insurance",
    budgetLabel: "insurance budget",
    budgetCaption: "Dwelling RCV $72,644.31 + code-upgrade coverage $13,194.00. Includes the $10,000 deductible the client pays.",
    priceCentsOverride: c(85838.31),
    contractValueDollars: 63539,
    collectedToDateDollars: 31667,
    approvedEstimateTotalCents: null,
    budgetComplete: true,
    costsThrough: "2026-09-18",
    billingSource: "invoices",
    openingCollectedCents: c(10000),
    openingBilledCents: c(10000),
    openingNote: "$10,000 carried on Houzz estimate ES-10165 before invoices were tracked here.",
    notes: [
      "Each trade's planned cost is set equal to the carrier's line price, so planned profit equals GC overhead & profit. Replace with sub bids as they land.",
      "Electrical base ($12,570) exceeds the $10,995 bid USAA priced from. Ordinance & Law cap is $20,000; supplement with the Kunkel invoice and request the $13,194 now.",
      "Radiator disconnect/reconnect ($1,125) is not in the claim. Add to the supplement.",
      "Kunkel's $15,860 is $525 more than base + CO-3 (option G?). Left unassigned until confirmed.",
      "Bathroom renovation total is a placeholder until an estimate exists.",
      "GC overhead and profit ($14,224) has not been billed on any draw yet.",
    ],
  },
  lines: [
    { id: 101, key: "plaster", trade: "Lath & plaster", detail: "Two-coat over metal lath, 4 rooms", source: "USAA lines 3, 5, 23, 25, 44, 46, 63, 65 less tear-off", kind: "trade", budgetCents: c(31732.5), priceCents: c(31732.5), estToFinishCents: null, percentComplete: null, status: "Not started", statusKind: "ghost", creditedCoId: null },
    { id: 102, key: "electrical", trade: "Electrical (code upgrade)", detail: "Kunkel base contract, Ordinance & Law", source: "USAA bid item $10,995; pays $13,194 with O&P, cap $20,000", kind: "trade", budgetCents: c(10995), priceCents: c(10995), estToFinishCents: 0, percentComplete: null, status: "Rough-in done", statusKind: "accent", creditedCoId: null, flags: ["Supplement candidate"] },
    { id: 103, key: "paint", trade: "Painting", detail: "Primer, two coats, trim, floor protection", kind: "trade", budgetCents: c(7743.49), priceCents: c(7743.49), estToFinishCents: null, percentComplete: null, status: "Not started", statusKind: "ghost", creditedCoId: null },
    { id: 104, key: "demo", trade: "Demolition & haul-off", detail: "CPK #1745, #1750, dumpster", kind: "trade", budgetCents: c(7008.15), priceCents: c(7008.15), estToFinishCents: 0, percentComplete: 100, status: "Complete", statusKind: "money", creditedCoId: null },
    { id: 105, key: "floors", trade: "Wood floor refinish", detail: "Sand, stain, finish", kind: "trade", budgetCents: c(3049.19), priceCents: c(3049.19), estToFinishCents: null, percentComplete: null, status: "Not started", statusKind: "ghost", creditedCoId: null },
    { id: 106, key: "moving", trade: "Contents / moving", detail: "Minne Movers, Matts Movers", kind: "trade", budgetCents: c(337.31), priceCents: c(337.31), estToFinishCents: c(1000), percentComplete: null, status: "Move-back pending", statusKind: "accent", creditedCoId: null },
    { id: 107, key: "trim", trade: "Trim / finish carpentry", detail: "Base, shoe, casing D&R", kind: "trade", budgetCents: c(2754.62), priceCents: c(2754.62), estToFinishCents: null, percentComplete: null, status: "Not started", statusKind: "ghost", creditedCoId: null },
    { id: 108, key: "plumbing", trade: "Plumbing / radiators", detail: "Erickson disconnect + reconnect", source: "Not in the USAA estimate", kind: "trade", budgetCents: 0, priceCents: 0, estToFinishCents: 0, percentComplete: null, status: "Reconnect at finish", statusKind: "accent", creditedCoId: null, flags: ["Supplement candidate"] },
    { id: 109, key: "lights", trade: "Light fixtures", detail: "Detach & reset, 9 fixtures", kind: "trade", budgetCents: c(809.19), priceCents: c(809.19), estToFinishCents: null, percentComplete: null, status: "Not started", statusKind: "ghost", creditedCoId: null },
    { id: 110, key: "fiber", trade: "Ceiling fiberboard", detail: "Install after demo", kind: "trade", budgetCents: c(690.95), priceCents: c(690.95), estToFinishCents: null, percentComplete: null, status: "Not started", statusKind: "ghost", creditedCoId: null },
    { id: 111, key: "clean", trade: "Final cleaning", kind: "trade", budgetCents: c(206.17), priceCents: c(206.17), estToFinishCents: null, percentComplete: null, status: "Not started", statusKind: "ghost", creditedCoId: null },
    { id: 112, key: "insulation", trade: "Insulation", detail: "R-50 blown-in allowance", kind: "trade", budgetCents: c(1878.41), priceCents: c(1878.41), estToFinishCents: null, percentComplete: null, status: "Credited to CO-1 once signed", statusKind: "info", creditedCoId: 121 },
    { id: 113, key: "bath-tile", trade: "Bathroom tile & board", detail: "R&R 74 SF", kind: "trade", budgetCents: c(2547.82), priceCents: c(2547.82), estToFinishCents: null, percentComplete: null, status: "Credited to CO-2 once signed", statusKind: "info", creditedCoId: 122 },
    { id: 114, key: "bath-fix", trade: "Bathroom fixtures D&R", detail: "Toilet, pedestal sink", kind: "trade", budgetCents: c(1064.49), priceCents: c(1064.49), estToFinishCents: null, percentComplete: null, status: "Credited to CO-2 once signed", statusKind: "info", creditedCoId: 122 },
    { id: 115, key: "tax", trade: "Sales tax reimbursement", kind: "tax", budgetCents: c(797.3), priceCents: c(797.3), estToFinishCents: null, percentComplete: null, creditedCoId: null },
    { id: 116, key: "op", trade: "GC overhead & profit", detail: "20% on claim lines incl. electrical", kind: "overhead", budgetCents: 0, priceCents: c(14223.72), estToFinishCents: 0, percentComplete: null, status: "Not yet billed", statusKind: "ghost", creditedCoId: null },
  ],
  changeOrders: [
    { id: 121, number: "CO-1", title: "Spray foam insulation", description: "Closed-cell foam at the attic roof deck and slants plus exterior walls, replacing the base blown-in.", vendorLabel: "M&M Insulation proposal", priceCents: c(11878.8), status: "sent", budgetCostCents: c(11878.8), estToFinishCents: null, credits: [{ budgetLineId: 112, amountCents: c(1878.41) }] },
    { id: 122, number: "CO-2", title: "Full bathroom renovation", description: "Full renovation instead of the base tile repair and fixture reset. Includes Kunkel option G, exhaust fan/heater.", vendorLabel: "No estimate yet", priceCents: c(22525), status: "draft", budgetCostCents: null, estToFinishCents: null, credits: [{ budgetLineId: 113, amountCents: c(2547.82) }, { budgetLineId: 114, amountCents: c(1064.49) }] },
    { id: 123, number: "CO-3", title: "Electrical upgrades", description: "Kunkel options B, C, F: extra sconces, extra switches, two dedicated A/C circuits.", vendorLabel: "Tim Kunkel Electric", priceCents: c(2765), status: "approved", budgetCostCents: null, estToFinishCents: null, credits: [] },
  ],
  invoices: [
    { number: "IN-10047", milestone: "Minne Movers, CPK demo #1", amountCents: c(4350), status: "paid", createdOn: "2026-05-19", sentOn: "2026-05-19", paidOn: "2026-05-29" },
    { number: "IN-10048", milestone: "CPK demo #2, Kunkel base", amountCents: c(15720), status: "paid", createdOn: "2026-06-13", sentOn: "2026-06-13", paidOn: "2026-06-15" },
    { number: "IN-10052", milestone: "Erickson 50%", amountCents: c(562.5), status: "paid", createdOn: "2026-06-25", sentOn: "2026-06-25", paidOn: "2026-07-01" },
    { number: "IN-10053", milestone: "Matts Movers", amountCents: c(1033.86), status: "paid", createdOn: "2026-07-23", sentOn: "2026-07-23", paidOn: "2026-08-03" },
  ],
  purchaseOrders: [
    // A proposal is not a promise: a draft PO shows in the ledger and counts for nothing.
    { id: 131, poNumber: "", vendorName: "M&M Insulation #5505", title: "Spray foam proposal", status: "draft", subtotalCents: c(11878.8), receivedValueCents: 0, on: "2026-06-30", budgetLineId: null, changeOrderId: 121 },
  ],
  subInvoices: [
    { id: 141, vendor: "Minne Movers #1004", amountCents: c(425), status: "paid", note: "Billed to the client at $1,200", on: "2026-05-11", budgetLineId: 106, changeOrderId: null, purchaseOrderId: null, sourceRef: "minne:1004" },
    { id: 142, vendor: "CPK #1745", amountCents: c(3150), status: "paid", note: "Ceilings, tile surround", on: "2026-05-14", budgetLineId: 104, changeOrderId: null, purchaseOrderId: null, sourceRef: "cpk:1745" },
    { id: 143, vendor: "CPK #1750", amountCents: c(3150), status: "paid", note: "Walls, haul-off", on: "2026-06-01", budgetLineId: 104, changeOrderId: null, purchaseOrderId: null, sourceRef: "cpk:1750" },
    { id: 144, vendor: "Tim Kunkel Electric", amountCents: c(12570), status: "approved", note: "Base contract. 80% due; 20% at final", on: "2026-06-11", budgetLineId: 102, changeOrderId: null, purchaseOrderId: null, sourceRef: "kunkel:0611:base" },
    { id: 145, vendor: "Tim Kunkel Electric", amountCents: c(2765), status: "approved", note: "Options B, C, F", on: "2026-06-11", budgetLineId: null, changeOrderId: 123, purchaseOrderId: null, sourceRef: "kunkel:0611:co3" },
    { id: 146, vendor: "Tim Kunkel Electric", amountCents: c(525), status: "approved", note: "Balance of the $15,860 — option G? Not placed yet", on: "2026-06-11", budgetLineId: null, changeOrderId: null, purchaseOrderId: null, sourceRef: "kunkel:0611:other" },
    { id: 147, vendor: "Erickson #48452", amountCents: c(1125), status: "approved", paidCents: c(562.5), note: "50% paid", on: "2026-06-23", budgetLineId: 108, changeOrderId: null, purchaseOrderId: null, sourceRef: "erickson:48452" },
  ],
  expenses: [
    { id: 151, vendorLabel: "Matts Movers", kind: "sub", amountCents: c(1033.86), memo: "No sub invoice on file", on: "2026-07-23", budgetLineId: 106, changeOrderId: null, purchaseOrderId: null, sourceRef: "matts:0723" },
  ],
  parties: [
    { key: "insurer", label: "USAA", baseShareCents: c(75838.31) },
    { key: "owner", label: "Client", baseShareCents: c(10000), isOwner: true },
  ],
  fundingEvents: [
    { partyKey: "insurer", source: "USAA initial payment (ACV, net of deductible)", amountCents: c(59933.04), trigger: "On the Jun 16 estimate", status: "received" },
    { partyKey: "insurer", source: "USAA code-upgrade payment (Ordinance & Law)", amountCents: c(13194), trigger: "When incurred. Electrical rough-in is done", status: "expected" },
    { partyKey: "insurer", source: "USAA recoverable depreciation", amountCents: c(2711.27), trigger: "At completion, on final invoices", status: "expected" },
    { partyKey: "owner", source: "Client deductible", amountCents: c(10000), trigger: "Netted from the initial payment", status: "received" },
  ],
};
