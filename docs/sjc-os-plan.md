# SJ Carpentry LLC — SJC OS Master Plan
*Reference document for Claude. Last updated: 2026-04-22. Reflects full SJC OS vision — single platform replacing CRM, Houzz Pro, and QuickBooks.*

> **📌 This is the original vision document (2026-04-22), not a status report.**
> It describes what SJC OS is *for* — still the guiding intent, and worth reading
> for that. It does **not** describe what is built: the app has been live since
> 2026-06-26 and has both exceeded this plan (agents, MCP, owner grants, bidding,
> newsletter, mobile app) and not yet reached parts of it (accounting/QuickBooks
> replacement, payments). For the gap-by-gap comparison see
> `docs/plan-vs-build.md`; for current status see `README.md`.

---

## What Is SJC OS

SJC OS is a custom-built, self-hostable web application that serves as the single operating system for SJ Carpentry LLC. It is accessible from any device (desktop and mobile) and replaces Houzz Pro, the Light CRM concept, and QuickBooks entirely. There is no third-party project management platform in this stack.

Claude is the AI layer — context-aware on every page, autonomous on tasks it can complete, and proactive in reaching out to Joe or any PM when something needs human attention.

**Core principle:** AI completes every step it is capable of, presents the result for approval, makes any requested changes, marks complete, and moves to the next step automatically. When a step requires a human, the OS prompts the right person with exactly what needs to happen and waits.

---

## Platform Stack

| Layer | Tool | Replaces |
|---|---|---|
| Operations platform | SJC OS (custom) | Houzz Pro + CRM |
| Accounting & payments | SJC OS (built-in) | QuickBooks |
| Website backend | SJC OS (push to sjcarpentry.com) | Separate CMS |
| Email | SJC OS (native inbox, in scope) | External email client |
| AI | Claude (context-aware, page-level) | HP AutoMate + manual work |
| Browser extension | SJC OS product clipper | Manual catalog entry |
| E-signature | SJC OS (built-in) | DocuSign |
| Social / blog | SJC OS (auto-draft + push on project complete) | Manual |

**No Zapier. No HP. No QB. No DocuSign. No separate CRM.**

HP marketplace leads are dropped effective 2026-04-22. Lead sources are now: website contact form, referrals, and direct/phone.

---

## AI Behavior — Core Rules

1. **Context awareness:** When any page, lead, or project is opened, Claude reads the current record and proactively surfaces relevant information, flags, or suggested next actions without being asked.

2. **Autonomous task loop:** Claude identifies the next step → completes it if capable → presents output and asks for approval → user approves or requests changes → Claude marks complete and proceeds to next step automatically.

3. **MAN step handling:** When the next step requires a human, Claude stops, describes exactly what needs to happen and why, and waits. It does not proceed until the human action is confirmed.

4. **Proactive outreach:** The OS can message Joe or any PM via SMS, email, or in-app notification for questions it needs answered or high-priority to-dos that require immediate attention.

5. **Learning layer:** Claude learns from project documents, past estimates, completed job data, and cost actuals collected in the OS database. Specifics of what is collected and how will be defined during development. This improves estimate accuracy, pattern recognition, and decision support over time.

---

## Feature Map

### 1. Global To-Do Page

AI-maintained single view across all leads, projects, and tasks in the business. Prioritized by Claude based on urgency, deadlines, blocking dependencies, and cash impact. This is the first thing to check when opening the OS — everything that needs attention today, across the whole business, in one place.

---

### 2. Lead Management

**Lead sources:** Website contact form, referrals, phone/direct. All enter the OS directly — no Zapier bridge needed.

**Lead record tabs:**
- **Overview** — contact info, project type, budget bucket, pipeline stage, triage status, red flags, AI summary of where things stand and what happens next
- **Notes & Qualification** — discovery call notes, 5-question qualification answers, AI triage result (GO / HOLD / PASS) with reasoning
- **Messages** — full email/SMS thread history, AI draft reply, internal notes
- **Documents** — rough estimate, Phase 1 SOW, site photos, NDA, supporting files
- **Activity** — append-only log of every action (stage changes, messages, documents, AI actions)
- **Tasks** — open and completed tasks, AI-suggested next actions

**5-Question Qualification Process:**
1. Is your budget confirmed?
2. Who are the decision makers?
3. Is your timeline flexible?
4. Is financing in place?
5. Why SJC?

Follow-up context fields: prior contractor, which related trades have already been pulled.

**AI triage:** Claude scores the lead for red flags (budget below floor, unrealistic timeline, financing unclear, scope mismatch, price shopping, designer-driven, communication issues, etc.), returns GO / HOLD / PASS with reasoning, and suggests the appropriate response template.

**What stays manual:** The go/no-go decision on a red-flag lead. Claude flags it; Joe decides.

---

### 3. Pre-Construction — Two Project Rails

Every project follows one of two rails into the estimate. A merge option is available when a project has elements of both.

#### Rail 1 — Design-Build (Interior Remodels)

**Floor Plan Designer:**
- 2D and 3D views
- Products placed directly from the SJC internal catalog or captured via browser extension
- Walls designated as demo or new construction
- Mood boards and selections boards pull from the same product catalog
- Design can be printed and sent to client for e-signature directly from the designer
- Floor plan auto-generates the estimate using exact specified products, quantities derived from room dimensions, and wall designations

**Product Catalog + Browser Extension:**
- SJC maintains an internal catalog of products, materials, and finishes
- Browser extension captures products from any website and uploads them to the OS catalog
- Captured products are immediately available for mood boards, selections boards, and the floor plan designer

#### Rail 2 — Plans-Based (Additions, New Homes, Engineer/Architect/Designer Plans)

- External plans uploaded to the OS (PDF, DWG, etc.)
- Digital takeoff tool for quantities (area, linear, count, volume)
- Estimate built from takeoff quantities + SJC cost book

#### Merge Option
When a project has both a design-build component and a plans-based component (e.g., addition + interior remodel), both estimates are generated independently and a merge function combines them into a single estimate.

---

### 4. Pre-Con Approval Gate → Contract

Once design and estimating are complete, three sign-offs are required before the contract is generated:

1. **Design approval** — client e-signs the design prints sent from the floor plan designer
2. **Selections approval** — client confirms all material and finish selections
3. **Estimate approval** — client signs off on the final estimate

Once all three are approved, the OS:
1. Determines the payment schedule using AI cash flow optimization (see Financial section)
2. Auto-generates the contract and SOW
3. Sends both to the client for e-signature through their portal

**E-signature is built into the OS.** No DocuSign.

**Client portal access begins at pre-construction** — not after contract signing. Clients can view design progress, make selections, message, and upload documents during pre-con.

---

### 5. Client Portal

**Access:** From pre-construction through warranty period.

**During active project:**
- View design, floor plan, and 3D renders
- Review and approve selections
- Sign documents (design prints, estimate, contract, SOW, change orders)
- Message SJC
- Upload photos and documents
- View project schedule and milestone status
- View and pay invoices

**After closeout:**
- Limited to warranty view only
- Can submit warranty claims
- Warranty request link sent to all clients at project completion

---

### 6. Subcontractor Portal

**Access:** Per-project, scoped to their trade.

- View assigned scope and scheduled dates
- Receive and complete tasks
- Upload daily photos and progress documentation
- Submit payment requests
- Complete safety orientation documents (AI-generated, PM-administered, logged in OS)
- Upload W-9, COI, and signed subcontractor agreement
- COI expiration tracked by OS with proactive renewal reminders

---

### 7. Project Execution

**Schedule:** Auto-generated Gantt from template based on project type when contract is signed. PM adjusts as needed.

**Daily logs:** PM types or voice-dictates notes. Claude formats and logs them. Photos tagged and organized by date and milestone.

**Change orders:** AI drafts CO narrative and itemized pricing. Sent to client through portal for e-signature. Approval process and thresholds to be defined.

**Punch list:** PM builds in OS at substantial completion. Client can view and confirm items through their portal. Both sides track resolution.

**Milestone invoices:** Auto-generated and sent to client through portal when milestone is marked complete. OS notifies Joe when invoice goes out.

**Job costing:** Expenses logged against project in real time. AI compares actuals to estimate and flags margin issues proactively.

---

### 8. Financial & Accounting

**Full QuickBooks replacement in the ideal state.**

**Payment processing:** Built into the OS. Clients pay through their portal or via payment link.

**AI-optimized payment schedules:** When a contract is ready, Claude analyzes current cash on hand, safe operating reserve across all active projects, cost curve of the specific work (when materials need purchasing, when subs need paying), and project length — then proposes a draw schedule that optimizes cash flow for the business while remaining fair to the client. Not a fixed 30/30/30/10 template.

**Accounting features:**
- Direct bank connection — OS pulls transactions and auto-reconciles
- Bank rules for recurring transaction categorization (target 80%+ auto-categorized)
- Progress invoicing from estimate
- Deposit tracking (as liability, applied to first milestone invoice)
- A/R aging with automated dunning sequence (7/14/21 days)
- 1099 vendor tracking (flagged at vendor onboarding, auto-accumulates)
- 1099 prep and e-file (January)
- MN Sales Tax tracking and filing
- Compliance calendar: federal quarterly estimates, MN sales tax, WC audit, license renewal
- Insurance renewal tracking (GL, WC, auto, umbrella) with 60/30/14 day alerts
- Monthly P&L, Balance Sheet, cash position reports
- AI proactively flags cash position issues rather than waiting for report pull

**Non-payment flow:**
- Day 15: AI generates demand letter from Non-Payment SOP template — Joe approves and sends
- Day 30+: AI assembles lien package — attorney executes filing (MAN, always)

---

### 9. Closeout & Warranty

**Substantial completion:** AI drafts substantial completion letter from template + punch list status. PM reviews and sends.

**Final invoice:** Auto-generated from estimate final draw.

**Lien release / final waiver:** Auto-generated when final payment is received.

**Warranty request link:** Sent to all clients at project completion. Claims can come in via portal, email, phone, or text — all routes log into the OS. OS sets 5-day and 30-day response deadlines and prompts PM accordingly.

**Client portal:** Converts to warranty-only limited view after closeout.

**Google review request:** Auto-sent at project completion. Google only.

---

### 10. Marketing & Lead Generation

**On project completion, OS auto-drafts:**
- Social media posts across all platforms — Joe approves before posting
- Blog piece — Joe approves before publishing to website
- Google review request — auto-sent to client

**Newsletter:** Built into OS as a tool. Manual — not automated.

**Referral tracking:** When a lead indicates they were referred by a past client, OS tags the referral source and automatically triggers a thank-you outreach to the referring client.

---

### 11. Website Integration

SJC OS operates as the backend for sjcarpentry.com. The OS can push updates directly to the website:
- Completed project photos and portfolio entries
- Blog posts
- Any other content updates

No separate CMS. Website content is managed from within the OS.

---

### 12. Email Inbox

Native email inbox built into the OS. All client and sub communication can be handled from within the platform. Threads are linked to the relevant lead or project record automatically.

---

### 13. Safety, Emergency & Compliance

**Safety orientations:** PM-administered on site. OS prompts PM when orientation needs to happen and generates all required documents (orientation checklist, site safety policy sign-off). PM logs completion in OS.

**Incident reports:** AI drafts OSHA-compliant incident report from PM's verbal or typed notes. PM reviews and submits.

**Emergency response:** Always human. Claude drafts post-incident documentation only.

**Compliance calendar:** Contractor license renewal (MN DLI), insurance renewals, tax deadlines — all tracked in OS with proactive reminders.

---

## What Should Never Be Automated

- **Go/no-go on a red-flag lead.** Claude flags it; Joe decides.
- **Final pricing and markup decisions.** OS produces the numbers; Owner owns the risk.
- **Difficult client conversations.** Past-due, disputed CO, warranty dispute, scope creep — relationship moments, not template moments.
- **Live emergency response.** Humans respond to the incident; Claude documents it after.
- **Final contract signing.** Client signs with a human available.
- **Lien filing.** MN Chapter 514 is attorney work. OS assembles the package; attorney files.
- **Hiring, firing, performance conversations.** Always human-to-human.

---

## Build Considerations

**Architecture:**
- Self-hostable web application (remote access from desktop and mobile)
- Single database — all leads, projects, financials, documents, communications in one place
- REST API with MCP server so Claude has direct, structured access to all data
- Claude's context window is fed current page data automatically on every page load
- Browser extension for product capture from any website

**Tech stack direction (TBD with developer):**
- Python or TypeScript backend with auto-generated OpenAPI
- PostgreSQL for relational data with JSONB for flexible fields
- React/Next.js frontend (mobile-responsive)
- Anthropic MCP SDK for AI integration
- Self-hosted on own server (future state); managed hosting during development

**Key integrations to build:**
- Bank connection (Plaid or similar) for transaction pull and reconciliation
- SMS (Twilio or similar) for client/sub/PM outreach
- Email (Postmark or similar) for transactional and inbox sync
- Social media APIs for auto-posting (Instagram, Facebook, Google Business Profile)
- Website CMS API or direct DB connection for content push

---

## Skills Already in Production (Available in SJC OS AI Layer)

| Skill | What it does |
|---|---|
| `sow` | Generates polished Scope of Work .docx on SJC letterhead |
| `specs` | Generates Material Specifications .xlsx tracker |
| `bank-approval` | Generates Material Cost Breakdown PDF for lender review |
| `scope-of-work` | Transforms rough notes into estimator-ready scope prompt |
| `classical-architecture` | Classical proportion advisor (Asher Benjamin, Palladio Londinensis) |
| `docx` | Creates/edits Word documents |
| `xlsx` | Creates/edits Excel spreadsheets |
| `pdf` | Creates/merges/extracts PDF documents |
| `pptx` | Creates/edits PowerPoint presentations |

## Skills to Build (Backlog, Priority Order)

| # | Skill | What it does |
|---|---|---|
| 1 | `lead-triage` | Accepts lead notes, returns GO / HOLD / PASS + reasoning + response template |
| 2 | `permit-packet` | Produces complete permit application packet formatted for specific AHJ |
| 3 | `weekly-status` | Rolls up daily logs, schedule, open COs into client-ready status email |
| 4 | `warranty-log` | Adds claim to warranty log, sets deadlines, generates acknowledgment email |
| 5 | `co-draft` | Drafts Change Order narrative + pricing + client-approval language |
| 6 | `demand-letter` | Fills Non-Payment demand letter with project-specific details and escalation dates |
| 7 | `incident-report` | Drafts OSHA-compliant incident report from verbal notes |
| 8 | `estimate-research` | Combines web pricing research + internal historical data to generate rough estimates |
| 9 | `cash-flow-optimizer` | Analyzes business financials and project cost curve to propose optimal payment schedule |
| 10 | `social-post` | Auto-drafts social posts + blog piece from completed project photos and data |

---

## Key SJC Constants

- **Lead response SLA:** 24 hours
- **Non-payment demand letter trigger:** Day 15 past due
- **Lien filing trigger:** Day 30+ past due (attorney executes)
- **COI reminder cadence:** 30 / 15 / 5 days before expiry
- **Tax/compliance reminder cadence:** 60 / 30 / 14 days out
- **A/R dunning cadence:** 7 / 14 / 21 days past due
- **Service area:** Minnesota
- **Payment schedule:** AI-optimized per project (not fixed 30/30/30/10)
- **Review platform:** Google only

---

*End of document — update whenever the SJC OS plan evolves. Last full review: 2026-04-22.*
