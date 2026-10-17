-- 006: Microsoft sign-in was removed, so Google is the only sign-in provider.
-- (Migration 001 allowed 'google' and 'microsoft'. Old migrations are never
-- edited after they've run, so the rule is changed here instead.)
ALTER TABLE oauth_accounts DROP CONSTRAINT oauth_accounts_provider_check;
ALTER TABLE oauth_accounts ADD CONSTRAINT oauth_accounts_provider_check CHECK (provider = 'google');
