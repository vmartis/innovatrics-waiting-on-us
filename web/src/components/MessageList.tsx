import { CornerDownRight } from 'lucide-react'
import { ChannelBadge } from '@/components/ChannelBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Message } from '@/lib/api'

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** How far in a reply is drawn; deeper chains stop at the third step. */
const INDENT = ['', 'ml-4 border-l pl-4', 'ml-8 border-l pl-4', 'ml-12 border-l pl-4']

type Row = {
  message: Message
  /** How deep in a reply chain this message sits, capped for the indent. */
  depth: number
  /** The message it answers, when that message is shown further down. */
  answers: Message | null
}

/**
 * Work out the indent and the "answers …" line for each message.
 *
 * The order comes from the server and is not touched here: newest message
 * first, and every reply above the message it answers, inside the same chain
 * (the rule is written out in lib/thread.ts). We follow `answersId`, the link
 * the server actually used, not the raw `inReplyTo` — and we only claim the
 * answered message is "below" after checking that it really is.
 */
function toRows(messages: Message[]): Row[] {
  const byId = new Map(messages.map((message) => [message.id, message]))
  const positionOf = new Map(messages.map((message, index) => [message.id, index]))

  return messages.map((message, index) => {
    let depth = 0
    let up = message.answersId === null ? undefined : byId.get(message.answersId)
    while (up && depth < INDENT.length - 1) {
      depth += 1
      up = up.answersId === null ? undefined : byId.get(up.answersId)
    }

    const parent = message.answersId === null ? null : byId.get(message.answersId) ?? null
    const parentAt = parent ? positionOf.get(parent.id) : undefined
    const answers = parent && parentAt !== undefined && parentAt > index ? parent : null
    return { message, depth, answers }
  })
}

/**
 * One customer's whole conversation: email, chat and call in a single
 * timeline, newest message at the top.
 */
export function MessageList({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          This customer has not written anything yet.
        </CardContent>
      </Card>
    )
  }

  return (
    <section className="space-y-3" aria-label="Conversation, newest message first">
      <p className="text-xs text-muted-foreground">
        Newest message first · {messages.length} messages
      </p>
      {toRows(messages).map((row) => (
        <div key={row.message.id} className={INDENT[row.depth]}>
          <MessageCard row={row} />
        </div>
      ))}
    </section>
  )
}

function MessageCard({ row: { message, answers } }: { row: Row }) {
  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ChannelBadge channel={message.channel} />
          <span className="text-sm font-medium text-foreground">
            {message.contactName ?? 'Unknown sender'}
          </span>
          <span className="text-xs text-muted-foreground">
            {dateTime.format(new Date(message.receivedAt))}
          </span>
        </div>
        {message.subject ? (
          <CardTitle className="text-base font-medium">{message.subject}</CardTitle>
        ) : null}
        {answers ? (
          // Only set when the answered message really is further down, so
          // "below" is checked, not assumed.
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <CornerDownRight className="size-3 shrink-0" aria-hidden="true" />
            Answers {answers.contactName ?? 'the message'} of{' '}
            {dateTime.format(new Date(answers.receivedAt))}, below
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        {/* Customer text: shown as plain text, never as HTML. */}
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{message.body}</p>
      </CardContent>
    </Card>
  )
}
