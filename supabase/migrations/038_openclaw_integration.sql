-- OpenClaw integration: durable jobs, audit events, replay protection,
-- and structured commercial-agent actions.

CREATE TYPE integration_job_status AS ENUM (
  'pending', 'leased', 'running', 'awaiting_approval', 'succeeded',
  'retryable_error', 'permanent_error', 'cancelled'
);

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS agent_extracted_data JSONB NOT NULL DEFAULT '{}';

CREATE TABLE integration_workers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  worker_key TEXT NOT NULL,
  name TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, worker_key)
);

CREATE TABLE integration_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN (
    'CREATE_DROPI_ORDER', 'VERIFY_DROPI_ORDER', 'SYNC_DROPI_ORDER_STATUS',
    'FETCH_DROPI_TRACKING', 'RECONCILE_DROPI_ORDERS'
  )),
  status integration_job_status NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL,
  result JSONB,
  idempotency_key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  priority INTEGER NOT NULL DEFAULT 100,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  leased_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  leased_by UUID REFERENCES integration_workers(id) ON DELETE SET NULL,
  last_heartbeat_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, idempotency_key)
);

CREATE INDEX idx_integration_jobs_queue
  ON integration_jobs(status, available_at, priority, created_at);
CREATE INDEX idx_integration_jobs_deal ON integration_jobs(deal_id, created_at DESC);

CREATE TABLE integration_job_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES integration_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  previous_status integration_job_status,
  new_status integration_job_status,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'worker', 'system')),
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_job_events_job
  ON integration_job_events(job_id, created_at DESC);

CREATE TABLE integration_nonces (
  nonce TEXT PRIMARY KEY,
  worker_key TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_integration_nonces_expiry ON integration_nonces(expires_at);

CREATE TABLE agent_action_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  agent_kind TEXT NOT NULL CHECK (agent_kind IN ('commercial', 'logistics', 'flow_designer')),
  action_type TEXT NOT NULL,
  requested_payload JSONB NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'human_review')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_flow_proposals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requested_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  proposal JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'reviewed', 'rejected', 'archived')),
  source_conversation_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE integration_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_action_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_flow_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_workers_select ON integration_workers FOR SELECT
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY integration_workers_insert ON integration_workers FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY integration_workers_update ON integration_workers FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY integration_jobs_select ON integration_jobs FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY integration_jobs_insert ON integration_jobs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY integration_jobs_update ON integration_jobs FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY integration_job_events_select ON integration_job_events FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY integration_job_events_insert ON integration_job_events FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY agent_action_log_select ON agent_action_log FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY agent_flow_proposals_select ON agent_flow_proposals FOR SELECT
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY agent_flow_proposals_insert ON agent_flow_proposals FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY agent_flow_proposals_update ON agent_flow_proposals FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON integration_jobs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON integration_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON agent_flow_proposals;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent_flow_proposals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION lease_next_integration_job(
  p_worker_id UUID,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS SETOF integration_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker integration_workers%ROWTYPE;
  v_job integration_jobs%ROWTYPE;
  v_previous_status integration_job_status;
BEGIN
  SELECT * INTO v_worker FROM integration_workers
  WHERE id = p_worker_id AND is_active = TRUE;
  IF NOT FOUND THEN RETURN; END IF;
  v_previous_status := v_job.status;

  SELECT * INTO v_job FROM integration_jobs
  WHERE account_id = v_worker.account_id
    AND job_type = ANY(v_worker.capabilities)
    AND available_at <= NOW()
    AND (
      status = 'pending'
      OR (status IN ('leased', 'running') AND lease_expires_at < NOW())
      OR (status = 'retryable_error' AND attempt_count < max_attempts)
    )
  ORDER BY priority ASC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE integration_jobs SET
    status = 'leased', leased_by = v_worker.id, leased_at = NOW(),
    lease_expires_at = NOW() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 30), 900)),
    last_heartbeat_at = NOW(), attempt_count = attempt_count + 1,
    error_code = NULL, error_message = NULL
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  UPDATE integration_workers SET last_seen_at = NOW() WHERE id = v_worker.id;
  INSERT INTO integration_job_events (
    account_id, job_id, event_type, previous_status, new_status,
    actor_type, actor_id
  ) VALUES (
    v_job.account_id, v_job.id, 'leased', v_previous_status, 'leased',
    'worker', v_worker.worker_key
  );
  RETURN NEXT v_job;
END;
$$;

REVOKE ALL ON FUNCTION lease_next_integration_job(UUID, INTEGER) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION lease_next_integration_job(UUID, INTEGER) TO service_role;
