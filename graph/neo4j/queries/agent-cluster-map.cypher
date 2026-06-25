MATCH (a:Agent)-[r:OWNS]->(c:Cluster) RETURN a, r, c;
