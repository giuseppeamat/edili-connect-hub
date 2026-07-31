DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS t
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', r.t);
  END LOOP;
END $$;