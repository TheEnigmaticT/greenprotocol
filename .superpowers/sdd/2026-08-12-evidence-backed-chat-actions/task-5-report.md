# Task 5 report

## Commit

`2cdea96 feat: atomically approve immutable scoped recommendations`

## RED evidence

Command:

```text
npm test -- tests/lib/talk-about-this/actions.test.ts
```

Observed before production implementation:

```text
FAIL tests/lib/talk-about-this/actions.test.ts
Error: Cannot find package '@/lib/talk-about-this/actions'
```

The focused test failed because the new approval helper did not exist.

## GREEN evidence

Commands:

```text
npm test -- tests/lib/talk-about-this/actions.test.ts tests/lib/talk-about-this/context.test.ts
npx tsc --noEmit
```

Observed:

```text
Test Files  2 passed (2)
Tests  12 passed (12)
```

`npx tsc --noEmit` completed with no output and exit code 0.

## SQL validation

No migration was applied or pushed, per the task constraint. Static validation ran against `supabase/migrations/20260812000000_secure_talk_actions.sql` and confirmed the immutable-conversation policy removal, `SECURITY DEFINER`/fixed `search_path`, row locks, direct action-table modification revocation, authenticated-only RPC execute grant, and receipt SELECT grant.

## Files

- `supabase/migrations/20260812000000_secure_talk_actions.sql`
- `lib/talk-about-this/actions.ts`
- `lib/talk-about-this/context.ts`
- `lib/talk-about-this/repository.ts`
- `app/api/talk-about-this/[conversationId]/messages/route.ts`
- `app/api/analyses/[id]/route.ts`
- `app/analyze/[id]/page.tsx`
- `tests/lib/talk-about-this/actions.test.ts`
- `tests/lib/talk-about-this/context.test.ts`

## Self-review

- Approval phrase matching has only two normalized direct phrases; questions, negations, conditions, and compound requests are not authority.
- The helper accepts only a conversation ID and calls one approval RPC; no model or client target selection occurs.
- Conversations have no owner update policy; legacy index scopes are explicitly read-only.
- The RPC authenticates, locks the owned conversation and analysis, verifies the frozen stable scope against the snapshot, requires exactly one current stable recommendation target, updates only its `isAccepted` JSONB path, increments the analysis revision, and writes an idempotent receipt in the same transaction.
- Direct action inserts, updates, and deletes have no RLS policy and their table privileges are revoked; the function is the sole authenticated mutation surface.
- Analysis PATCH uses a caller-supplied expected revision and returns 409 after a mismatch instead of overwriting a scoped approval.
- Direct approval messages persist user/receipt messages and emit only receipt-derived SSE data before any model provider is configured.

## Concerns

Remote migration/RPC concurrency integration was intentionally not executed because the assignment forbids applying a migration. The SQL transaction and grants were statically validated; live direct-insert denial, duplicate RPC receipt identity, and concurrent-approval behavior require a permitted linked Supabase test deployment.

## SSE approval repair

### RED

Command:

```text
npm test -- tests/lib/talk-about-this/activity.test.ts
```

Observed before implementation:

```text
TypeError: parseRecommendationApprovedEvent is not a function
```

The new focused receipt tests failed because the client had no typed `recommendation-approved` event parser or handler. An unrelated existing activity fixture assertion also failed because its received metadata includes the `pubchem:ghs` source ID.

### GREEN

Commands:

```text
npm test -- tests/lib/talk-about-this/activity.test.ts tests/lib/talk-about-this/actions.test.ts tests/lib/talk-about-this/context.test.ts
npx tsc --noEmit
```

Observed:

```text
Test Files  3 passed (3)
Tests  29 passed (29)
```

`npx tsc --noEmit` completed with no output and exit code 0.

The SSE consumer now validates a stable recommendation scope and exact recommendation ID before storing/displaying an RPC receipt and invoking its callback. The analysis page callback updates only the matching recommendation and server revision locally; it does not route through the debounced analysis PATCH.
