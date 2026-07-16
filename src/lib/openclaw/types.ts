export type CommercialStageCode =
  | 'NEW_LEAD'
  | 'IN_CONVERSATION'
  | 'MISSING_DATA'
  | 'ADDRESS_VALIDATION'
  | 'WAITING_CONFIRMATION'
  | 'CUSTOMER_CONFIRMED'
  | 'HUMAN_REVIEW'

export interface CommercialAgentRequest {
  schema_version: '1.0'
  account_id: string
  conversation_id: string
  contact_id: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  current_stage: string | null
  allowed_actions: ['REQUEST_STAGE_CHANGE', 'REQUEST_HUMAN_HANDOFF']
}

export interface CommercialAgentResponse {
  schema_version: '1.0'
  reply: { text: string; message_type: 'free_form' }
  intent: string
  extracted_data: Record<string, unknown>
  missing_fields: string[]
  requested_actions: Array<
    | { type: 'REQUEST_STAGE_CHANGE'; target: CommercialStageCode; reason?: string }
    | { type: 'REQUEST_HUMAN_HANDOFF'; reason: string }
  >
  confidence: number
  requires_human_review: boolean
}

export type IntegrationJobStatus =
  | 'pending'
  | 'leased'
  | 'running'
  | 'awaiting_approval'
  | 'succeeded'
  | 'retryable_error'
  | 'permanent_error'
  | 'cancelled'

export interface WorkerResult {
  schema_version: '1.0'
  job_id: string
  status: 'succeeded' | 'failure'
  outcome?: 'created' | 'existing_order' | 'tracking_updated'
  dropi?: {
    order_reference: string
    status: string
    tracking_number?: string | null
    carrier?: string | null
  }
  verification?: {
    customer_phone_matched: boolean
    address_matched: boolean
    items_matched: boolean
    cod_amount_matched: boolean
  }
  error_code?: string
  message?: string
  retryable?: boolean
  human_action_required?: boolean
  observed_at: string
}
