SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS conversation.root_model_slots (
  id integer PRIMARY KEY CHECK (id BETWEEN 1 AND 30),
  owner uuid,
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  status varchar(32) NOT NULL DEFAULT 'free'
    CHECK (status IN ('free', 'reserved', 'running', 'outcome_unknown')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'free' AND owner IS NULL) OR (status <> 'free' AND owner IS NOT NULL))
);

INSERT INTO conversation.root_model_slots (id)
SELECT generate_series(1, 30) ON CONFLICT DO NOTHING;
