# SJC OS — Plan vs. Build Comparison
*Generated 2026-06-30 by verifying the live codebase against `docs/sjc-os-plan.md` (plan dated 2026-04-22).*

**Legend:** ✅ Built (real & functional) · 🟡 Partial (exists but limited / showcase / shallow) · ❌ Not built · 🔀 Differs from plan

**Decision column** is for Joe + Claude to fill in: `KEEP` (accept as-is) · `BUILD` (close the gap) · `DEFER` · `DROP` (cut from plan).

---

## ✅ Decisions roll-up (reviewed 2026-06-30)

**KEEP (built, accepted):** A7 architecture · catalog · selections/budgets · portal messaging · sub-portal logging/invoicing · punch list · Gmail inbox · lead AI triage · compliance calendar · `lead-triage` + `weekly-status` skills.

**BUILD (committed to close the gap):**
- **Foundations:** e-signature (4c) · MCP server, AI-agnostic (A6) · shared scheduler (for COI/dunning/warranty/compliance reminders)
- **Pre-con / estimating spine:** browser-extension catalog clipper (3c) · plans-based takeoff + SJC cost book + estimate + merge (3d) · contract + SOW generation (4d) · wire in production doc skills (sow/specs/etc.) · portal document signing (5-sign)
- **Execution:** change orders (7-co) · milestone-invoice automation (7-inv) · schedule auto-gen from template (7-sched) · voice daily logs / Whisper (7-voice) · sub scope+dates (6-scope) · sub doc upload + COI reminders (6-docs) · client uploads + schedule visibility (5-depth)
- **Closeout/warranty/safety:** closeout doc generators + completion outreach (warranty link + Google review) + warranty workflow w/ deadline prompts (§9) · safety orientation + incident reports + per-policy insurance tracking + compliance auto-reminders (§13)
- **Money (collections side):** Day-15 demand letter + Day-30 lien package (8-nonpay) · progress invoicing from estimate
- **Accounting epic — FULL QuickBooks replacement (§8):** bank connection + reconcile · bank rules · 1099 prep/e-file · MN sales tax · P&L/Balance Sheet/cash reports · AI cash-flags. *(Largest, highest-liability build — own sub-plan + CPA review required.)*
- **Comms/marketing/integration:** two-way SMS inbox (A4, low-cost provider + 10DLC) · inbox↔record linking enhance (§12) · social/blog AI drafting, manual post (10-social) · referral tracking + thank-you (10-referral)

**DEFER:** autonomous task loop (A2) · MAN-step engine (A3) · learning layer (A5) · web-form lead intake (2a) · lead Tasks tab (2b) · 5-question qualification (2c) · floor-plan designer (3a) · approval gate (4a) · AI draw schedule (4b) · portal payments (5-pay) · payment processing (8-pay) · A/R + dunning (8-ar) · job costing (7) · website push (§11) · newsletter (10) · permit-packet · cash-flow-optimizer.

**DROP:** *(none yet — nothing cut from the plan.)*

**Re-evaluate:** A1 — keep Qwen but test whether quality is satisfactory; consider a larger local model (drives a later quality pass on triage and all AI output).

### Proposed build order (dependency-aware)
1. **Foundations** — e-sign · scheduler · MCP server.
2. **Estimating spine** — browser extension → takeoff + cost book + estimate + merge → contract/SOW gen + doc skills → portal signing.
3. **Execution** — schedule auto-gen · change orders · milestone invoicing · portal/sub enhancements · voice logs.
4. **Closeout / warranty / safety / compliance** — closeout docs + outreach + warranty workflow · safety/incident · insurance + compliance reminders · demand letter/lien.
5. **Full QuickBooks accounting epic** (own sub-plan + CPA review) → then payments, A/R dunning, job costing, AI draw schedule.
6. **Comms & marketing** — SMS inbox · inbox linking · social drafting · referral tracking · website push.
7. **Deferred epics, when prioritized** — autonomous task loop + MAN steps · learning layer · floor-plan designer · lead-intake/qualification/tasks · newsletter · permit-packet.

---

## Cross-cutting: AI layer & architecture

| # | Plan says | Build reality | Status | Decision |
|---|---|---|---|---|
| A1 | **Claude is the AI layer**, context-aware on every page | In-app AI is **local Qwen 2.5 (Ollama, CPU)**, not Claude. Claude CLI is used only by the `/automate` builder. Page-context serializers exist for lead/project/today only. | 🔀 | **KEEP (Qwen) for now** — evaluate whether it's satisfactory; may trial a larger local model. Keep `ai.ts` provider-agnostic. |
| A2 | Autonomous task loop (do step → approve → next) | No autonomous loop. AI is request/response (draft, triage, summarize, ask). | ❌ | **DEFER** |
| A3 | MAN-step handling (stop & prompt human) | Not modeled as a workflow engine. | ❌ | **DEFER** |
| A4 | Proactive outreach via SMS / email / in-app | In-app notifications ✅; **no SMS** (no Twilio); proactive email only via manual "send weekly status". | 🟡 | **BUILD** — primary purpose is **two-way client/sub coordination (an SMS inbox)**, not just alerts. Prefers a free/cheap self-serve service over porting the GV number. See note. |
| A5 | Learning layer (improves from past jobs/actuals) | Not built. | ❌ | **DEFER** |
| A6 | REST API + **MCP server** for Claude data access | REST-ish API routes exist ✅; **no MCP server** exposing the DB to Claude. | 🟡 | **BUILD** — but it **must stay AI-agnostic** (standard MCP, not Claude-only). |
| A7 | Self-hostable, single DB, mobile-responsive | ✅ Next.js + Postgres, self-hosted (os.sjcarpentryllc.com), responsive. Plus an **Expo/RN mobile app** (`../sjcos-mobile`) — beyond plan. | ✅ | **KEEP** |

> **A4 note — texting reality (clarified):** Use case is **two-way coordination with clients/subs** = an in-OS SMS inbox mirroring the Gmail inbox. There is **no free service that is API-accessible + reliable for business texting**: Google Voice is free but has no API (stays a separate phone app); carrier email-to-SMS gateways are free but one-way/unreliable/deprecated; real two-way needs **Twilio/Telnyx/SignalWire** (~$1–2/mo number + ~$0.008/text) **plus A2P 10DLC registration** (required for US business SMS regardless of provider — GV is exempt only as personal). Decision: build it as a low-cost provider integration; pick provider at build time. Preference recorded for cheapest self-serve option.

---

## 1. Global To-Do Page

| Plan says | Build reality | Status | Decision |
|---|---|---|---|
| AI-maintained cross-business priority view (urgency, deadlines, blocking deps, cash impact) | `/today` derives priorities from real signals (flagged leads, today's schedule, urgent compliance, open claims) + AI reprioritize. Not a true task graph with blocking-dependency/cash-impact logic. | 🟡 | **KEEP** current dashboard; **DEFER** the smarter dependency/cash-impact ranking until accounting + a task model exist. |

---

## 2. Lead Management

| Plan element | Build reality | Status | Decision |
|---|---|---|---|
| Lead sources: web form / referral / phone | Leads created manually in-app (New Lead). No website contact-form intake wired. | 🟡 | **DEFER** — wire web-form intake later; create manually for now. |
| Tabs: Overview / Notes&Qual / Messages / Documents / Activity / Tasks | Built: Overview, Conversation, Estimate, Selections, Files, Activity. **No Tasks tab; no structured Qualification tab.** | 🟡 | **DEFER** (Tasks tab) — bundle with A2 task model. |
| 5-question qualification | Lead intake table exists (generic Q/A). Not the specific 5-question gate. | 🟡 | **DEFER** — keep generic intake Q/A for now. |
| AI triage GO / HOLD / PASS + reasoning + template | `ai.triage()` returns verdict + reasoning (Qwen), streamed on lead detail. | ✅ | **REVISIT** after A1 model decision (quality pass). |
| Manual go/no-go on red flags | Decision left to owner (no auto-action). | ✅ | **REVISIT** with 2d (keep behavior). |

---

## 3. Pre-Construction — Two Rails

| Plan element | Build reality | Status | Decision |
|---|---|---|---|
| **Rail 1 Floor-Plan Designer** (2D/3D, place products, demo/new walls, print→e-sign, auto-estimate) | `/floor` is a **structural shell only** — toolbar + static SVG + mock selection. No live geometry, drag, snapping, 2D/3D, or estimate generation. | 🟡 | **DEFER** — dedicated epic later (matches floor-planner-vision deferral). |
| Product catalog | `catalog_items` table + real CRUD (add/delete material). | ✅ | **KEEP** (revisit for product images later). |
| **Browser extension** (product clipper) | Not built. | ❌ | **BUILD** — clips products from any site into the catalog. |
| Mood boards / selections boards from catalog | Selections board real (rooms/sections + budgets, approve/decline). Mood table exists. | ✅ | **KEEP** (revisit later). |
| **Rail 2 Plans-based** (upload plans, digital takeoff, cost book) | Floorplan **upload** exists; **no takeoff tool, no cost book, no estimate-from-takeoff.** | 🟡 | **BUILD** — takeoff + SJC cost book → estimate. |
| Merge option (combine two estimates) | Not built. | ❌ | **BUILD** — combine design-build + plans-based estimates. |

---

## 4. Pre-Con Approval Gate → Contract

| Plan element | Build reality | Status | Decision |
|---|---|---|---|
| 3 sign-offs (design / selections / estimate) before contract | Selections approve/decline real. No design e-sign, no estimate sign-off gate. | 🟡 | **DEFER** — build once e-sign (4c) + estimating (3d) land. |
| AI cash-flow-optimized payment schedule | Not built. | ❌ | **DEFER** — gated on accounting (§8) cash data. |
| Auto-generate contract + SOW | Not built in-app (SOW is a separate Claude Code skill, not wired into OS). | ❌ | **BUILD** — generate from approved estimate, ready for e-sign. |
| **Built-in e-signature** (no DocuSign) | Not built. | ❌ | **BUILD** — foundational, in-OS; unlocks gate + contracts + COs. |
| Client portal access begins at pre-con | Portal is project-scoped; available, but not gated to a pre-con phase. | 🟡 | **DEFER** — fold into the approval-gate/phase work (4a). |

---

## 5. Client Portal

| Plan element | Build reality | Status | Decision |
|---|---|---|---|
| View design / floorplan / 3D renders | Limited (no live designer to view). | 🟡 | **DEFER** — auto-follows floor designer (3a). |
| Review & approve selections | ✅ Real (approve/decline, budget roll-up). |  | **KEEP** (revisit/polish later). |
| Sign documents (design/estimate/contract/SOW/CO) | Not built (no e-sign). | ❌ | **BUILD with e-sign (4c)** — portal signing UI. |
| Message SJC | ✅ Real (`portal:<slug>` thread). |  | **KEEP** (revisit later). |
| Upload photos / docs | 🟡 Owner uploads; client-side upload limited. | | **BUILD (small)** — client-side upload. |
| View schedule / milestone status | 🟡 Partial. | | **BUILD (small)** — show clients schedule + milestones. |
| **View and pay invoices** | View sent/paid invoices ✅; **no payment** (no Stripe/payment link). | 🟡 | **DEFER pay** (keep view-only) until payments (§8). |
| Warranty-only view after closeout | Not built as a state transition. | ❌ | *(decided in §9)* |

---

## 6. Subcontractor Portal

| Plan element | Build reality | Status | Decision |
|---|---|---|---|
| Per-project scoped access | ✅ Sub portal scoped to assignment. | | **KEEP** (revisit later). |
| View scope & scheduled dates | 🟡 Partial. | | **BUILD (small)** — show sub their scope + dates. |
| Receive/complete tasks | ❌ No task model. | | **DEFER** — auto-follows A2 task model. |
| Upload daily photos / progress | ✅ Sub log + photo. | | **KEEP** (revisit later). |
| Submit payment requests | ✅ Sub invoice submit. | | **KEEP** (revisit later). |
| Safety orientation docs (AI-gen, logged) | ❌ Not built. | | *(decided in §13)* |
| Upload W-9 / COI / signed agreement | 🟡 COI **status** tracked; no doc upload/storage flow for W-9/agreement. | | **BUILD (small)** — sub doc upload/storage. |
| COI expiry tracking + proactive reminders | 🟡 Status + expiry date tracked; reminders not auto-sent (no scheduler). | | **BUILD (small)** — scheduled COI-expiry email reminders (30/15/5). |

---

## 7. Project Execution

| Plan element | Build reality | Status | Decision |
|---|---|---|---|
| Auto-generated Gantt from template on contract sign | Schedule blocks are **manual**; no template/Gantt auto-gen. | 🟡 | **BUILD** — templated schedule auto-gen. |
| Daily logs (type/voice → AI formats, photos tagged) | ✅ Typed daily logs + photo; **no voice dictation**. | 🟡 | **BUILD** — add local speech-to-text (Whisper) voice logs. |
| Change orders (AI draft + pricing → portal e-sign) | ❌ No CO feature/table/flow. | ❌ | **BUILD** — CO draft + pricing + portal e-sign. |
| Punch list (PM builds, client confirms, track resolution) | ✅ Real punch list (add/done). Client-confirm side partial. | 🟡 | **KEEP** (build out client-confirm with portal work). |
| Milestone invoices auto-gen + send + notify Joe | Invoices created/sent **manually**; not auto on milestone. Notify on send partial. | 🟡 | **BUILD (small)** — auto-gen+send on milestone complete + notify. |
| Job costing (log expenses, AI flags margin) | ❌ No expense tracking / actuals-vs-estimate. | ❌ | **DEFER** — auto-follows accounting/expenses (§8). |

---

## 8. Financial & Accounting (full QuickBooks replacement)

| Plan element | Build reality | Status | Decision |
|---|---|---|---|
| Payment processing (portal / link) | ❌ Not built. | | **DEFER** — add after the ledger core (unlocks 5-pay). |
| AI-optimized draw schedule | ❌ Not built. | | **DEFER** (from 4b). |
| Bank connection + auto-reconcile (Plaid) | ❌ Not built. | | **BUILD** — part of Full-QB epic. |
| Bank rules / auto-categorization | ❌ Not built. | | **BUILD** — part of Full-QB epic. |
| Progress invoicing from estimate | 🟡 Invoices exist (manual line items); not generated from an estimate. | | **BUILD** — generate invoices from the estimate. |
| Deposit/retainer tracking | ❌ Removed (P1-B7, 2026-07-16). | | **REMOVED** — SJC is fixed-price only; nothing bills against a retainer balance. Ledger UI + actions gone; empty `retainers` table kept, unreferenced. |
| A/R aging + dunning (7/14/21) | ❌ Not built. | | **DEFER** — collections automation after ledger core. |
| 1099 tracking + prep/e-file | ❌ Not built. | | **BUILD** — part of Full-QB epic (CPA-review tax logic). |
| MN sales tax tracking/filing | ❌ Not built. | | **BUILD** — part of Full-QB epic (CPA-review). |
| Compliance calendar (quarterlies, sales tax, WC, license) | ✅ Compliance items + windows + AI outlook (see §13). | | *(decided in §13)* |
| Insurance renewal tracking (GL/WC/auto/umbrella, 60/30/14) | 🟡 Tracked as compliance items; no per-policy model or auto-alerts. | | *(decided in §13)* |
| P&L / Balance Sheet / cash reports | ❌ Not built (no `/books`). | | **BUILD** — part of Full-QB epic. |
| AI flags cash issues proactively | ❌ Not built. | | **BUILD** — part of Full-QB epic. |
| Non-payment: Day-15 demand letter / Day-30 lien package | 🟡 Concept shown in notifications; **no real generator** now (demo removed). | | **BUILD both** — demand-letter generator + lien-package assembly. |

> **§8 decision = FULL QuickBooks replacement.** This is the largest, highest-liability epic in the plan; it needs its own dedicated sub-plan and a **CPA review of the 1099 + MN sales-tax filing logic before go-live**. Sequencing chosen: build the ledger/tax core first; **payments + A/R-dunning are explicitly deferred** to a later phase within §8.

---

## 9. Closeout & Warranty

| Plan element | Build reality | Status | Decision |
|---|---|---|---|
| Substantial-completion letter (AI draft) | ❌ Not built. | | **BUILD (small)** — AI draft from punch status. |
| Final invoice auto-gen | 🟡 Manual invoice. | | **BUILD** — folds into milestone invoicing (7-inv). |
| Lien release / final waiver auto-gen | ❌ Not built. | | **BUILD (small)** — auto-gen on final payment (e-sign). |
| Warranty request link auto-sent at completion | ❌ Not built. | | **BUILD (small)** — auto-send at completion. |
| Multi-channel claim intake (portal/email/phone/text) → log | 🟡 Portal + email paths; phone/text not modeled. | | **BUILD** — intake routing → OS log. |
| 5-day / 30-day deadline prompts | 🟡 Deadlines displayed; not auto-prompted. | | **BUILD** — auto deadline prompts (scheduler). |
| Portal → warranty-only after closeout | ❌ Not built. | | **BUILD** — portal warranty-only state. |
| Google review request auto-sent | ❌ Not built. | | **BUILD (small)** — auto-send at completion. |

---

## 10. Marketing & Lead Gen

| Plan element | Build reality | Status | Decision |
|---|---|---|---|
| Auto-draft social posts on completion (approve→post) | 🟡 Mock AI suggestions + `/site` auto-publish **showcase**; no real social APIs/posting. | | **BUILD drafting** (manual post); defer social-API auto-posting. |
| Auto-draft blog (approve→publish to site) | 🟡 Showcase only. | | **BUILD drafting** (manual publish); auto-publish follows §11. |
| Google review request | ❌ Not built. | | *(decided in §9 — BUILD).* |
| Newsletter tool (manual) | 🟡 `/newsletter` is a placeholder/mock screen. | | **DEFER** — keep placeholder. |
| Referral tracking + auto thank-you | ❌ Not built (lead `source` field only). | | **BUILD (small)** — referral link + auto thank-you email. |

---

## 11. Website Integration

| Plan element | Build reality | Status | Decision |
|---|---|---|---|
| OS pushes portfolio/photos/blog to sjcarpentry.com (no CMS) | `/site` is a **mock CMS preview** only; no real publish/push to the live site. | 🟡 | **DEFER** — assess live-site stack first; unblocks blog auto-publish. |

---

## 12. Email Inbox

| Plan element | Build reality | Status | Decision |
|---|---|---|---|
| Native inbox, handle all comms in-platform | ✅ **Gmail API** integration: read, send, compose, AI draft reply (Qwen), HTML bodies, labels, smart-view filters, pagination, star/archive/etc (modify scope pending re-consent). | ✅ | **KEEP** (complete modify re-consent at the pending Gmail step). |
| Threads auto-linked to lead/project | 🟡 Classifier joins by email/domain to leads/subs/money; resolves ~0 on empty data until real contacts exist. | 🟡 | **BUILD enhance** — smarter/manual thread↔record linking. |

---

## 13. Safety, Emergency & Compliance

| Plan element | Build reality | Status | Decision |
|---|---|---|---|
| Safety orientations (OS prompts, gen docs, PM logs) | ❌ Not built. | | **BUILD** — AI-gen orientation docs + PM-administered logging. |
| Incident reports (AI draft OSHA-compliant) | ❌ Not built. | | **BUILD** — AI OSHA-report generator from notes. |
| Emergency response always human / Claude documents after | N/A (no incident feature). | ❌ | **KEEP principle** — human responds; AI documents after (via incident report). |
| Compliance calendar (license, insurance, tax + reminders) | ✅ `/compliance` items, due-windows, AI outlook, resolve. Reminders not auto-sent. | 🟡 | **KEEP** + add auto-reminders (scheduler); **insurance per-policy tracking → BUILD (small)**. |

---

## AI Skills

**In-production skills (sow, specs, bank-approval, scope-of-work, classical-architecture, docx, xlsx, pdf, pptx):** Claude Code skills on Joe's machine, not wired into the OS. **Decision: BUILD (wire into OS)** — expose as in-app document generators via a Claude path (like `/automate`), kept provider-agnostic (A6). Pairs with contract/SOW gen (4d). 🔀→BUILD

**Backlog skills:**

| # | Skill | Build reality | Decision |
|---|---|---|---|
| 1 | `lead-triage` | `ai.triage()` in-app ✅ | KEEP (built) |
| 2 | `permit-packet` | Not built ❌ | **DEFER** |
| 3 | `weekly-status` | `getProjectWeeklyStatus()` + send ✅ | KEEP (built) |
| 4 | `warranty-log` | Claims + AI summary 🟡 | BUILD → via §9 warranty |
| 5 | `co-draft` | Not built ❌ | BUILD → via 7-co |
| 6 | `demand-letter` | Not built ❌ | BUILD → via 8-nonpay |
| 7 | `incident-report` | Not built ❌ | BUILD → via §13 |
| 8 | `estimate-research` | `ai.estimate()` deterministic 🟡 | BUILD → via 3d estimating |
| 9 | `cash-flow-optimizer` | Not built ❌ | DEFER → via 4b/§8 |
| 10 | `social-post` | Mock only 🟡 | BUILD → via 10-social |

---

## Summary scoreboard

- ✅ **Solid & real:** Email/Gmail inbox, leads + AI triage, projects + punch/selections/subs/daily-logs, subs directory + portal logging/invoicing, compliance calendar, catalog CRUD, today dashboard, auth + portals, in-app Qwen AI, mobile app, `/automate` (Claude CLI).
- 🟡 **Partial / showcase:** Floor designer, plans/takeoff, client portal depth, schedule auto-gen, milestone-invoice automation, marketing/site/newsletter, thread↔record linking, warranty workflow.
- ❌ **Not built (biggest gaps vs. plan):** Payments + full accounting (QB replacement), bank/Plaid, e-signature, contract/SOW generation, change orders, job costing, two-rail pre-con + takeoff + auto-estimate, browser extension, SMS, social posting, website push, safety/incident, autonomous AI task loop + MCP server + learning layer.

---

*Decisions to be filled in the Decision columns as Joe + Claude review each row.*
