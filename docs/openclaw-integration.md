# OpenClaw integration

This integration separates the commercial agent from the Dropi browser worker.
The commercial agent can propose replies, request bounded CRM stage changes, or
request a human handoff. The logistics worker can only lease capability-scoped
jobs and return structured results. Neither component receives direct database
credentials.

## Setup

1. Apply migrations `037_crm_stage_history.sql` and
   `038_openclaw_integration.sql`.
2. Configure `OPENCLAW_COMMERCIAL_WEBHOOK_URL`,
   `OPENCLAW_COMMERCIAL_SECRET`, and `OPENCLAW_WORKER_SECRET`.
3. As an account admin, register the Dropi worker:

```http
POST /api/integration-workers
Content-Type: application/json

{
  "worker_key": "dropi-production-01",
  "name": "Dropi production browser",
  "capabilities": [
    "CREATE_DROPI_ORDER",
    "VERIFY_DROPI_ORDER",
    "SYNC_DROPI_ORDER_STATUS",
    "FETCH_DROPI_TRACKING"
  ]
}
```

4. Configure OpenClaw with a dedicated `dropi-production` browser profile.
Do not use a personal browser profile or expose its control port publicly.
5. Log into Dropi manually in that profile. CAPTCHA and MFA remain manual.

## Commercial webhook

WACRM signs the raw request body with `X-Wacrm-Signature` using the existing
`t=<timestamp>,v1=<hmac>` scheme. OpenClaw must sign its raw JSON response with
the same scheme. Unsigned or stale responses are discarded.

The response contract includes `reply`, `intent`, `extracted_data`,
`missing_fields`, `requested_actions`, `confidence`, and
`requires_human_review`. The CRM validates stage transitions. Explicit order
confirmation requires `intent=ORDER_CONFIRMED` and confidence of at least 0.95.

## Flow designer

Admins can submit an objective and up to 25 owned conversation ids to
`POST /api/integrations/openclaw/flow-proposals`. The separate designer webhook
returns nodes and edges which are stored in `agent_flow_proposals` as `draft`.
There is intentionally no activation endpoint: a draft must be reviewed and
manually recreated/imported into the existing Flows editor before activation.

## Logistics worker signing

Every worker request includes:

```text
X-WACRM-Worker-Id
X-WACRM-Timestamp
X-WACRM-Nonce
X-WACRM-Signature
```

The canonical input is:

```text
timestamp + "\n" + nonce + "\n" + method + "\n" + path + "\n" + sha256(raw_body)
```

Sign it using HMAC-SHA256 and `OPENCLAW_WORKER_SECRET`. Nonces are one-time and
timestamps have a five-minute tolerance.

## Worker loop

1. `POST /api/integrations/openclaw/jobs/lease`
2. `POST /api/integrations/openclaw/jobs/:id/heartbeat`
3. Search Dropi for a duplicate before filling the form.
4. `POST /api/integrations/openclaw/jobs/:id/progress` with `running` or
   `awaiting_approval`.
5. Poll `GET /api/integrations/openclaw/jobs/:id/progress` while approval is
   pending.
6. `POST /api/integrations/openclaw/jobs/:id/result` with the final structured
   result.

The worker must never retry a create operation after an uncertain timeout until
it has searched Dropi for the internal order reference, phone, and amount.

## Creating a Dropi job

Once the commercial agent has populated the required `agent_extracted_data` and
the deal is in `Confirmado por cliente`, an authenticated agent calls:

```http
POST /api/integrations/dropi/orders

{
  "deal_id": "<uuid>",
  "customer_confirmed": true,
  "requires_human_approval": true
}
```

Required extracted fields are `customer_name`, `phone_e164`, `department`,
`city`, `address`, `product_reference`, `quantity`, and `cod_amount`.
