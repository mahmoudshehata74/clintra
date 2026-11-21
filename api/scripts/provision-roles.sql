\set ON_ERROR_STOP on
\if :{?owner_password}
\else
  \echo 'Missing psql variable owner_password'
  \quit 3
\endif
\if :{?app_password}
\else
  \echo 'Missing psql variable app_password'
  \quit 3
\endif

SELECT :'owner_password' <> '' AND :'app_password' <> ''
    AND :'owner_password' <> :'app_password' AS passwords_valid
\gset
\if :passwords_valid
\else
  \echo 'Passwords must be nonempty and different'
  \quit 3
\endif

-- Run as the cluster administrator connected to the production database.
-- Supply passwords through psql variables from the release secret store.
BEGIN;
SELECT format('CREATE ROLE %I', role_name)
FROM (VALUES
    ('clintra_owner'), ('clintra_app'), ('clintra_rls'),
    ('clintra_provision'), ('clintra_mint'), ('clintra_register'),
    ('clintra_staff'), ('clintra_auth')
) AS expected(role_name)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name)
\gexec

ALTER ROLE clintra_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE clintra_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
SELECT format('ALTER ROLE clintra_owner PASSWORD %L', :'owner_password')
\gexec
SELECT format('ALTER ROLE clintra_app PASSWORD %L', :'app_password')
\gexec

SELECT format('ALTER ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS', role_name)
FROM (VALUES ('clintra_rls'), ('clintra_provision'), ('clintra_mint'),
             ('clintra_register'), ('clintra_staff'), ('clintra_auth')) AS expected(role_name)
\gexec

GRANT clintra_rls, clintra_provision, clintra_mint, clintra_register, clintra_staff, clintra_auth TO clintra_owner;
SELECT format('ALTER DATABASE %I OWNER TO clintra_owner', current_database())
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO clintra_owner, clintra_app', current_database())
\gexec
ALTER SCHEMA public OWNER TO clintra_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, clintra_app;
GRANT USAGE ON SCHEMA public TO clintra_app;
GRANT USAGE, CREATE ON SCHEMA public TO clintra_rls, clintra_provision,
    clintra_mint, clintra_register, clintra_staff, clintra_auth;
COMMIT;
