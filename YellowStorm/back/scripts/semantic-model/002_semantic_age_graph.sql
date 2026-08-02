LOAD 'age';
SET search_path = ag_catalog, "$user", public;

SELECT ag_catalog.create_graph('__SEMANTIC_AGE_GRAPH__')
WHERE NOT EXISTS (
  SELECT 1 FROM ag_catalog.ag_graph WHERE name = '__SEMANTIC_AGE_GRAPH__'
);

SELECT * FROM ag_catalog.cypher('__SEMANTIC_AGE_GRAPH__', $$
  CREATE (n:SemanticNodeType {bootstrap: true}) RETURN n
$$) AS (created ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('__SEMANTIC_AGE_GRAPH__', $$
  MATCH (n:SemanticNodeType {bootstrap: true}) DELETE n RETURN 1
$$) AS (deleted ag_catalog.agtype);
