# Project Board — How It Works

<!-- Machine-readable metadata — jared scripts parse this. Do not reorder or
     rename the fields below. The narrative docs after the field blocks are
     for humans; jared ignores them. Re-run bootstrap-project.py after any
     schema change to keep this file in sync. -->

- Project URL: https://github.com/users/leolaporte/projects/1
- Project number: 1
- Project ID: PVT_kwHOAg1qps4BX07P
- Owner: leolaporte
- Repo: leolaporte/ai-briefing

### Status
- Field ID: PVTSSF_lAHOAg1qps4BX07PzhS_IKQ
- Todo: f75ad846
- In Progress: 47fc9ee4
- Done: 98236657

### Priority
- Field ID: PVTSSF_lAHOAg1qps4BX07PzhS_IaY
- High: 45fb3304
- Medium: f50d7579
- Low: 2ec4b018

### Work Stream
- Field ID: PVTSSF_lAHOAg1qps4BX07PzhS_IbQ
- Ingestion: 39df1a95
- Scoring: f4f38375
- Briefing Generation: aaf2af0e
- Delivery: 0a7588c4
- Operations: 9726a86b

<!-- End machine-readable block — narrative docs follow. -->

The GitHub Projects v2 board at [ai-briefing](https://github.com/users/leolaporte/projects/1) is the **single source of
truth for what is being worked on and why**. No markdown tracking files, no separate
backlog lists, no TODO.md. If it isn't on the board, it isn't on the roadmap.

This document describes the conventions so anyone (human or Hermes session) can triage,
prioritize, and move work consistently.

**Bootstrapped by Jared on 2026-05-15.** If you rename fields or add options,
re-run `scripts/bootstrap-project.py --url https://github.com/users/leolaporte/projects/1 --repo leolaporte/ai-briefing` or edit this
file directly.

## Columns (Status field)

| Column | Meaning |
|---|---|
| **Todo** | Captured but not actively being worked. This board uses GitHub's built-in Status field, so Todo serves as Jared's Backlog / Up Next pool. |
| **In Progress** | Actively being worked on right now. |
| **Done** | Closed issues. Auto-populated when an issue closes. |

**Rules:**

- In Progress stays small. More than ~3 items means focus is scattered.
- Todo is ordered — top High-priority items are what gets worked next. Priority field breaks ties.
- Nothing in In Progress without Priority and Work Stream set.
- When an issue closes, it moves to Done automatically.

## Priority field

| Value | Meaning |
|---|---|
| **High** | Directly advances the current strategic goal. Addressed before Medium. |
| **Medium** | Quality, efficiency, or reliability improvement. Important but not urgent. |
| **Low** | Nice-to-have, future-facing, or optional. Safe to defer indefinitely. |

**Rules:**

- Every open issue must have a Priority set.
- High is scarce by design — if everything is High, nothing is.
- Two High items in In Progress at once should be rare and deliberate.

## Work Stream field

| Stream | Scope |
|---|---|
| **Ingestion** | RSS, OPML, archive, label import, and corpus growth. |
| **Scoring** | Prompts, few-shot examples, Claude scoring, classifier work, and evaluation. |
| **Briefing Generation** | Candidate selection, show-specific output, and markdown formatting. |
| **Delivery** | Obsidian publishing path, notifications, and downstream consumption. |
| **Operations** | Systemd timers, retraining jobs, config, dependency hygiene, and reliability. |

**Rules:**

- Work streams are project-specific and describe the kind of work, not its priority or status.
- Every open issue should belong to exactly one work stream.

## Labels

Labels describe **what kind of issue it is**, not where it lives on the board. Status
and priority come from board fields, not labels.

Suggested defaults (create via `gh label create` as needed):

| Label | Meaning |
|---|---|
| `bug` | Something isn't working |
| `enhancement` | New capability |
| `refactor` | Restructuring without behavior change |
| `documentation` | Docs-only change |

This board currently uses GitHub's built-in Status field, which exposes Todo /
In Progress / Done through the API. For blocked work, keep the issue in its
current Status and add a `## Blocked by` section naming the blocker and owner.

Project-specific scope labels (e.g., `infra`, `frontend`, `customer-facing`) belong here
too — add them as needed.

## Triage checklist — new issue

When a new issue is filed:

1. **Auto-add to board.** `gh issue create` does not auto-add; use
   `gh project item-add 1 --owner leolaporte --url <issue-url>`.
2. **Set Priority** — High / Medium / Low.
3. **Set Work Stream** — per the fields above.
4. **Leave Status as Todo** unless explicitly scheduling.
5. **Apply labels** for issue type and scope.

An issue without Priority and Work Stream sorts to the bottom and disappears.

## Fields quick reference (for gh project CLI)

```
Project ID:          PVT_kwHOAg1qps4BX07P

Status field ID:     PVTSSF_lAHOAg1qps4BX07PzhS_IKQ
  Todo:                 f75ad846
  In Progress:          47fc9ee4
  Done:                 98236657

Priority field ID:   PVTSSF_lAHOAg1qps4BX07PzhS_IaY
  High:                 45fb3304
  Medium:               f50d7579
  Low:                  2ec4b018

Work Stream ID:      PVTSSF_lAHOAg1qps4BX07PzhS_IbQ
  Ingestion:            39df1a95
  Scoring:              f4f38375
  Briefing Generation:  aaf2af0e
  Delivery:             0a7588c4
  Operations:           9726a86b
```

## Example — move an item to In Progress

```bash
gh project item-edit \
  --project-id PVT_kwHOAg1qps4BX07P \
  --id <ITEM_ID> \
  --field-id PVTSSF_lAHOAg1qps4BX07PzhS_IKQ \
  --single-select-option-id 47fc9ee4
```

## Further conventions

This file is the minimum. See the skill's references for:

- `references/human-readable-board.md` — title/body templates
- `references/board-sweep.md` — grooming checklist
- `references/plan-spec-integration.md` — if this project uses plan/spec artifacts
- `references/session-continuity.md` — Session note format
