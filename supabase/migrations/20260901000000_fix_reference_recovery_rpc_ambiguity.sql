-- Disambiguate ON CONFLICT targets inside RETURNS TABLE/PLpgSQL functions.
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
     AND p_error_code NOT IN ('http_429','http_503','http_504','network','timeout') THEN
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
    p_normalized_name,
    btrim(p_display_name),
    CASE WHEN p_retryable THEN 'pending' ELSE 'terminal_not_found' END,
    CASE WHEN p_retryable THEN now() ELSE NULL END,
    p_http_status,
    p_error_code
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

CREATE OR REPLACE FUNCTION public.upsert_chemical_reference_cache(
  p_normalized_name text,
  p_record jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_normalized_name IS NULL
     OR p_normalized_name <> lower(btrim(p_normalized_name))
     OR char_length(p_normalized_name) NOT BETWEEN 1 AND 200
     OR p_record IS NULL
     OR jsonb_typeof(p_record) <> 'object' THEN
    RAISE EXCEPTION 'invalid chemical cache record' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.gpc_chemical_reference_cache(normalized_name, record, updated_at)
  VALUES (p_normalized_name, p_record, now())
  ON CONFLICT ON CONSTRAINT gpc_chemical_reference_cache_pkey
  DO UPDATE SET record = EXCLUDED.record, updated_at = now();
  RETURN true;
END;
$$;
