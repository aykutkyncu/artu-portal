import type { Conversation, User } from './types'

export function conversationPeer(c: Conversation, meId: string, usersById: Map<string, User>): User | undefined {
  if (c.type === 'group') return undefined
  const other = c.members.find((m) => m !== meId)
  return other ? usersById.get(other) : undefined
}

export function conversationTitle(c: Conversation, meId: string, usersById: Map<string, User>): string {
  if (c.type === 'group') return c.name
  return conversationPeer(c, meId, usersById)?.name ?? 'Eski kullanıcı'
}
