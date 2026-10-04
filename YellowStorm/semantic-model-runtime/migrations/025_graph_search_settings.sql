-- Graph search settings: the index settings a generation was built with (card and
-- passage sizes, per-field overrides), as NestJS sent them. The generation's
-- fingerprint names them, its job builds exactly them, and a new data revision's
-- index (requested after a population run, with no request at hand) reuses the
-- settings the model's latest generation was built with. NULL: the defaults.
ALTER TABLE semantic_graph_search.index_generations
  ADD COLUMN IF NOT EXISTS index_settings JSONB
    CHECK (index_settings IS NULL OR jsonb_typeof(index_settings) = 'object');
