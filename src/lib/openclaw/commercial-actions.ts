import type { SupabaseClient } from '@supabase/supabase-js'
import type { CommercialAgentResponse, CommercialStageCode } from './types'

const STAGE_NAMES: Record<Exclude<CommercialStageCode, 'HUMAN_REVIEW'>, string> = {
  NEW_LEAD: 'Lead nuevo',
  IN_CONVERSATION: 'En conversación',
  MISSING_DATA: 'Datos incompletos',
  ADDRESS_VALIDATION: 'Validación de dirección',
  WAITING_CONFIRMATION: 'Esperando confirmación',
  CUSTOMER_CONFIRMED: 'Confirmado por cliente',
}

const ALLOWED: Record<string, CommercialStageCode[]> = {
  'Lead nuevo': ['IN_CONVERSATION', 'MISSING_DATA', 'HUMAN_REVIEW'],
  'En conversación': ['MISSING_DATA', 'ADDRESS_VALIDATION', 'HUMAN_REVIEW'],
  'Datos incompletos': ['IN_CONVERSATION', 'ADDRESS_VALIDATION', 'HUMAN_REVIEW'],
  'Validación de dirección': ['MISSING_DATA', 'WAITING_CONFIRMATION', 'HUMAN_REVIEW'],
  'Esperando confirmación': ['MISSING_DATA', 'CUSTOMER_CONFIRMED', 'HUMAN_REVIEW'],
}

export async function applyCommercialActions(args: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  response: CommercialAgentResponse
}): Promise<{ handoff: boolean }> {
  const { db, accountId, conversationId, response } = args
  const { data: deal } = await db
    .from('deals')
    .select('id, stage_id, agent_extracted_data, stage:pipeline_stages(name, pipeline_id)')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (deal && Object.keys(response.extracted_data).length > 0) {
    await db.from('deals').update({
      agent_extracted_data: {
        ...((deal.agent_extracted_data ?? {}) as Record<string, unknown>),
        ...response.extracted_data,
      },
    }).eq('id', deal.id)
  }

  let handoff = response.requires_human_review
  for (const action of response.requested_actions) {
    if (action.type === 'REQUEST_HUMAN_HANDOFF' || action.target === 'HUMAN_REVIEW') {
      handoff = true
      await logAction(db, accountId, conversationId, deal?.id ?? null, action, 'human_review', action.reason)
      continue
    }
    const stageRelation = deal?.stage as unknown as { name: string; pipeline_id: string } | null
    const currentName = stageRelation?.name
    const targetName = STAGE_NAMES[action.target]
    const permitted = Boolean(
      deal && currentName && targetName && ALLOWED[currentName]?.includes(action.target),
    )
    const confirmedSafely =
      action.target !== 'CUSTOMER_CONFIRMED' ||
      (response.intent === 'ORDER_CONFIRMED' && response.confidence >= 0.95)
    if (!permitted || !confirmedSafely) {
      await logAction(
        db, accountId, conversationId, deal?.id ?? null, action, 'rejected',
        !permitted ? 'Transition is not permitted' : 'Explicit confirmation threshold not met',
      )
      continue
    }
    if (!deal || !stageRelation || !targetName) continue
    const dealId = deal.id
    const { data: targetStage } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', stageRelation!.pipeline_id)
      .eq('name', targetName)
      .maybeSingle()
    if (!targetStage) {
      await logAction(db, accountId, conversationId, dealId, action, 'rejected', 'Target stage not found')
      continue
    }
    const { error } = await db.from('deals').update({ stage_id: targetStage.id }).eq('id', dealId)
    await logAction(
      db, accountId, conversationId, dealId, action,
      error ? 'rejected' : 'approved', error?.message,
    )
  }
  return { handoff }
}

async function logAction(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  dealId: string | null,
  payload: unknown,
  decision: 'approved' | 'rejected' | 'human_review',
  reason?: string,
) {
  await db.from('agent_action_log').insert({
    account_id: accountId,
    conversation_id: conversationId,
    deal_id: dealId,
    agent_kind: 'commercial',
    action_type: (payload as { type?: string }).type ?? 'UNKNOWN',
    requested_payload: payload,
    decision,
    reason: reason ?? null,
  })
}
