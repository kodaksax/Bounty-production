# Manual Hunter Assignment Runbook

**Purpose:** a safety net for the first live bounty (or any bounty) if organic
matching doesn't happen in time — lets an operator manually accept an
applicant, or assign a hunter who never applied, without going through the
in-app poster flow.

**Status:** No in-app admin UI button exists for this today (verified
2026-07-25 — `app/(admin)/bounty/[id].tsx` only exposes generic status
transitions and a read-only "Accepted By" field). This runbook is the
supported fallback until such a button is built. It uses only
already-deployed, already-tested production functions — **no migration or
edge function deploy is required to use it.**

All statements below were verified directly against the live production
schema/function definitions (Supabase project `xwlwqzzphmmhghiqvkeu`) on
2026-07-25, not reconstructed from git — git and prod have drifted before on
this exact function (see `20260719010000_document_fn_accept_bounty_request_authz_guard.sql`).
Run everything via the Supabase SQL/execute_sql tool (service-role context),
never through the app's anon/authenticated client.

## Why this works safely

`fn_accept_bounty_request(p_request_id text)` is `SECURITY DEFINER` and only
enforces "caller must be the poster" `IF auth.role() = 'authenticated'`. A
raw SQL/service-role call has no JWT, so `auth.role()` isn't `'authenticated'`
and the check is skipped — this is the same bypass edge functions rely on,
not a hole being newly exploited here. The function still enforces its real
invariants: the request must be `pending` and the bounty must be `open`, so
it can't double-assign or hijack an in-progress bounty.

## Step 0 — look up the bounty and confirm the poster id

```sql
select id, title, status, poster_id, user_id, amount, location
from bounties
where id = '<BOUNTY_ID>';
```

Use the `poster_id` value from this row (not `user_id`, which is a legacy
duplicate column) everywhere `<POSTER_ID>` appears below. Confirm
`status = 'open'` before proceeding — `fn_accept_bounty_request` will refuse
otherwise.

## Scenario A — a hunter already applied (pending request exists)

```sql
-- 1. Find the pending request for this bounty
select id, bounty_id, hunter_id, poster_id, status
from bounty_requests
where bounty_id = '<BOUNTY_ID>' and status = 'pending';

-- 2. Accept it (atomically sets bounty.status='in_progress',
--    bounty.accepted_by, rejects other pending requests for that bounty)
select * from fn_accept_bounty_request('<REQUEST_ID>');
```

## Scenario B — no one has applied; assign a specific known hunter

```sql
-- 1. Create a pending request on the hunter's behalf
insert into bounty_requests (bounty_id, poster_id, hunter_id, status)
values ('<BOUNTY_ID>', '<POSTER_ID>', '<HUNTER_ID>', 'pending')
returning id;

-- 2. Accept it
select * from fn_accept_bounty_request('<REQUEST_ID_FROM_STEP_1>');
```

## Step 3 (both scenarios) — recreate the conversation + welcome message

The in-app accept flow (`hooks/useAcceptRequest.ts`) also auto-creates a
conversation and sends a welcome message via
`rpc_create_conversation(p_participant_ids, p_bounty_id, p_name)`. **Don't
call that RPC from a raw SQL session** — the 3-arg overload live in
production requires `auth.uid()` to be non-null and will throw
`rpc_create_conversation: auth.uid() is null` outside an authenticated
client. Insert the rows directly instead — verified against the live
`conversations` (`name` is `NOT NULL`, no default) and `messages`
(`sender_id`/`text` `NOT NULL`) schemas:

```sql
-- Create the conversation
insert into conversations (bounty_id, is_group, name)
values ('<BOUNTY_ID>', false, '<BOUNTY_TITLE>')
returning id;

-- Add both participants
insert into conversation_participants (conversation_id, user_id)
values
  ('<CONV_ID>', '<POSTER_ID>'),
  ('<CONV_ID>', '<HUNTER_ID>');

-- Send the same welcome message the app would send, attributed to the poster
insert into messages (conversation_id, sender_id, text)
values (
  '<CONV_ID>',
  '<POSTER_ID>',
  'Welcome! You''ve been selected for this bounty. Let''s coordinate the details.'
);
```

## After running this

- Tell the assigned hunter directly (DM/text) that they've been selected —
  push notifications for the accept event are fired client-side in the
  normal flow, which this bypasses.
- Everything downstream (completion, escrow release, disputes) works exactly
  as if the poster had tapped Accept in-app — this only replaces the
  acceptance step and its side effects, nothing about payment state.

## Known trap to avoid

`rpc_create_conversation(uuid[], uuid)` — the 2-argument overload — is live
but currently broken: its `INSERT INTO conversations` omits the `name`
column, which is `NOT NULL` with no default, so calling it directly throws a
not-null violation. Don't use it; use the direct inserts in Step 3 above.
