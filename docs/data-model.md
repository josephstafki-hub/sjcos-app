# SJC OS — Data Model

Inferred from wireframes + SJC OS Master Plan. Align with existing `/admin` schema where it overlaps.

---

## Lead

```ts
{
  id: string
  slug: string
  name: string
  email: string
  phone: string
  address: string
  scope: string
  budget: string
  timeline: string
  source: string                   // referral | web | google | etc.
  stage: 0 | 1 | 2 | 3 | 4 | 5   // 0=Intake → 5=Signed+retainer
  photos: string[]
  roughEstimate: {
    labor: number
    materials: number
    total: number
    notes: string
  }
  aiTriage: {
    verdict: 'GO' | 'HOLD' | 'PASS'
    reasoning: string
    score: number
  }
  slaState: {
    firstReplyAt: Date | null
    lastContactAt: Date | null
    awaitingMs: number             // ms since last outbound contact
  }
  createdAt: Date
  updatedAt: Date
}
```

---

## Project

```ts
{
  id: string
  slug: string
  name: string
  address: string
  contractValue: number
  stage: 'pre-construction' | 'active' | 'closeout' | 'complete' | 'warranty'
  milestones: {
    name: string
    amount: number
    status: 'pending' | 'billed' | 'paid'
    dueDate: Date
  }[]
  schedule: {
    date: Date
    label: string
    crew: string[]
  }[]
  dailyLogs: {
    date: Date
    notes: string
    photos: string[]
    postedBy: string
  }[]
  subs: string[]                   // Sub IDs
  selections: {
    category: string
    item: string
    sku: string
    status: 'pending' | 'approved' | 'ordered' | 'delivered'
  }[]
  files: string[]                  // file paths / GDrive refs
  money: {
    billed: number
    paid: number
    openChangeOrders: number
  }
  communicationsRef: string[]      // Thread IDs
  createdAt: Date
  updatedAt: Date
}
```

---

## Sub (Subcontractor)

```ts
{
  id: string
  slug: string
  name: string
  trade: string                    // tile | framing | plumbing | electrical | etc.
  rate: string                     // e.g. "$85/hr"
  jobs: string[]                   // Project IDs
  coiExpires: Date
  w9OnFile: boolean
  agreementVersion: string
  additionalInsured: boolean
  starRating: number               // 0–5
  reliability: {
    onTime: number                 // 0–100 %
    qcPass: number
    bidAccuracy: number
    responseHrs: number            // avg hours to respond
  }
  notes: string
  createdAt: Date
  updatedAt: Date
}
```

---

## Thread (Conversation)

```ts
{
  id: string
  channel: 'email' | 'sms' | 'client-portal' | 'sub-portal' | 'site-form' | 'chat'
  participants: {
    name: string
    email?: string
    phone?: string
    kind: 'internal' | 'client' | 'sub' | 'ai'
  }[]
  messages: {
    id: string
    from: string
    body: string
    sentAt: Date
    attachments: string[]
  }[]
  projectRef?: string              // Project ID
  leadRef?: string                 // Lead ID
  aiState: {
    draftReply?: string
    urgency: 'high' | 'medium' | 'low'
    sentiment: 'positive' | 'neutral' | 'negative'
    verdict?: string               // AI one-liner on the thread
  }
  status: 'needs-reply' | 'awaiting-them' | 'snoozed' | 'done'
  createdAt: Date
  updatedAt: Date
}
```

---

## Notification

```ts
{
  id: string
  kind: 'decision' | 'mention' | 'job' | 'money' | 'compliance' | 'intake'
  title: string
  sub: string                      // sub-line text
  refType: 'lead' | 'project' | 'sub' | 'thread' | 'compliance' | null
  refId: string | null
  when: Date
  read: boolean
}
```

---

## ComplianceItem

```ts
{
  id: string
  kind: 'coi' | 'license' | 'tax' | 'insurance'
  entity: string                   // "Marco Tile LLC" or "SJ Carpentry LLC"
  dueDate: Date
  urgency: 'urgent' | 'soon' | 'upcoming'
  autoAction?: string              // e.g. "Request renewal email"
  status: 'current' | 'expiring' | 'expired'
}
```

---

## Material (Catalog entry)

```ts
{
  id: string
  sku: string
  name: string
  supplier: string
  category: string                 // tile | lumber | plumbing | electrical | etc.
  price: number
  unit: string                     // sqft | each | lf | etc.
  usageCount: number
  photos: string[]
  notes: string
}
```

---

## WarrantyClaim

```ts
{
  id: string
  projectRef: string               // Project ID
  issue: string
  openedAt: Date
  ackDeadline: Date
  status: 'open' | 'acknowledged' | 'in-progress' | 'resolved'
  aiReplyDraft?: string
}
```

---

## PostgreSQL notes

- Use `JSONB` columns for array/object fields (photos, milestones, reliability stats) where a separate join table isn't needed
- `slug` columns are URL-safe strings generated from name (e.g. "henderson-kitchen")
- All tables get `created_at TIMESTAMPTZ DEFAULT now()` and `updated_at TIMESTAMPTZ DEFAULT now()` with an update trigger
- Initial data import: `leads.csv` from `~/sj-carpentry-os/06_operations/crm/data/` (Phase 7.1)
