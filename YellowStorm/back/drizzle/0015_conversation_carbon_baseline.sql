UPDATE "conversation"."conversation_usage_events"
SET
  "carbon_grams_co2e" = ("total_tokens"::double precision / 1000) * 0.15,
  "carbon_methodology" = 'tokens-factor-v1',
  "carbon_factor_version" = 'baseline-2026-09'
WHERE "carbon_grams_co2e" IS NULL;
