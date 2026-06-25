CREATE INDEX cluster_risk IF NOT EXISTS FOR (n:Cluster) ON (n.risk_level);
CREATE INDEX service_status IF NOT EXISTS FOR (n:Service) ON (n.status);
