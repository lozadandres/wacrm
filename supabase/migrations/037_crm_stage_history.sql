-- CRM Etapa 1: stage timers and immutable movement history.
-- The trigger makes history complete regardless of whether a move comes
-- from the Kanban, an automation, a webhook, or a future OpenClaw worker.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS deal_stage_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
  changed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entered_at TIMESTAMPTZ NOT NULL,
  exited_at TIMESTAMPTZ,
  duration_seconds BIGINT,
  source TEXT NOT NULL DEFAULT 'kanban'
    CHECK (source IN ('kanban', 'automation', 'webhook', 'openclaw', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_stage_history_deal
  ON deal_stage_history(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_stage_entered_at
  ON deals(stage_id, stage_entered_at);

ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Account members can read deal stage history" ON deal_stage_history;
CREATE POLICY "Account members can read deal stage history"
  ON deal_stage_history FOR SELECT
  USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION stamp_deal_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.stage_entered_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION record_deal_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_entered_at TIMESTAMPTZ;
BEGIN
  SELECT account_id INTO v_account_id FROM pipelines WHERE id = NEW.pipeline_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO deal_stage_history (
      account_id, deal_id, to_stage_id, changed_by_user_id, entered_at, source
    ) VALUES (
      v_account_id, NEW.id, NEW.stage_id, auth.uid(), NEW.stage_entered_at, 'system'
    );
  ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    v_entered_at := COALESCE(OLD.stage_entered_at, OLD.created_at, NOW());
    INSERT INTO deal_stage_history (
      account_id, deal_id, from_stage_id, to_stage_id,
      changed_by_user_id, entered_at, exited_at, duration_seconds, source
    ) VALUES (
      v_account_id, NEW.id, OLD.stage_id, NEW.stage_id,
      auth.uid(), v_entered_at, NOW(),
      GREATEST(0, EXTRACT(EPOCH FROM (NOW() - v_entered_at))::BIGINT),
      COALESCE(current_setting('app.change_source', true), 'kanban')
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_deal_stage_change ON deals;
CREATE TRIGGER trg_stamp_deal_stage_change
  BEFORE UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION stamp_deal_stage_change();

DROP TRIGGER IF EXISTS trg_record_deal_stage_change ON deals;
CREATE TRIGGER trg_record_deal_stage_change
  AFTER INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION record_deal_stage_change();

-- Backfill the current stage as the initial known history record.
INSERT INTO deal_stage_history (
  account_id, deal_id, to_stage_id, entered_at, source
)
SELECT p.account_id, d.id, d.stage_id, d.stage_entered_at, 'system'
FROM deals d
JOIN pipelines p ON p.id = d.pipeline_id
WHERE NOT EXISTS (
  SELECT 1 FROM deal_stage_history h WHERE h.deal_id = d.id
);
