CREATE TABLE probe_owners (
  id integer primary key
);

CREATE TABLE probe_jobs (
  id integer primary key,
  owner_id integer REFERENCES probe_owners(id)
);

CREATE TABLE probe_audit (
  id integer primary key,
  job_id integer REFERENCES probe_jobs(id)
);

CREATE VIEW probe_job_summary AS
  SELECT probe_jobs.id, probe_owners.id AS owner_id
  FROM probe_jobs
  JOIN probe_owners ON probe_owners.id = probe_jobs.owner_id;

CREATE FUNCTION probe_touch_jobs() RETURNS void AS $$
BEGIN
  UPDATE probe_jobs SET id = id;
  INSERT INTO probe_audit(id) VALUES (1);
END;
$$ LANGUAGE plpgsql;
