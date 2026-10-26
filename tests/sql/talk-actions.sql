\set ON_ERROR_STOP on
-- Chat approve/reject receipts and procedure proposals against the REAL migrations.
-- Run with scripts/test-talk-actions-sql.py (it owns the disposable cluster).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
-- Supabase's auth.uid() reads the request JWT subject; the fixture sets it per session.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.gpc_analysis_traces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), analysis_id uuid, user_id uuid);
CREATE TABLE public.gpc_dedup_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), analysis_id uuid, user_id uuid);

\ir ../../supabase/migrations/20260222000000_create_gpc_analyses.sql
\ir ../../supabase/migrations/20260504000000_allow_users_update_own_analyses.sql
\ir ../../supabase/migrations/20260801000000_add_analysis_runs_and_revisions.sql
\ir ../../supabase/migrations/20260801000001_create_talk_about_this.sql
\ir ../../supabase/migrations/20260812000000_secure_talk_actions.sql
-- Idempotent-safe: the whole migration must be re-runnable.
\ir ../../supabase/migrations/20261026000000_talk_decisions_and_procedure_proposals.sql
\ir ../../supabase/migrations/20261026000000_talk_decisions_and_procedure_proposals.sql

GRANT SELECT, UPDATE ON public.gpc_analyses TO authenticated;
GRANT SELECT, INSERT ON public.gpc_talk_conversations TO authenticated;

CREATE FUNCTION pg_temp_assert(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF condition IS NOT TRUE THEN RAISE EXCEPTION 'ASSERT FAILED: %', message; END IF; END $$;

-- Runs a statement as a user (JWT subject + authenticated role) and returns the SQLSTATE, or 'ok'.
CREATE FUNCTION pg_temp_sqlstate(user_id uuid, statement text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', user_id::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN SQLSTATE;
  END;
  RESET ROLE;
  RETURN 'ok';
END $$;

DO $$
DECLARE
  u1 uuid := '00000000-0000-0000-0000-0000000000a1';
  u2 uuid := '00000000-0000-0000-0000-0000000000a2';
  analysis uuid;
  c_rec uuid; c_principle uuid; c_readonly uuid;
  r record; first_approve uuid; first_reject uuid; third uuid; proposal1 uuid; proposal2 uuid; proposal3 uuid;
  protocol constant text := 'Add 5 mL DMF to the flask and stir for 2 hours at room temperature.';
  protocol_hash text;
  rec_state text;
BEGIN
  protocol_hash := encode(sha256(convert_to(protocol, 'UTF8')), 'hex');
  INSERT INTO auth.users VALUES (u1, 'one@example.test'), (u2, 'two@example.test');
  INSERT INTO gpc_analyses(user_id, protocol_text, analysis_result) VALUES (u1, protocol,
    '{"recommendations":[
       {"id":"rec-1","original":{"chemical":"DMF"},"alternative":{"chemical":"Cyrene"}},
       {"id":"rec-2","original":{"chemical":"DCM"},"alternative":{"chemical":"EtOAc"}}]}') RETURNING id INTO analysis;
  INSERT INTO gpc_talk_conversations(analysis_id, user_id, scope, context_snapshot, context_hash)
    VALUES (analysis, u1, '{"kind":"recommendation","recommendationId":"rec-1"}', '{"scope":{"kind":"recommendation","recommendationId":"rec-1"}}', 'h1') RETURNING id INTO c_rec;
  INSERT INTO gpc_talk_conversations(analysis_id, user_id, scope, context_snapshot, context_hash)
    VALUES (analysis, u1, '{"kind":"principle","principleNumber":5}', '{"scope":{"kind":"principle","principleNumber":5}}', 'h2') RETURNING id INTO c_principle;
  INSERT INTO gpc_talk_conversations(analysis_id, user_id, scope, context_snapshot, context_hash)
    VALUES (analysis, u1, '{"kind":"recommendation","recommendationIndex":0,"readOnly":true}', '{"scope":{"kind":"recommendation","recommendationIndex":0}}', 'h3') RETURNING id INTO c_readonly;

  -- 1. approve
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM approve_scoped_recommendation(c_rec);
  RESET ROLE;
  first_approve := r.action_id;
  PERFORM pg_temp_assert(r.recommendation_id = 'rec-1' AND r.label = 'Cyrene', 'approve receipt names the recommendation');
  PERFORM pg_temp_assert(r.already_accepted = false AND r.revision_number = 2, 'first approve applies and bumps revision once');
  PERFORM pg_temp_assert((SELECT (analysis_result->'recommendations'->0->>'isAccepted')::boolean FROM gpc_analyses WHERE id = analysis), 'approve sets isAccepted true');

  -- 2. double-submit approve is a replay
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM approve_scoped_recommendation(c_rec);
  RESET ROLE;
  PERFORM pg_temp_assert(r.action_id = first_approve AND r.revision_number = 2, 'duplicate approve replays the same receipt');
  PERFORM pg_temp_assert((SELECT revision_number FROM gpc_analyses WHERE id = analysis) = 2, 'replay does not bump revision');
  PERFORM pg_temp_assert((SELECT count(*) FROM gpc_talk_actions WHERE conversation_id = c_rec) = 1, 'replay writes no new receipt');

  -- 3. reject after approve
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM reject_scoped_recommendation(c_rec);
  RESET ROLE;
  first_reject := r.action_id;
  PERFORM pg_temp_assert(first_reject <> first_approve AND r.already_accepted = false AND r.revision_number = 3, 'reject after approve applies as a new action');
  PERFORM pg_temp_assert((SELECT (analysis_result->'recommendations'->0->>'isAccepted')::boolean FROM gpc_analyses WHERE id = analysis) = false, 'reject sets isAccepted false');
  PERFORM pg_temp_assert((SELECT action_type FROM gpc_talk_actions WHERE conversation_id = c_rec ORDER BY decision_sequence DESC LIMIT 1) = 'reject_recommendation', 'latest receipt is the reject');

  -- 4. double-submit reject is a replay
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM reject_scoped_recommendation(c_rec);
  RESET ROLE;
  PERFORM pg_temp_assert(r.action_id = first_reject AND r.revision_number = 3, 'duplicate reject replays');

  -- 5. approve again after reject works
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM approve_scoped_recommendation(c_rec);
  RESET ROLE;
  third := r.action_id;
  PERFORM pg_temp_assert(third NOT IN (first_approve, first_reject) AND r.revision_number = 4 AND r.already_accepted = false, 'approve -> reject -> approve applies the second approval');
  PERFORM pg_temp_assert((SELECT count(*) FROM gpc_talk_actions WHERE conversation_id = c_rec) = 3, 'three distinct receipts');

  -- 6. an outside revision change (UI edit) makes the next explicit approve a fresh, non-bumping receipt
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE gpc_analyses SET revision_number = revision_number + 1 WHERE id = analysis;
  SELECT * INTO r FROM approve_scoped_recommendation(c_rec);
  RESET ROLE;
  PERFORM pg_temp_assert(r.action_id <> third AND r.already_accepted = true AND r.revision_number = 5, 'approve of an already-approved recommendation records already-decided without bumping revision');
  PERFORM pg_temp_assert((SELECT revision_number FROM gpc_analyses WHERE id = analysis) = 5, 'no-op decision leaves revision untouched');

  -- 7. wrong owner
  PERFORM pg_temp_assert(pg_temp_sqlstate(u2, format('SELECT * FROM approve_scoped_recommendation(%L)', c_rec)) = 'P0002', 'other user cannot approve');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u2, format('SELECT * FROM reject_scoped_recommendation(%L)', c_rec)) = 'P0002', 'other user cannot reject');
  PERFORM pg_temp_assert(pg_temp_sqlstate(NULL, format('SELECT * FROM reject_scoped_recommendation(%L)', c_rec)) IN ('42501', '22P02'), 'no session cannot reject');

  -- 8. scope guards
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM approve_scoped_recommendation(%L)', c_principle)) = '22023', 'principle scope cannot approve');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM reject_scoped_recommendation(%L)', c_readonly)) = '22023', 'read-only index scope cannot reject');

  -- 9. revision trigger still rejects a non +1 update
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('UPDATE gpc_analyses SET revision_number = revision_number + 2 WHERE id = %L', analysis)) = '40001', 'revision guard trigger rejects +2');

  -- 10. privileges / RLS
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('INSERT INTO gpc_talk_actions(conversation_id,analysis_id,user_id,action_type,status,target_recommendation_id,label,already_applied,revision_number) VALUES (%L,%L,%L,''reject_recommendation'',''completed'',''rec-1'',''x'',false,1)', c_rec, analysis, u1)) = '42501', 'authenticated cannot write receipts');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM gpc_decide_scoped_recommendation(%L, ''approve_recommendation'')', c_rec)) = '42501', 'internal decision function is not callable by authenticated');
  PERFORM pg_temp_assert(NOT has_function_privilege('anon', 'reject_scoped_recommendation(uuid)', 'EXECUTE'), 'anon cannot reject');
  PERFORM pg_temp_assert(NOT has_function_privilege('anon', 'approve_scoped_recommendation(uuid)', 'EXECUTE'), 'anon cannot approve');
  PERFORM pg_temp_assert(has_function_privilege('authenticated', 'reject_scoped_recommendation(uuid)', 'EXECUTE'), 'authenticated can reject');

  -- 11. stale target
  UPDATE gpc_analyses SET analysis_result = jsonb_set(analysis_result, '{recommendations}', '[{"id":"rec-2","original":{"chemical":"DCM"},"alternative":{"chemical":"EtOAc"}}]'), revision_number = revision_number + 1 WHERE id = analysis;
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM approve_scoped_recommendation(%L)', c_rec)) = 'P0002', 'missing target is stale');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM reject_scoped_recommendation(%L)', c_rec)) = 'P0002', 'missing target is stale for reject');

  -- 12. proposals: create / supersede / validation
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM create_talk_procedure_proposal(c_principle, 'Swap DMF', 'Add 5 mL Cyrene to the flask and stir for 2 hours at room temperature.', E'@@ -1 +1 @@\n-old\n+new', protocol_hash);
  RESET ROLE;
  proposal1 := r.proposal_id;
  PERFORM pg_temp_assert(r.base_revision_number = (SELECT revision_number FROM gpc_analyses WHERE id = analysis), 'proposal records the current revision');
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM create_talk_procedure_proposal(c_principle, 'Swap DMF again', 'Add 5 mL Cyrene to the flask and stir for 3 hours at room temperature.', E'@@ -1 +1 @@\n-old\n+new2', protocol_hash);
  RESET ROLE;
  proposal2 := r.proposal_id;
  PERFORM pg_temp_assert((SELECT status FROM gpc_talk_proposals WHERE id = proposal1) = 'cancelled', 'a newer proposal supersedes the pending one');
  PERFORM pg_temp_assert((SELECT count(*) FROM gpc_talk_proposals WHERE conversation_id = c_principle AND status = 'pending') = 1, 'exactly one pending proposal');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM create_talk_procedure_proposal(%L, ''x'', ''Add 5 mL Cyrene to the flask and stir.'', ''d'', %L)', c_principle, repeat('0', 64))) = '40001', 'wrong base hash is stale');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM create_talk_procedure_proposal(%L, ''x'', ''Add 5 mL Cyrene to the flask and stir.'', ''d'', %L)', c_readonly, protocol_hash)) = '22023', 'read-only scope cannot hold a proposal');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u2, format('SELECT * FROM create_talk_procedure_proposal(%L, ''x'', ''Add 5 mL Cyrene to the flask and stir.'', ''d'', %L)', c_principle, protocol_hash)) = 'P0002', 'other user cannot create a proposal');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM create_talk_procedure_proposal(%L, ''x'', ''short'', ''d'', %L)', c_principle, protocol_hash)) = '23514', 'proposed text under the minimum is rejected by the table');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('INSERT INTO gpc_talk_proposals(conversation_id,analysis_id,user_id,base_revision_number,base_text_hash,summary,proposed_text,diff) VALUES (%L,%L,%L,1,%L,''s'',''Add 5 mL Cyrene to the flask.'',''d'')', c_principle, analysis, u1, protocol_hash)) = '42501', 'authenticated cannot insert proposals directly');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('UPDATE gpc_talk_proposals SET status = ''applied'' WHERE id = %L', proposal2)) = '42501', 'authenticated cannot update proposals directly');

  PERFORM pg_temp_assert(NOT has_table_privilege('authenticated', 'gpc_talk_proposals', 'TRUNCATE') AND NOT has_table_privilege('anon', 'gpc_talk_proposals', 'SELECT'), 'API roles keep only owner-scoped select on proposals');

  -- RLS: select own only
  PERFORM set_config('request.jwt.claim.sub', u2::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp_assert((SELECT count(*) FROM gpc_talk_proposals) = 0, 'other user sees no proposals');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp_assert((SELECT count(*) FROM gpc_talk_proposals) = 2, 'owner sees own proposals');
  RESET ROLE;

  -- 13. apply: ownership, returns text, never touches the analysis
  PERFORM pg_temp_assert(pg_temp_sqlstate(u2, format('SELECT * FROM apply_talk_procedure_proposal(%L, %L)', c_principle, proposal2)) = 'P0002', 'other user cannot apply');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM apply_talk_procedure_proposal(%L, %L)', c_principle, proposal1)) = '55000', 'superseded proposal cannot be applied');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM apply_talk_procedure_proposal(%L, %L)', c_rec, proposal2)) = 'P0002', 'proposal is bound to its conversation');
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM apply_talk_procedure_proposal(c_principle, proposal2);
  RESET ROLE;
  PERFORM pg_temp_assert(r.outcome = 'applied' AND r.proposed_text LIKE '%3 hours%' AND r.proposal_id = proposal2, 'apply returns the proposed text');
  PERFORM pg_temp_assert((SELECT protocol_text FROM gpc_analyses WHERE id = analysis) = protocol, 'apply leaves the saved protocol untouched');
  PERFORM pg_temp_assert((SELECT status FROM gpc_talk_proposals WHERE id = proposal2) = 'applied', 'proposal marked applied');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM apply_talk_procedure_proposal(%L, %L)', c_principle, proposal2)) = '55000', 'double apply is refused');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT cancel_talk_procedure_proposal(%L, %L)', c_principle, proposal2)) = '55000', 'applied proposal cannot be cancelled');

  -- 14. cancel is idempotent
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM create_talk_procedure_proposal(c_principle, 'Another', 'Add 5 mL Cyrene to the flask and stir for 4 hours at room temperature.', 'd', protocol_hash);
  RESET ROLE;
  proposal3 := r.proposal_id;
  PERFORM pg_temp_assert(pg_temp_sqlstate(u2, format('SELECT cancel_talk_procedure_proposal(%L, %L)', c_principle, proposal3)) = 'P0002', 'other user cannot cancel');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT cancel_talk_procedure_proposal(%L, %L)', c_principle, proposal3)) = 'ok', 'cancel pending');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT cancel_talk_procedure_proposal(%L, %L)', c_principle, proposal3)) = 'ok', 'cancel twice is fine');
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM apply_talk_procedure_proposal(%L, %L)', c_principle, proposal3)) = '55000', 'cancelled proposal cannot be applied');

  -- 15. stale base hash at apply time marks the proposal stale and returns no text
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM create_talk_procedure_proposal(c_principle, 'Will go stale', 'Add 5 mL Cyrene to the flask and stir for 5 hours at room temperature.', 'd', protocol_hash);
  RESET ROLE;
  proposal3 := r.proposal_id;
  UPDATE gpc_analyses SET protocol_text = protocol || ' Extra.', revision_number = revision_number + 1 WHERE id = analysis;
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM apply_talk_procedure_proposal(c_principle, proposal3);
  RESET ROLE;
  PERFORM pg_temp_assert(r.outcome = 'stale' AND r.proposed_text IS NULL, 'changed protocol makes the proposal stale');
  PERFORM pg_temp_assert((SELECT status FROM gpc_talk_proposals WHERE id = proposal3) = 'stale', 'stale status persisted');

  -- 16. closed conversations take no proposals
  UPDATE gpc_talk_conversations SET status = 'closed' WHERE id = c_principle;
  PERFORM pg_temp_assert(pg_temp_sqlstate(u1, format('SELECT * FROM create_talk_procedure_proposal(%L, ''x'', ''Add 5 mL Cyrene to the flask and stir.'', ''d'', %L)', c_principle, encode(sha256(convert_to(protocol || ' Extra.', 'UTF8')), 'hex'))) = '55000', 'closed conversation cannot take proposals');
END $$;
-- Left committed for the two-session race check in scripts/test-talk-actions-sql.py.
INSERT INTO gpc_analyses(id, user_id, protocol_text, analysis_result) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Add 5 mL DMF to the flask and stir.',
   '{"recommendations":[{"id":"rec-race","original":{"chemical":"DMF"},"alternative":{"chemical":"Cyrene"}}]}');
INSERT INTO gpc_talk_conversations(id, analysis_id, user_id, scope, context_snapshot, context_hash) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
   '{"kind":"recommendation","recommendationId":"rec-race"}', '{"scope":{"kind":"recommendation","recommendationId":"rec-race"}}', 'race');
SELECT 'talk actions SQL acceptance passed' AS result;
