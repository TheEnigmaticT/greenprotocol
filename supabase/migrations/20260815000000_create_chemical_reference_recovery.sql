-- Durable chemical reference cache and retry ledger.
CREATE TABLE public.gpc_chemical_reference_cache (
  normalized_name text PRIMARY KEY CHECK (char_length(normalized_name) BETWEEN 1 AND 200),
  record jsonb NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gpc_chemical_reference_misses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_name text NOT NULL UNIQUE CHECK (char_length(normalized_name) BETWEEN 1 AND 200),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','retrying','resolved','terminal_not_found')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz DEFAULT now(),
  last_http_status integer CHECK (last_http_status IS NULL OR last_http_status BETWEEN 100 AND 599),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code IN ('http_429','http_503','http_504','network','timeout','not_found')),
  first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz, locked_at timestamptz, locked_until timestamptz, locked_by text,
  CHECK (locked_until IS NULL OR locked_at IS NOT NULL)
);
ALTER TABLE public.gpc_chemical_reference_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gpc_chemical_reference_misses ENABLE ROW LEVEL SECURITY;
CREATE INDEX gpc_reference_misses_due_idx ON public.gpc_chemical_reference_misses(next_attempt_at, first_seen_at) WHERE status IN ('pending','retrying');

CREATE OR REPLACE FUNCTION public.upsert_chemical_reference_miss(p_normalized_name text, p_display_name text, p_retryable boolean, p_http_status integer DEFAULT NULL, p_error_code text DEFAULT NULL)
RETURNS TABLE(id uuid, normalized_name text, status text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_normalized_name IS NULL OR p_normalized_name <> lower(btrim(p_normalized_name)) OR char_length(p_normalized_name) NOT BETWEEN 1 AND 200 OR p_display_name IS NULL OR char_length(btrim(p_display_name)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid chemical reference identity' USING ERRCODE='22023'; END IF;
  IF p_retryable AND p_error_code NOT IN ('http_429','http_503','http_504','network','timeout') THEN RAISE EXCEPTION 'invalid retry code' USING ERRCODE='22023'; END IF;
  IF NOT p_retryable AND p_http_status IS DISTINCT FROM 404 THEN RETURN; END IF;
  INSERT INTO public.gpc_chemical_reference_misses(normalized_name,display_name,status,next_attempt_at,last_http_status,last_error_code)
  VALUES (p_normalized_name,btrim(p_display_name),CASE WHEN p_retryable THEN 'pending' ELSE 'terminal_not_found' END,CASE WHEN p_retryable THEN now() ELSE NULL END,p_http_status,p_error_code)
  ON CONFLICT (normalized_name) DO UPDATE SET display_name=excluded.display_name,last_seen_at=now(),last_http_status=excluded.last_http_status,last_error_code=excluded.last_error_code,
    status=CASE WHEN gpc_chemical_reference_misses.status IN ('resolved','terminal_not_found') THEN gpc_chemical_reference_misses.status ELSE excluded.status END,
    next_attempt_at=CASE WHEN gpc_chemical_reference_misses.status IN ('resolved','terminal_not_found') THEN gpc_chemical_reference_misses.next_attempt_at ELSE LEAST(gpc_chemical_reference_misses.next_attempt_at,now()) END,
    resolved_at=CASE WHEN gpc_chemical_reference_misses.status='terminal_not_found' THEN gpc_chemical_reference_misses.resolved_at ELSE NULL END;
  RETURN QUERY SELECT m.id,m.normalized_name,m.status FROM public.gpc_chemical_reference_misses m WHERE m.normalized_name=p_normalized_name;
END $$;

CREATE OR REPLACE FUNCTION public.claim_due_chemical_reference_misses(p_worker_id text,p_limit integer DEFAULT 20,p_lease_seconds integer DEFAULT 300)
RETURNS SETOF public.gpc_chemical_reference_misses LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_worker_id IS NULL OR char_length(p_worker_id) NOT BETWEEN 1 AND 200 OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN RAISE EXCEPTION 'invalid lease request' USING ERRCODE='22023'; END IF;
 RETURN QUERY WITH picked AS (SELECT id FROM public.gpc_chemical_reference_misses WHERE status IN ('pending','retrying') AND next_attempt_at<=now() AND (locked_until IS NULL OR locked_until<=now()) ORDER BY next_attempt_at,first_seen_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),50))
 UPDATE public.gpc_chemical_reference_misses m SET status='retrying',attempt_count=m.attempt_count+1,locked_at=now(),locked_until=now()+p_lease_seconds*interval '1 second',locked_by=p_worker_id,last_seen_at=now() FROM picked WHERE m.id=picked.id RETURNING m.*;
END $$;

CREATE OR REPLACE FUNCTION public.complete_chemical_reference_miss(p_id uuid,p_worker_id text,p_result text,p_http_status integer DEFAULT NULL,p_error_code text DEFAULT NULL,p_next_attempt_at timestamptz DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
 IF p_result NOT IN ('resolved','retryable','terminal') OR (p_result='retryable' AND p_next_attempt_at<=now()) OR (p_result<>'retryable' AND p_next_attempt_at IS NOT NULL) THEN RAISE EXCEPTION 'invalid completion' USING ERRCODE='22023'; END IF;
 UPDATE public.gpc_chemical_reference_misses SET status=CASE p_result WHEN 'resolved' THEN 'resolved' WHEN 'terminal' THEN 'terminal_not_found' ELSE 'retrying' END,next_attempt_at=CASE WHEN p_result='retryable' THEN p_next_attempt_at ELSE NULL END,resolved_at=CASE WHEN p_result IN ('resolved','terminal') THEN now() ELSE NULL END,locked_at=NULL,locked_until=NULL,locked_by=NULL,last_http_status=p_http_status,last_error_code=p_error_code WHERE id=p_id AND locked_by=p_worker_id AND locked_until>now();
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;

CREATE OR REPLACE FUNCTION public.upsert_chemical_reference_cache(p_normalized_name text,p_record jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_normalized_name IS NULL OR p_normalized_name<>lower(btrim(p_normalized_name)) OR char_length(p_normalized_name) NOT BETWEEN 1 AND 200 OR p_record IS NULL OR jsonb_typeof(p_record)<>'object' THEN RAISE EXCEPTION 'invalid chemical cache record' USING ERRCODE='22023'; END IF;
 INSERT INTO public.gpc_chemical_reference_cache VALUES(p_normalized_name,p_record,now()) ON CONFLICT(normalized_name) DO UPDATE SET record=excluded.record,updated_at=now(); RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.get_chemical_reference_cache(p_normalized_name text)
RETURNS TABLE(normalized_name text,record jsonb,updated_at timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT c.normalized_name,c.record,c.updated_at FROM public.gpc_chemical_reference_cache c WHERE c.normalized_name=p_normalized_name $$;

REVOKE ALL ON TABLE public.gpc_chemical_reference_cache, public.gpc_chemical_reference_misses FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.upsert_chemical_reference_miss(text,text,boolean,integer,text), public.claim_due_chemical_reference_misses(text,integer,integer), public.complete_chemical_reference_miss(uuid,text,text,integer,text,timestamptz), public.upsert_chemical_reference_cache(text,jsonb), public.get_chemical_reference_cache(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_chemical_reference_miss(text,text,boolean,integer,text), public.claim_due_chemical_reference_misses(text,integer,integer), public.complete_chemical_reference_miss(uuid,text,text,integer,text,timestamptz), public.upsert_chemical_reference_cache(text,jsonb), public.get_chemical_reference_cache(text) TO service_role;
