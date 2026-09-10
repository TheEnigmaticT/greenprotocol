-- Shared PubChem budget. One durable, server-time-governed lease is consumed
-- immediately before every outbound PUG request (including retries and GHS).
CREATE TABLE IF NOT EXISTS public.gpc_pubchem_request_budget (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  next_allowed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.gpc_pubchem_request_budget(singleton, next_allowed_at)
VALUES (true, now())
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.acquire_pubchem_request_slot(
  p_min_interval_ms integer DEFAULT 1000
)
RETURNS TABLE(granted boolean, retry_after_ms integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_next timestamptz;
  acquired_at timestamptz;
  interval_ms integer := LEAST(GREATEST(p_min_interval_ms, 1000), 60000);
BEGIN
  SELECT next_allowed_at INTO current_next
  FROM public.gpc_pubchem_request_budget
  WHERE singleton = true
  FOR UPDATE;

  -- Sample the database server clock only after waiting for this row lock.
  -- A timestamp captured before a blocked lock would be stale on resumption.
  acquired_at := clock_timestamp();

  IF current_next <= acquired_at THEN
    UPDATE public.gpc_pubchem_request_budget
    SET next_allowed_at = acquired_at + make_interval(secs => interval_ms::numeric / 1000),
        updated_at = acquired_at
    WHERE singleton = true;
    RETURN QUERY SELECT true, 0;
  ELSE
    RETURN QUERY SELECT false, CEIL(EXTRACT(epoch FROM current_next - acquired_at) * 1000)::integer;
  END IF;
END;
$$;

REVOKE ALL ON TABLE public.gpc_pubchem_request_budget FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_pubchem_request_slot(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_pubchem_request_slot(integer) TO service_role;

-- The original ledger constraint and RPC predate the shared budget deferral.
-- Both must recognize `rate_budget`, or a deliberately deferred request cannot
-- enter the durable queue.
ALTER TABLE public.gpc_chemical_reference_misses
  DROP CONSTRAINT gpc_chemical_reference_misses_last_error_code_check;
ALTER TABLE public.gpc_chemical_reference_misses
  ADD CONSTRAINT gpc_chemical_reference_misses_last_error_code_check
  CHECK (last_error_code IS NULL OR last_error_code IN (
    'http_429','http_503','http_504','network','timeout','not_found','rate_budget'
  ));

-- `rate_budget` is a retryable local deferral produced before any outbound
-- PubChem request. Keep the durable recovery ledger's contract aligned with
-- the client, rather than misclassifying an intentional defer as an absence.
CREATE OR REPLACE FUNCTION public.upsert_chemical_reference_miss(
  p_normalized_name text,
  p_display_name text,
  p_retryable boolean,
  p_http_status integer DEFAULT NULL,
  p_error_code text DEFAULT NULL
)
RETURNS TABLE(id uuid, normalized_name text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_normalized_name IS NULL
     OR p_normalized_name <> lower(btrim(p_normalized_name))
     OR char_length(p_normalized_name) NOT BETWEEN 1 AND 200
     OR p_display_name IS NULL
     OR char_length(btrim(p_display_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid chemical reference identity' USING ERRCODE = '22023';
  END IF;
  IF p_retryable
     AND p_error_code NOT IN ('http_429','http_503','http_504','network','timeout','rate_budget') THEN
    RAISE EXCEPTION 'invalid retry code' USING ERRCODE = '22023';
  END IF;
  IF NOT p_retryable AND p_http_status IS DISTINCT FROM 404 THEN
    RETURN;
  END IF;

  INSERT INTO public.gpc_chemical_reference_misses(
    normalized_name, display_name, status, next_attempt_at,
    last_http_status, last_error_code
  )
  VALUES (
    p_normalized_name, btrim(p_display_name),
    CASE WHEN p_retryable THEN 'pending' ELSE 'terminal_not_found' END,
    CASE WHEN p_retryable THEN now() ELSE NULL END,
    p_http_status, p_error_code
  )
  ON CONFLICT ON CONSTRAINT gpc_chemical_reference_misses_normalized_name_key
  DO UPDATE SET
    display_name = EXCLUDED.display_name,
    last_seen_at = now(),
    last_http_status = EXCLUDED.last_http_status,
    last_error_code = EXCLUDED.last_error_code,
    status = CASE
      WHEN gpc_chemical_reference_misses.status IN ('resolved','terminal_not_found')
        THEN gpc_chemical_reference_misses.status
      ELSE EXCLUDED.status
    END,
    next_attempt_at = CASE
      WHEN gpc_chemical_reference_misses.status IN ('resolved','terminal_not_found')
        THEN gpc_chemical_reference_misses.next_attempt_at
      ELSE LEAST(gpc_chemical_reference_misses.next_attempt_at, now())
    END,
    resolved_at = CASE
      WHEN gpc_chemical_reference_misses.status = 'terminal_not_found'
        THEN gpc_chemical_reference_misses.resolved_at
      ELSE NULL
    END;

  RETURN QUERY
    SELECT m.id, m.normalized_name, m.status
    FROM public.gpc_chemical_reference_misses AS m
    WHERE m.normalized_name = p_normalized_name;
END;
$$;
