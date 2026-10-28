-- Runs once when the local Docker database is first created.
-- Integration tests use this separate database and wipe it on every run.
CREATE DATABASE qtech_test OWNER qtech;
