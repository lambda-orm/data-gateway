-- One schema per service, owned by its own role (DDL), plus a DML-only role
-- (<schema>_rw) for the service's default stage. Nobody else creates in public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['catalog', 'accounts', 'site'] LOOP
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', s, s);
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', s || '_rw', s || '_rw');
    EXECUTE format('CREATE SCHEMA %I AUTHORIZATION %I', s, s);
    EXECUTE format('ALTER ROLE %I IN DATABASE ilusor SET search_path = %I', s, s);
    EXECUTE format('ALTER ROLE %I IN DATABASE ilusor SET search_path = %I', s || '_rw', s);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', s, s || '_rw');
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', s, s, s || '_rw');
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I', s, s, s || '_rw');
  END LOOP;
END $$;
