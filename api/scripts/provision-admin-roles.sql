\set ON_ERROR_STOP on
\if :{?admin_app_password}
\else
  \echo 'Missing psql variable admin_app_password'
  \quit 3
\endif

SELECT :'admin_app_password' <> '' AS password_valid
\gset
\if :password_valid
\else
  \echo 'admin_app_password must be nonempty'
  \quit 3
\endif

-- Run after provision-roles.sql as the cluster administrator, connected to
-- the target database. Existing roles and their passwords are never changed.
BEGIN;
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clintra_admin_app') AS admin_app_new
\gset

SELECT format('CREATE ROLE %I %s', role_name, attributes)
FROM (VALUES
    ('clintra_admin_app', 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT'),
    ('clintra_admin_auth', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT'),
    ('clintra_admin_provision', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT'),
    ('clintra_admin_mint', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT'),
    ('clintra_admin_device', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS INHERIT'),
    ('clintra_admin_org', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS INHERIT'),
    ('clintra_admin_stats', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS INHERIT'),
    ('clintra_admin_support', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS INHERIT'),
    ('clintra_support', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS INHERIT')
) AS expected(role_name, attributes)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name)
\gexec

\if :admin_app_new
SELECT format('ALTER ROLE clintra_admin_app PASSWORD %L', :'admin_app_password')
\gexec
ALTER ROLE clintra_admin_app SET log_parameter_max_length = 0;
ALTER ROLE clintra_admin_app SET log_parameter_max_length_on_error = 0;
\endif

SELECT format('GRANT CONNECT ON DATABASE %I TO clintra_admin_app', current_database())
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database d,
        LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
    WHERE d.datname = current_database()
      AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'clintra_admin_app')
      AND a.privilege_type = 'CONNECT'
)
\gexec
COMMIT;
