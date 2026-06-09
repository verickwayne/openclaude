export type TeamMessage = {
  from: string
  to?: string // omitted = broadcast
  body: string
  ts?: number
}

type Handler = (m: TeamMessage) => void

/** In-process pub/sub mailbox for one team. No persistence, no network. */
export class TeamMessageBus {
  private handlers = new Map<string, Handler[]>()
  constructor(public readonly teamId: string) {}

  subscribe(agentId: string, handler: Handler): () => void {
    const list = this.handlers.get(agentId) ?? []
    list.push(handler)
    this.handlers.set(agentId, list)
    return () => {
      this.handlers.set(agentId, (this.handlers.get(agentId) ?? []).filter(h => h !== handler))
    }
  }

  send(message: TeamMessage): void {
    if (!message.to) return this.broadcast(message)
    for (const h of this.handlers.get(message.to) ?? []) h(message)
  }

  broadcast(message: TeamMessage): void {
    for (const [agentId, handlers] of this.handlers) {
      if (agentId === message.from) continue
      for (const h of handlers) h(message)
    }
  }
}
