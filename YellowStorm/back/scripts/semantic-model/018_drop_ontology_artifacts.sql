-- 018 - Drop the ontology artifacts table.
-- Ontology generation (POST :id/ontology/generate) was the only writer and
-- model cloning the only other reader; both are gone. The semantic runtime
-- works from the population specification instead.
DROP TABLE IF EXISTS semantic_model.ontology_artifacts;
