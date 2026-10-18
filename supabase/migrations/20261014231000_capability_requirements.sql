-- Optional ordinary-task declarations, not evidence or verified eligibility.
BEGIN;

CREATE TABLE public.capability_taxonomy_versions (
  version integer PRIMARY KEY CHECK (version > 0),
  active boolean NOT NULL DEFAULT false,
  scope text NOT NULL DEFAULT 'ordinary' CHECK (scope = 'ordinary')
);
CREATE UNIQUE INDEX capability_one_active_version ON public.capability_taxonomy_versions(active) WHERE active;
CREATE TABLE public.capability_tasks (
  taxonomy_version integer NOT NULL REFERENCES public.capability_taxonomy_versions(version),
  id text NOT NULL CHECK (id ~ '^[a-z][a-z0-9_]{0,63}$'),
  category text NOT NULL CHECK (category IN ('labor','delivery','design','tech','writing','other')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (taxonomy_version, id)
);
CREATE TABLE public.capability_terms (
  taxonomy_version integer NOT NULL REFERENCES public.capability_taxonomy_versions(version),
  id text NOT NULL CHECK (id ~ '^[a-z][a-z0-9_]{0,63}$'),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('skill','tool')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (taxonomy_version, id)
);
CREATE TABLE public.capability_task_terms (
  taxonomy_version integer NOT NULL,
  task_id text NOT NULL,
  term_id text NOT NULL,
  PRIMARY KEY (taxonomy_version, task_id, term_id),
  FOREIGN KEY (taxonomy_version, task_id) REFERENCES public.capability_tasks(taxonomy_version,id),
  FOREIGN KEY (taxonomy_version, term_id) REFERENCES public.capability_terms(taxonomy_version,id)
);

INSERT INTO public.capability_taxonomy_versions VALUES (1,true,'ordinary');
INSERT INTO public.capability_tasks (taxonomy_version,id,category,label) VALUES
  (1,'organize_items','labor','Organize household items'),
  (1,'pickup_items','delivery','Pick up ordinary items'),
  (1,'simple_graphic','design','Create a simple graphic'),
  (1,'spreadsheet_cleanup','tech','Clean up a spreadsheet'),
  (1,'proofread_text','writing','Proofread ordinary text'),
  (1,'wait_in_line','other','Wait in line');
INSERT INTO public.capability_terms (taxonomy_version,id,label,kind) VALUES
  (1,'organization','Organization','skill'), (1,'storage_bins','Storage bins','tool'),
  (1,'route_planning','Route planning','skill'), (1,'carry_bag','Carry bag','tool'),
  (1,'graphic_layout','Graphic layout','skill'), (1,'design_software','Design software','tool'),
  (1,'spreadsheet_editing','Spreadsheet editing','skill'), (1,'spreadsheet_software','Spreadsheet software','tool'),
  (1,'proofreading','Proofreading','skill'), (1,'text_editor','Text editor','tool'),
  (1,'queue_coordination','Queue coordination','skill'), (1,'mobile_phone','Mobile phone','tool');
INSERT INTO public.capability_task_terms VALUES
  (1,'organize_items','organization'),(1,'organize_items','storage_bins'),
  (1,'pickup_items','route_planning'),(1,'pickup_items','carry_bag'),
  (1,'simple_graphic','graphic_layout'),(1,'simple_graphic','design_software'),
  (1,'spreadsheet_cleanup','spreadsheet_editing'),(1,'spreadsheet_cleanup','spreadsheet_software'),
  (1,'proofread_text','proofreading'),(1,'proofread_text','text_editor'),
  (1,'wait_in_line','queue_coordination'),(1,'wait_in_line','mobile_phone');

CREATE TABLE public.hunter_capabilities (
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  taxonomy_version integer NOT NULL,
  task_id text NOT NULL,
  term_id text NOT NULL,
  proficiency text CHECK (proficiency IN ('beginner','comfortable','experienced')),
  experience text CHECK (experience IN ('none','some','regular')),
  provenance text NOT NULL DEFAULT 'self_reported' CHECK (provenance = 'self_reported'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (owner_id,taxonomy_version,task_id,term_id),
  FOREIGN KEY (taxonomy_version,task_id,term_id)
    REFERENCES public.capability_task_terms(taxonomy_version,task_id,term_id)
);
CREATE TABLE public.bounty_requirements (
  bounty_id uuid NOT NULL REFERENCES public.bounties(id) ON DELETE CASCADE,
  taxonomy_version integer NOT NULL,
  task_id text NOT NULL,
  term_id text NOT NULL,
  importance text NOT NULL CHECK (importance IN ('required','preferred')),
  provenance text NOT NULL DEFAULT 'poster_declared' CHECK (provenance = 'poster_declared'),
  requirements_revision bigint NOT NULL CHECK (requirements_revision > 0),
  confirmed_at timestamptz NOT NULL,
  PRIMARY KEY (bounty_id,term_id),
  FOREIGN KEY (taxonomy_version,task_id,term_id)
    REFERENCES public.capability_task_terms(taxonomy_version,task_id,term_id)
);
-- Durable even if a pending application is subsequently withdrawn/deleted.
CREATE TABLE public.bounty_requirement_locks (
  bounty_id uuid PRIMARY KEY REFERENCES public.bounties(id) ON DELETE CASCADE,
  locked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.capability_taxonomy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_task_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hunter_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bounty_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bounty_requirement_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY capability_versions_read ON public.capability_taxonomy_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY capability_tasks_read ON public.capability_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY capability_terms_read ON public.capability_terms FOR SELECT TO authenticated USING (true);
CREATE POLICY capability_links_read ON public.capability_task_terms FOR SELECT TO authenticated USING (true);
CREATE POLICY hunter_capabilities_owner_read ON public.hunter_capabilities FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY bounty_requirements_read ON public.bounty_requirements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bounties b WHERE b.id = bounty_id));
REVOKE ALL ON public.capability_taxonomy_versions, public.capability_tasks, public.capability_terms,
  public.capability_task_terms, public.hunter_capabilities, public.bounty_requirements,
  public.bounty_requirement_locks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.capability_taxonomy_versions, public.capability_tasks, public.capability_terms,
  public.capability_task_terms, public.hunter_capabilities, public.bounty_requirements TO authenticated;
GRANT ALL ON public.capability_taxonomy_versions, public.capability_tasks, public.capability_terms,
  public.capability_task_terms, public.hunter_capabilities, public.bounty_requirements,
  public.bounty_requirement_locks TO service_role;

CREATE FUNCTION public.get_my_hunter_capabilities()
RETURNS SETOF public.hunter_capabilities LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  RETURN QUERY SELECT * FROM public.hunter_capabilities WHERE owner_id = auth.uid();
END;
$$;
CREATE FUNCTION public.set_my_hunter_capabilities(p_declarations jsonb, p_taxonomy_version integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_version integer; d jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF jsonb_typeof(p_declarations) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_capabilities'; END IF;
  IF jsonb_array_length(p_declarations) > 24 THEN RAISE EXCEPTION 'too_many_capabilities'; END IF;
  PERFORM 1 FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_required'; END IF;
  PERFORM public.assert_account_active(auth.uid());
  SELECT version INTO STRICT v_version FROM public.capability_taxonomy_versions WHERE active AND scope = 'ordinary' FOR SHARE;
  IF p_taxonomy_version IS NULL OR p_taxonomy_version <> v_version
  THEN RAISE EXCEPTION 'taxonomy_version_changed'; END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(p_declarations) LOOP
    IF jsonb_typeof(d) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_capability'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('task_id','term_id','proficiency','experience'))
      OR jsonb_typeof(d->'task_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(d->'term_id') IS DISTINCT FROM 'string'
      OR length(d->>'task_id') NOT BETWEEN 1 AND 64 OR length(d->>'term_id') NOT BETWEEN 1 AND 64
      OR (d ? 'proficiency' AND (jsonb_typeof(d->'proficiency') <> 'string' OR d->>'proficiency' NOT IN ('beginner','comfortable','experienced')))
      OR (d ? 'experience' AND (jsonb_typeof(d->'experience') <> 'string' OR d->>'experience' NOT IN ('none','some','regular')))
      OR NOT EXISTS (
        SELECT 1 FROM public.capability_task_terms l
        JOIN public.capability_tasks t ON (t.taxonomy_version,t.id) = (l.taxonomy_version,l.task_id)
        JOIN public.capability_terms s ON (s.taxonomy_version,s.id) = (l.taxonomy_version,l.term_id)
        WHERE l.taxonomy_version = v_version AND l.task_id = d->>'task_id' AND l.term_id = d->>'term_id' AND t.active AND s.active
      ) THEN RAISE EXCEPTION 'invalid_capability'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_declarations)) <>
     (SELECT count(DISTINCT (value->>'task_id',value->>'term_id')) FROM jsonb_array_elements(p_declarations))
  THEN RAISE EXCEPTION 'duplicate_capability'; END IF;
  DELETE FROM public.hunter_capabilities WHERE owner_id = auth.uid();
  INSERT INTO public.hunter_capabilities(owner_id,taxonomy_version,task_id,term_id,proficiency,experience)
    SELECT auth.uid(),v_version,value->>'task_id',value->>'term_id',value->>'proficiency',value->>'experience'
    FROM jsonb_array_elements(p_declarations);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_hunter_capabilities(), public.set_my_hunter_capabilities(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_hunter_capabilities(), public.set_my_hunter_capabilities(jsonb, integer) TO authenticated;

ALTER TABLE public.bounties ADD COLUMN requirements_payload jsonb,
  ADD COLUMN requirements_taxonomy_version integer REFERENCES public.capability_taxonomy_versions(version),
  ADD COLUMN requirements_revision bigint NOT NULL DEFAULT 0 CHECK (requirements_revision >= 0),
  ADD COLUMN requirements_confirmed_at timestamptz,
  ADD COLUMN requirements_provenance text CHECK (requirements_provenance = 'poster_declared');

CREATE FUNCTION public.validate_bounty_requirements() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p jsonb; d jsonb; v_version integer; v_changed boolean;
BEGIN
  p := NEW.requirements_payload;
  -- Canonicalize well-shaped arrays before comparing material changes.
  IF jsonb_typeof(p) = 'object' AND jsonb_typeof(p->'terms') = 'array' THEN
    p := jsonb_set(p,'{terms}',COALESCE(
      (SELECT jsonb_agg(value ORDER BY value->>'term_id') FROM jsonb_array_elements(p->'terms')),'[]'::jsonb));
    NEW.requirements_payload := p;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.requirements_taxonomy_version IS DISTINCT FROM OLD.requirements_taxonomy_version
      OR NEW.requirements_revision IS DISTINCT FROM OLD.requirements_revision
      OR NEW.requirements_confirmed_at IS DISTINCT FROM OLD.requirements_confirmed_at
      OR NEW.requirements_provenance IS DISTINCT FROM OLD.requirements_provenance
    THEN RAISE EXCEPTION 'requirements_metadata_server_controlled'; END IF;
    v_changed := p IS DISTINCT FROM OLD.requirements_payload OR
      (p IS NOT NULL AND NEW.category IS DISTINCT FROM OLD.category);
    IF NOT v_changed THEN RETURN NEW; END IF;
    IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM COALESCE(OLD.poster_id,OLD.user_id)
    THEN RAISE EXCEPTION 'requirements_owner_only'; END IF;
    -- UPDATE already holds this row lock; application insertion uses the same lock.
    IF OLD.accepted_by IS NOT NULL OR NEW.accepted_by IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.bounty_requests WHERE bounty_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.bounty_requirement_locks WHERE bounty_id = OLD.id)
    THEN RAISE EXCEPTION 'requirements_frozen_after_application'; END IF;
  ELSE
    IF NEW.requirements_taxonomy_version IS NOT NULL OR NEW.requirements_provenance IS NOT NULL
      OR NEW.requirements_revision <> 0 OR NEW.requirements_confirmed_at IS NOT NULL
    THEN RAISE EXCEPTION 'requirements_metadata_server_controlled'; END IF;
    IF p IS NOT NULL AND auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM COALESCE(NEW.poster_id,NEW.user_id)
    THEN RAISE EXCEPTION 'requirements_owner_only'; END IF;
  END IF;
  IF p IS NULL THEN
    NEW.requirements_taxonomy_version := NULL;
    NEW.requirements_provenance := NULL;
    IF TG_OP = 'UPDATE' THEN
      NEW.requirements_revision := OLD.requirements_revision + 1;
      NEW.requirements_confirmed_at := statement_timestamp();
    END IF;
    RETURN NEW;
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_requirements'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('taxonomy_version','task_id','terms'))
    OR jsonb_typeof(p->'taxonomy_version') IS DISTINCT FROM 'number'
    OR (p->>'taxonomy_version') !~ '^[1-9][0-9]{0,8}$'
    OR jsonb_typeof(p->'task_id') IS DISTINCT FROM 'string'
    OR length(p->>'task_id') NOT BETWEEN 1 AND 64
    OR jsonb_typeof(p->'terms') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'invalid_requirements'; END IF;
  IF jsonb_array_length(p->'terms') > 12 THEN RAISE EXCEPTION 'too_many_requirements'; END IF;
  SELECT version INTO STRICT v_version FROM public.capability_taxonomy_versions WHERE active AND scope = 'ordinary' FOR SHARE;
  IF (p->>'taxonomy_version')::integer <> v_version
  THEN RAISE EXCEPTION 'taxonomy_version_changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.capability_tasks WHERE taxonomy_version = v_version
    AND id = p->>'task_id' AND category = NEW.category AND active)
  THEN RAISE EXCEPTION 'invalid_requirement_task_category'; END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(p->'terms') LOOP
    IF jsonb_typeof(d) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_requirement_term'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('term_id','importance'))
      OR jsonb_typeof(d->'term_id') IS DISTINCT FROM 'string'
      OR length(d->>'term_id') NOT BETWEEN 1 AND 64
      OR jsonb_typeof(d->'importance') IS DISTINCT FROM 'string'
      OR d->>'importance' NOT IN ('required','preferred')
      OR NOT EXISTS (SELECT 1 FROM public.capability_task_terms l
        JOIN public.capability_terms s ON (s.taxonomy_version,s.id) = (l.taxonomy_version,l.term_id)
        WHERE l.taxonomy_version = v_version AND l.task_id = p->>'task_id'
          AND l.term_id = d->>'term_id' AND s.active)
    THEN RAISE EXCEPTION 'invalid_requirement_term'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p->'terms')) <>
     (SELECT count(DISTINCT value->>'term_id') FROM jsonb_array_elements(p->'terms'))
  THEN RAISE EXCEPTION 'duplicate_requirement'; END IF;
  -- Canonical order prevents reordering alone from becoming a material edit.
  NEW.requirements_payload := jsonb_build_object('taxonomy_version',v_version,'task_id',p->>'task_id','terms',
    COALESCE((SELECT jsonb_agg(value ORDER BY value->>'term_id') FROM jsonb_array_elements(p->'terms')),'[]'::jsonb));
  NEW.requirements_taxonomy_version := v_version;
  NEW.requirements_revision := CASE WHEN TG_OP = 'UPDATE' THEN OLD.requirements_revision + 1 ELSE 1 END;
  NEW.requirements_confirmed_at := statement_timestamp();
  NEW.requirements_provenance := 'poster_declared';
  RETURN NEW;
END;
$$;
CREATE TRIGGER a00_validate_bounty_requirements BEFORE INSERT OR UPDATE ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.validate_bounty_requirements();

CREATE FUNCTION public.project_bounty_requirements() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.accepted_by IS NOT NULL THEN
    INSERT INTO public.bounty_requirement_locks(bounty_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.requirements_payload IS NOT DISTINCT FROM OLD.requirements_payload THEN RETURN NEW; END IF;
  DELETE FROM public.bounty_requirements WHERE bounty_id = NEW.id;
  IF NEW.requirements_payload IS NOT NULL THEN
    INSERT INTO public.bounty_requirements(bounty_id,taxonomy_version,task_id,term_id,importance,requirements_revision,confirmed_at)
      SELECT NEW.id,NEW.requirements_taxonomy_version,NEW.requirements_payload->>'task_id',value->>'term_id',value->>'importance',
        NEW.requirements_revision,NEW.requirements_confirmed_at
      FROM jsonb_array_elements(NEW.requirements_payload->'terms');
  END IF;
  RETURN NEW;
END;
$$;
-- Row projection is visible to subsequent AFTER notification triggers in this transaction.
CREATE TRIGGER a00_project_bounty_requirements AFTER INSERT OR UPDATE ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.project_bounty_requirements();

CREATE FUNCTION public.lock_bounty_requirements_for_application() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.bounties WHERE id = NEW.bounty_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bounty_not_found'; END IF;
  INSERT INTO public.bounty_requirement_locks(bounty_id) VALUES (NEW.bounty_id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER a00_lock_bounty_requirements BEFORE INSERT OR UPDATE OF bounty_id ON public.bounty_requests
  FOR EACH ROW EXECUTE FUNCTION public.lock_bounty_requirements_for_application();
INSERT INTO public.bounty_requirement_locks(bounty_id)
  SELECT DISTINCT bounty_id FROM public.bounty_requests
  UNION SELECT id FROM public.bounties WHERE accepted_by IS NOT NULL
  ON CONFLICT DO NOTHING;
REVOKE ALL ON FUNCTION public.validate_bounty_requirements(),public.project_bounty_requirements(),
  public.lock_bounty_requirements_for_application() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
