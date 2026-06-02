CREATE TABLE IF NOT EXISTS probe_owners (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS probe_jobs (
    id UUID PRIMARY KEY,
    owner_id UUID REFERENCES probe_owners(id),
    status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS probe_audit (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID REFERENCES probe_jobs(id)
);

CREATE OR REPLACE VIEW probe_job_summary AS
SELECT probe_jobs.id, probe_owners.name
FROM probe_jobs
JOIN probe_owners ON probe_owners.id = probe_jobs.owner_id;

CREATE OR REPLACE FUNCTION probe_touch_jobs()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE probe_jobs SET status = status;
    INSERT INTO probe_audit(job_id)
    SELECT id FROM probe_jobs;
END;
$$;
