import type { PushRelayConfig } from '@shared/types'

/**
 * Push relay for notifications that have no calendar equivalent — streak nudges,
 * "your weekly review is ready", challenge alerts.
 *
 * A calendar event can only say "this starts soon". Everything the app decides for
 * itself needs another channel, and a relay topic is the lightest one that reaches a
 * phone without a backend, an app-store build, or a push certificate.
 *
 * Defaults to ntfy.sh, which is free and self-hostable; the same POST shape works
 * against a private instance. Pushover and Telegram are drop-in alternatives if the
 * user prefers — only `send` would change.
 *
 * The topic is effectively a shared secret: anyone who knows it can post to it, and on
 * the public server anyone who guesses it can read it. The UI says so, and suggests a
 * long random topic.
 */
export interface PushMessage {
  title: string
  body: string
  /** 1 (min) … 5 (max). Reminders sit at 4, ambient nudges at 3. */
  priority?: number
  tags?: string[]
}

export function pushRelay(deps: { config: () => PushRelayConfig; log?: (m: string) => void }) {
  return {
    configured(): boolean {
      const c = deps.config()
      return c.enabled && c.topic.trim().length > 0 && /^https?:\/\//.test(c.server)
    },

    async send(message: PushMessage): Promise<boolean> {
      const c = deps.config()
      if (!this.configured()) return false

      const url = `${c.server.replace(/\/+$/, '')}/${encodeURIComponent(c.topic.trim())}`
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            // ntfy takes metadata as headers; the body is the message text.
            Title: message.title,
            Priority: String(message.priority ?? 3),
            ...(message.tags?.length ? { Tags: message.tags.join(',') } : {})
          },
          body: message.body
        })
        if (!res.ok) {
          deps.log?.(`Push relay rejected the message: ${res.status}`)
          return false
        }
        return true
      } catch (err) {
        // A relay that cannot be reached must never break anything else. The desktop
        // toast has already fired; this is the extra hop to the phone.
        deps.log?.(`Push relay unreachable: ${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    },

    /** Send a test message so the user can confirm their phone is subscribed. */
    async test(): Promise<boolean> {
      return this.send({
        title: 'Khatwa',
        body: 'Push notifications are working. You can close this.',
        priority: 3,
        tags: ['white_check_mark']
      })
    }
  }
}

export type PushRelay = ReturnType<typeof pushRelay>
