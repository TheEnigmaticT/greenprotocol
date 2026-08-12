# Task 4 report

## Commit

`55015dc feat: stream scoped literature evidence in chat`

## RED evidence

Command:

```text
npm test -- tests/lib/talk-about-this/tools.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/prompt.test.ts
```

Observed expected failures before production changes:

```text
FAIL tests/lib/talk-about-this/agent.test.ts > parseScopedToolCall literature boundary > accepts a scoped bounded query and rejects an oversized query
Error: Unsupported tool requested: search_scoped_literature_evidence

FAIL tests/lib/talk-about-this/agent.test.ts > literature evidence propagation > propagates retrieved evidence citations and streams the first provider delta
TypeError: undefined is not iterable

FAIL tests/lib/talk-about-this/tools.test.ts > buildChatTools > exposes a closed, bounded literature evidence tool
AssertionError: expected undefined to deeply equal { type: 'object', …(3) }
```

## GREEN evidence

Command:

```text
npm test -- tests/lib/talk-about-this/tools.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/prompt.test.ts
```

Exact output:

```text
> greenchemistry-ai@0.6.0 test
> vitest run tests/lib/talk-about-this/tools.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/prompt.test.ts

 RUN  v4.1.7 /Users/ct-mac-mini/dev/greenchemistry-ai/.worktrees/evidence-backed-chat

 Test Files  3 passed (3)
      Tests  16 passed (16)
   Start at  15:39:34
   Duration  172ms (transform 119ms, setup 0ms, import 205ms, tests 27ms, environment 0ms)
```

## Files

- `lib/talk-about-this/tools.ts`
- `lib/talk-about-this/agent.ts`
- `lib/talk-about-this/prompt.ts`
- `app/api/talk-about-this/[conversationId]/messages/route.ts`
- `tests/lib/talk-about-this/tools.test.ts`
- `tests/lib/talk-about-this/agent.test.ts`

## Implementation

Added the closed `search_scoped_literature_evidence` schema and parser boundary; bounded retrieval to five page-level matches through `searchLiteratureEvidence`; enforced scoped query terms and controlled signal groups; forwarded abort signals; propagated display-safe evidence and citations; preserved tool limits/timeouts; streamed every provider text delta immediately; persisted unique literature citation IDs with snapshot citation IDs; and returned structured evidence in `tool-complete` and `done` events.

## Self-review

- Arbitrary tool names and properties are rejected before execution.
- Literature retrieval is server-side and never invokes the chemistry-service fetch path.
- No ChatGPT, Anthropic, proprietary fallback, approval, UI, importer, migration, or pipeline work was added.
- Candidate status is explicitly required verbatim in the prompt.

## Concerns

Focused tests cover the tool boundary, evidence propagation, abort failure handling, and first delta. The requested focused suite does not include a route-level test file, so route persistence/SSE behavior is covered by the implementation review and the agent contract rather than a separate route test.

## Repair commit

`6b39a5e fix: preserve scoped chat evidence`

## Repair RED/GREEN evidence

- RED: `npm test -- tests/lib/talk-about-this/agent.test.ts` failed because the second provider round did not authorize `doi:p3:u1`; `npm test -- tests/lib/talk-about-this/repository.test.ts` failed because `assistantMessageCitations` did not exist.
- GREEN: `npm test -- tests/lib/talk-about-this/tools.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/prompt.test.ts tests/lib/talk-about-this/repository.test.ts` passed: 4 files, 17 tests.
- Type check: `npx tsc --noEmit` passed with no output.

## Repair files

- `lib/talk-about-this/agent.ts`
- `lib/talk-about-this/prompt.ts`
- `lib/talk-about-this/repository.ts`
- `app/api/talk-about-this/[conversationId]/messages/route.ts`
- `lib/talk-about-this/tools.ts`
- `tests/lib/talk-about-this/agent.test.ts`
- `tests/lib/talk-about-this/repository.test.ts`
- `tests/lib/talk-about-this/tools.test.ts`
- `tests/lib/talk-about-this/prompt.test.ts`
- `tests/lib/talk-about-this/activity.test.ts`

## Repair concerns

`citations` is existing JSONB message storage, so structured literature provenance is persisted without a migration. Snapshot citation IDs remain strings; only retrieved literature citations carry the reconstructible evidence record.
