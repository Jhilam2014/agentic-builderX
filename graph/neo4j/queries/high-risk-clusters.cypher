MATCH (c:Cluster) WHERE c.risk_level IN ['high', 'critical'] RETURN c;
