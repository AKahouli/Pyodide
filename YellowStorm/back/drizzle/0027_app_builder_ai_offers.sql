-- P8 app-builder-ai: offers catalog + user assignment columns (Mongo cutover).
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS catalog.app_builder_ai_offers (
  id                      char(24)     PRIMARY KEY,
  name                    varchar(100) NOT NULL,
  slug                    varchar(50)  NOT NULL CHECK (slug = lower(btrim(slug))),
  description             varchar(500),
  token_limit             bigint       NOT NULL DEFAULT 0,
  window_hours            integer      NOT NULL DEFAULT 24 CHECK (window_hours >= 1),
  requests_per_minute     integer      NOT NULL DEFAULT 60,
  max_tokens_per_request  bigint       NOT NULL DEFAULT -1,
  priority                integer      NOT NULL DEFAULT 0,
  is_active               boolean      NOT NULL DEFAULT true,
  is_default              boolean      NOT NULL DEFAULT false,
  display_order           integer      NOT NULL DEFAULT 0,
  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ab_ai_offers_name ON catalog.app_builder_ai_offers (name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ab_ai_offers_slug ON catalog.app_builder_ai_offers (slug);
CREATE INDEX IF NOT EXISTS idx_ab_ai_offers_active_order
  ON catalog.app_builder_ai_offers (is_active, display_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ab_ai_offers_single_default
  ON catalog.app_builder_ai_offers (is_default) WHERE is_default;

ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS app_builder_ai_offer_id char(24),
  ADD COLUMN IF NOT EXISTS app_builder_ai_offer_started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_app_builder_ai_offer
  ON identity.users (app_builder_ai_offer_id)
  WHERE app_builder_ai_offer_id IS NOT NULL;
