# KORP2 Delivery Tracker — Build Brief

*For Claude Code. Hand this file plus `korp2-tracker-seed.json` and say "build this."*

**What this is:** a small Azure-hosted web app with two faces — an interactive
UI Patrick uses, and an MCP endpoint Claude reads and writes through. One
codebase, one data store, one deployment.

**Why it exists:** delivery state currently lives in a spreadsheet that has to
be manually re-shared to be discussed. This makes it live in both directions.

---

## 1 · Architecture

```
Azure Container App (single container, public HTTPS FQDN)
├── GET  /                → React SPA  (Entra ID auth, mobile-first)
├── POST /mcp             → MCP Streamable HTTP endpoint (bearer token)
└── Azure Table Storage   → tracker state
```

**Runtime:** Node 20 + TypeScript. Express (or Fastify) serving both routes.
MCP via `@modelcontextprotocol/sdk` — Streamable HTTP transport, **not SSE**
(SSE is deprecated in the current spec).

**Data store:** Azure Table Storage. Four tables — `BuildLines`, `Questions`,
`Variances`, `DayLog`. At this volume (46 + 35 rows) it is the cheapest thing
that works and needs no schema migration when the shape changes. Cosmos
serverless is fine if Table Storage is blocked; do not reach for Azure SQL.

**Hosting:** Azure Container Apps, consumption plan, min replicas 0. Gives a
public HTTPS FQDN out of the box, which is a hard requirement — see §4.

---

## 2 · Data model

Take it directly from `korp2-tracker-seed.json`. Load that file on first boot
if the tables are empty; treat it as the seed, never re-run it over live data.

Rules that must be enforced in code, not left to discipline:

- `status` is a closed vocabulary: `NOT_STARTED` `BLOCKED` `IN_PROGRESS`
  `BUILT` `TESTED` `DONE` `DESCOPED` `NOT_MINE`. Reject anything else.
- **`ref` is not unique.** `110358` and `110391` each cover two distinct
  requirements. `id` (L01–L46) is the key. Any UI or tool output showing a
  ref must also show `shortName`.
- `DONE` requires built **and** unit tested. `BUILT` is untested.
- `NOT_MINE` means Integration or BI owns the build. It is not a completion
  state and must not count toward progress.
- Nothing is deleted. Removing scope sets `status: DESCOPED`, requires a
  `note`, and writes a `descopeAudit` row.
- `soloDays`, `aiFactor` and `aiDays` are **read-only in this app.** They
  mirror the estimates workbook. If they need to change, the workbook changes
  and the tracker is re-seeded. Divergence is a variance, not a re-cut.
- Setting `status: BLOCKED` with an empty `blockers` array, or a non-blocked
  status while a linked question is `OPEN` and `hardBlocker: true`, should
  raise a warning in the UI and in `get_position`. Surface it — do not
  auto-resolve.

Every write appends to an audit trail (`{ts, actor, entity, field, from, to}`).
That is what replaces git history.

---

## 3 · MCP tool surface

Keep it to these eight. Custom connectors have a ~30k token response ceiling,
so every list tool paginates and defaults to a narrow projection.

| Tool | Hint | Behaviour |
|---|---|---|
| `get_position` | read-only | Rollup: counts by status, actual vs baseline days, open hard-blocker count, any consistency warnings. No line detail. |
| `list_lines` | read-only | Filters: `status`, `buildType`, `owner`, `priority`, `hasBlockers`. Returns `id, ref, shortName, buildType, status, aiDays, actualDays, blockers`. Page size 20. |
| `get_line` | read-only | Full record for one `id`, including audit trail. |
| `update_line` | — | Sets `status`, `actualDays`, `note` for one `id`. Rejects invalid status. Rejects edits to estimate fields. |
| `list_questions` | read-only | Filters: `status`, `hardBlocker`, `owner`, `ref`. Returns ref, truncated question, owner, neededBy, status. |
| `update_question` | — | Sets `status`, `lastChased`, appends a note. |
| `log_variance` | — | `{lineId, estAiDays, actualDays, cause, declaredTo}`. `cause` from the closed list; `TOOLING` is the one that tells us whether the AI factors hold. |
| `log_day` | — | Appends a dated entry: what moved, decisions banked, blockers moved, tomorrow. |

Write clear `title` and annotations on each tool (`readOnlyHint` on the four
reads). Descriptions should say what the tool is *for*, not just what it does —
that is what makes tool selection reliable.

---

## 4 · Auth and network — read before deploying

**The MCP endpoint must be reachable from the public internet.** Claude
connects from Anthropic's cloud infrastructure, not from Patrick's machine —
this is true even in Claude Desktop and Cowork. A server behind the TGP VPN or
corporate firewall will not connect. If TGP requires IP restriction, allowlist
Anthropic's published IP ranges on the Container App ingress.

**MCP auth:** start with a bearer token in a request header. Claude stores
header values securely, does not display them again, and sends them on every
request. That is proportionate for a single-user internal tool and avoids
building an OAuth server. Entra ID OAuth is the upgrade path if TGP security
asks for per-user identity — the MCP spec's auth flow is supported, including
Dynamic Client Registration.

**SPA auth:** Entra ID, single tenant, Patrick only.

**Adding the connector:** Settings → Connectors → Add custom connector → the
`/mcp` URL, with the bearer token under request headers. **If TGP is on a Team
or Enterprise plan, an Owner has to add it at organisation level first** —
individual members cannot. Check that before building, not after.

**Content:** this holds delivery metadata — refs, estimates, statuses,
blockers, owner names. It must not hold resident data, H&D values, or anything
Article 9. Enforce that in the brief and in review.

---

## 5 · UI requirements

Mobile-first — the point of this is that status gets updated at the end of a
build block, on whatever device is to hand, in under thirty seconds.

- **Board view.** Lines grouped by status, drag to move. Tap a card for detail.
- **One-tap status.** Not a dropdown inside a modal inside a form.
- **Blocker badges** on any line with an open hard blocker, visible at card level.
- **Today panel.** Current build block: target lines, time box, do-list, and an
  explicit *do-not-do* list. End-of-block log entry prompts on close.
- **Position strip** always visible: lines DONE / 46, actual vs baseline days,
  open hard blockers.
- **Variance prompt.** When a line moves to `DONE` and `actualDays` differs
  from `aiDays`, prompt for a cause before saving. This is the single most
  valuable behaviour in the app — it is how the AI co-working factors get
  validated against reality instead of asserted.

---

## 6 · Build order

1. Table Storage + seed loader + audit trail. Verify the 46 lines and 35
   questions land intact and both duplicate refs survive as separate rows.
2. MCP endpoint with the four read tools. Deploy. Add as a custom connector.
   Confirm Claude can call `get_position` before writing any UI.
3. The four write tools, with validation.
4. React SPA.
5. Variance prompt and Today panel.

Steps 1–3 are the ones that matter. If time runs out after step 3, the tracker
is already usable from the Claude conversation, which is most of the value.

---

## 7 · What this is not

- Not a replacement for the estimates workbook. That stays authoritative for
  estimates, and v6 will re-baseline this.
- Not a replacement for `korp2-decisions-log.md`. That holds *why*; this holds
  *where*.
- Not a place for requirement text. Refs point at the signed-off catalogue.
