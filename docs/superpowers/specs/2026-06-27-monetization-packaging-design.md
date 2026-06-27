# TaskFlow Monetization — Packaging & Freemium Tiers (Design)

**Date:** 2026-06-27
**Status:** Approved (brainstorm), strategy spec — gates downstream build sub-projects
**Type:** Business/packaging design (no code in this spec; it defines the tier model that the entitlement, billing, and AI-metering sub-projects implement).

## Context

TaskFlow V4 is a feature-rich GTD app (tasks, notes with wikilinks/math, mindmaps, habits, drawing/tldraw, weekly review AI, web clipper, Telegram bot, browser extension) currently self-hosted single-instance on the owner's VPS, with latent multi-user infrastructure (`users`, `shared_lists`, `list_members`, JWT auth). The goal is to monetize it as a **public multi-tenant SaaS** with a **freemium, quota-based** model and three tiers: **Free → Pro (individual) → Team**.

This is the first of several monetization sub-projects. It is intentionally scoped to **packaging only** (what the tiers are, what they cost, and the rules that govern the limits), because that decision gates the design of every sub-project after it.

## Decisions (locked during brainstorm)

| Question | Decision |
|---|---|
| Monetization model | Freemium + premium, **quota-based** gating |
| Delivery | **You host** — public multi-tenant SaaS (strangers sign up on your domain) |
| Target | **Both** — Free→Pro for individuals, Team as top tier |
| Pro vs Team per-seat price | **Team intentionally cheaper per-seat** (volume discount; `min. 5 seats` separates it from solo Pro) — cannibalization risk accepted |
| Pro AI limit | **Feels unlimited, soft rate-limit** (≈1 run/day) to protect margin; hard metering deferred to the AI-metering sub-project |
| Free "active task" counting | **Loose** — only `gtd_status` not in (`done`, `archived`) counts toward the limit |
| Auto-backup for Pro | **Yes** (Pro gets auto-backup, not manual) |
| Pro free trial | **No** — Free tier is the funnel |
| Billing period | **Annual only** |
| Currency | **IDR** primary (USD international deferred) |

## Tier Matrix

**Pricing (annual only):**
- **Free** — Rp 0
- **Pro (individual)** — **Rp 200.000 / year** (≈ Rp 16.000 / month)
- **Team (per seat)** — **Rp 150.000 / seat / year**, **minimum 5 seats** (intentional volume discount vs Pro)

| Feature / Quota | Free | Pro | Team |
|---|---|---|---|
| Notes | Unlimited | Unlimited | Unlimited |
| **Active tasks** | **15** | Unlimited | Unlimited |
| Mindmaps | 2 | Unlimited | Unlimited |
| Habits | 5 | Unlimited | Unlimited |
| Attachment storage | 50 MB | 1 GB (add-on available) | 2 GB / seat (add-on available) |
| Web Clipper / Extract Article | 10 / month | Unlimited | Unlimited |
| Drawing (tldraw) | ✅ | ✅ | ✅ |
| Browser Extension | ✅ | ✅ | ✅ |
| Desktop app / Offline mode | ✅ | ✅ | ✅ |
| Export PDF | ✅ | ✅ | ✅ |
| Telegram Bot | ❌ | ✅ | ✅ |
| Export JSON | ❌ | ✅ | ✅ |
| Backup | Manual | **Auto** | Auto |
| **AI** — Weekly Review, AI Summary *(future)* | ❌ | ✅ (soft-limited) | ✅ |
| Collaboration | ❌ | ❌ | ✅ |
| Shared Workspace | ❌ | ❌ | ✅ |
| Task Assignment | ❌ | ❌ | ✅ |
| Permission / Role | ❌ | ❌ | ✅ |
| Admin Panel | ❌ | ❌ | ✅ |
| Activity Timeline *(future)* | ❌ | ❌ | ✅ |
| Team Dashboard *(future)* | ❌ | ❌ | ✅ |
| AI Progress Report *(future)* | ❌ | ❌ | ✅ |
| AI Risk Detection *(future)* | ❌ | ❌ | ✅ |

*(future)* = on the roadmap, not yet built. Must be marketed explicitly as "coming soon" — never sold as a currently-available feature.

## Packaging Rules

These are the invariants the entitlement sub-project must enforce:

1. **Active-task quota is loose.** Only tasks whose `gtd_status` is not `done` and not `archived` count toward a tier's active-task limit. Completing or archiving a task frees a slot. (Notes are unlimited on every tier, so they never count.)
2. **Quota limits block creation, not access.** When a Free user is at 15 active tasks, they can still view/edit/complete/archive existing tasks; they are blocked only from creating a 16th active task, with an upgrade prompt. Never delete or hide data a user already created when they hit a limit or downgrade.
3. **Downgrade is non-destructive.** If a paid user lapses to Free while over a Free quota (e.g., 400 active tasks), existing data is preserved and remains readable; only new creation is blocked until they are back under the limit or re-upgrade. (This rule binds the billing sub-project's lapse handling.)
4. **Pro AI is soft-limited.** Pro presents AI as unlimited but applies a gentle rate limit (≈ 1 run/day) so per-user OpenRouter cost stays bounded. The exact mechanism, counter storage, and over-limit UX are defined in the AI-metering sub-project; this spec only fixes the *intent* (feels unlimited, protected margin).
5. **Collaboration is Team-only.** Shared workspace, shared lists/notes/mindmaps, task assignment, roles, and admin are exclusively Team. Pro is strictly single-user. (This contradicts the current app, where shared lists exist for any user — the entitlement sub-project must gate the existing sharing endpoints behind Team.)
6. **Storage add-on is a separate purchasable item.** Beyond the included quota, users can buy additional attachment storage. Pricing and granularity are deferred to the billing sub-project.
7. **Annual-only billing.** No monthly plans. Renewal is yearly.

## Anchor & Positioning (rationale, not requirements)

- **Free is genuinely useful** for solo note-taking (notes unlimited) but caps the *task* working set at 15 — notes act as the hook and lock-in (accumulated content), tasks act as the wall. This drives upgrades while keeping the product shareable.
- **AI is the primary Free→Pro lever** because it carries real marginal cost (OpenRouter) and high perceived value.
- **Collaboration is the Pro→Team lever**, leveraging the shared-notes/mindmap infrastructure already built.
- Price point (≈ Rp 16k/month Pro) is deliberately accessible for the Indonesian market; international USD pricing is a later decision.

## Downstream Sub-Projects This Gates

This packaging spec is a prerequisite for (each gets its own spec → plan → implementation):

1. **Multi-tenancy hardening + self-service signup** — audit per-user data isolation across ALL features (tasks, notes, mindmaps, habits, chat, attachments, web clipper) before strangers sign up; add public registration, email verification, password reset.
2. **Entitlement / plan enforcement** — plan model, per-tier feature flags and quota counters, creation-blocking + upgrade prompts, the loose active-task counting rule, gating existing sharing endpoints behind Team.
3. **Billing & subscriptions** — payment provider (Indonesian context: Midtrans / Xendit / Stripe), annual subscription lifecycle, Team seat management & `min 5` enforcement, storage add-on, webhooks, invoices, lapse/downgrade handling.
4. **AI cost metering** — per-user usage counter, the Pro soft rate-limit (≈1/day), over-limit UX; ensures unit economics stay positive at the Rp 200k price point.
5. **Ops / legal / launch** — ToS, privacy policy, capacity/scaling on the VPS, per-tenant backup, abuse prevention, support.

## Open Items (resolve in downstream specs, not here)

- Exact storage add-on pricing & increments.
- Payment provider selection (Midtrans vs Xendit vs Stripe) — affects IDR support, fees, payout.
- International / USD pricing.
- Precise AI soft-limit numbers and reset window.

## Out of Scope

- Any code. This spec defines the model only.
- The `(future)` features themselves — they are roadmap markers, not deliverables of the monetization track.
