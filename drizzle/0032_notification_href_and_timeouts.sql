ALTER TABLE "notifications" DROP CONSTRAINT "notifications_href_check";--> statement-breakpoint
-- Any older link the stricter check refuses opens the home screen instead of failing the deploy.
UPDATE "notifications" SET "href" = '/' WHERE "href" !~ '^/([^/\\]|$)';--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_href_check" CHECK ("notifications"."href" ~ '^/([^/\\]|$)');--> statement-breakpoint
-- Stop a runaway query or a transaction left open after a crash from holding a
-- connection and its locks for ever. Set on the role (not per connection) so it
-- also holds through Neon's pooler, which doesn't keep per-session settings.
-- The migrate script turns statement_timeout off for its own session.
ALTER ROLE CURRENT_USER SET statement_timeout = '60s';--> statement-breakpoint
ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '60s';
