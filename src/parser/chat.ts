import type { JsonObject } from '@loom-studio/shared'

export type SillyTavernChatMessage = {
  name?: string
  is_user?: boolean
  is_system?: boolean
  mes?: string
  send_date?: string | number
}

export type SillyTavernChatConversion = {
  title: string
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    createdAt?: string
  }>
  metadata?: JsonObject
}

export function convertSillyTavernChat(source: string | Uint8Array, fallbackTitle = 'SillyTavern Chat'): SillyTavernChatConversion {
  const text = typeof source === 'string' ? source : Buffer.from(source).toString('utf8')
  const lines = text.split(/\r?\n/).filter(line => line.trim())
  if (lines.length === 0) throw new Error('SillyTavern chat is empty')

  let title = fallbackTitle
  let metadata: JsonObject | undefined
  const messages: SillyTavernChatConversion['messages'] = []

  for (const [index, line] of lines.entries()) {
    const value = JSON.parse(line) as Record<string, unknown>
    if (index === 0 && value.chat_metadata && typeof value.chat_metadata === 'object') {
      metadata = value.chat_metadata as JsonObject
      const chatId = metadata.chat_id
      if (typeof chatId === 'string' && chatId.trim()) title = chatId.trim()
      continue
    }
    if (value.is_system === true || typeof value.mes !== 'string') continue
    const createdAt = toIsoDate(value.send_date)
    messages.push({
      role: value.is_user === true ? 'user' : 'assistant',
      content: value.mes,
      ...(createdAt ? { createdAt } : {}),
    })
  }

  return { title, messages, ...(metadata ? { metadata } : {}) }
}

function toIsoDate(value: unknown): string | undefined {
  if (typeof value === 'number') {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value
    const date = new Date(milliseconds)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  return undefined
}
