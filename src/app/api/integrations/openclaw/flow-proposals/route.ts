import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { requestFlowProposal } from '@/lib/openclaw/flow-designer'

function redactSample(text: string) {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[PHONE]')
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { data, error } = await supabase.from('agent_flow_proposals')
      .select('*').eq('account_id', accountId).order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ proposals: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null) as {
      objective?: string
      conversation_ids?: string[]
    } | null
    const objective = body?.objective?.trim() ?? ''
    const conversationIds = [...new Set(body?.conversation_ids ?? [])].slice(0, 25)
    if (objective.length < 10 || objective.length > 1000) {
      return NextResponse.json({ error: 'objective must contain 10-1000 characters' }, { status: 400 })
    }
    let samples: Array<{ conversation_id: string; messages: string[] }> = []
    if (conversationIds.length > 0) {
      const { data: conversations } = await supabase.from('conversations')
        .select('id').eq('account_id', accountId).in('id', conversationIds)
      const allowedIds = (conversations ?? []).map((item) => item.id)
      const { data: messages } = allowedIds.length
        ? await supabase.from('messages').select('conversation_id, content_text, created_at')
          .in('conversation_id', allowedIds).eq('content_type', 'text')
          .order('created_at', { ascending: false }).limit(250)
        : { data: [] }
      samples = allowedIds.map((id) => ({
        conversation_id: id,
        messages: (messages ?? []).filter((item) => item.conversation_id === id)
          .slice(0, 10).map((item) => redactSample(item.content_text ?? '')).filter(Boolean).reverse(),
      }))
    }
    const proposal = await requestFlowProposal({
      schema_version: '1.0',
      objective,
      constraints: {
        output_status: 'draft',
        may_publish: false,
        allowed_action_types: [
          'send_message', 'send_buttons', 'send_list', 'add_tag', 'assign_conversation',
          'update_contact_field', 'create_deal', 'wait', 'condition', 'close_conversation',
        ],
      },
      anonymized_samples: samples,
    })
    const { data, error } = await supabase.from('agent_flow_proposals').insert({
      account_id: accountId,
      requested_by_user_id: userId,
      name: proposal.name,
      objective,
      proposal,
      source_conversation_ids: conversationIds,
    }).select('*').single()
    if (error) throw error
    return NextResponse.json({ proposal: data }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('OpenClaw')) {
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    return toErrorResponse(error)
  }
}
