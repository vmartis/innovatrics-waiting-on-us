import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { MessageList } from '@/components/MessageList'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ApiError,
  answerTopic,
  moveMessage,
  reopenTopic,
  type Message,
  type ThreadSummary,
  type Topic,
} from '@/lib/api'

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** The value the move picker uses for "back into a topic of its own". */
const OWN_TOPIC = 'own'

/**
 * A short name for a topic: the oldest subject in it — a chain often starts
 * with a call or a chat, which have none — or else the channel and date of
 * its first message. Subjects are customer text and only ever rendered as text.
 */
function topicLabel(topic: Topic, byId: ReadonlyMap<number, Message>): string {
  const oldestFirst = [...topic.messageIds].reverse()
  for (const id of oldestFirst) {
    const subject = byId.get(id)?.subject
    if (subject) return subject
  }
  const first = byId.get(topic.topicId)
  if (!first) return 'Topic'
  return `${first.channel} of ${dateTime.format(new Date(first.receivedAt))}`
}

/**
 * One customer's conversation split into topics — reply chains answered one
 * by one, so "answered" on the invoice question no longer closes the outage.
 * The customer still has one owner: only the person holding the thread can
 * answer a topic, undo an answer or move a message.
 */
export function TopicList({
  head,
  messages,
  topics,
  me,
}: {
  head: ThreadSummary
  messages: Message[]
  topics: Topic[]
  me: string | null
}) {
  const queryClient = useQueryClient()
  const threadId = head.threadId
  const byId = new Map(messages.map((message) => [message.id, message]))
  const topicOf = new Map(topics.flatMap((t) => t.messageIds.map((id) => [id, t.topicId])))
  const mine = head.claimedBy === me && head.status !== 'waiting'
  const canEdit = mine && head.status === 'claimed'

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['thread', threadId] }),
      queryClient.invalidateQueries({ queryKey: ['threads'] }),
    ])
  }
  const onError = (fallback: string) => async (err: unknown) => {
    toast.error(err instanceof ApiError ? err.message : fallback)
    await refresh()
  }

  const answer = useMutation({
    mutationFn: (topic: Topic) => answerTopic(threadId, topic, me ?? ''),
    onSuccess: async (state) => {
      toast.success(
        state.status === 'answered'
          ? 'That was the last open topic — the thread has left the waiting list'
          : 'Topic answered — the other open topics still wait',
      )
      await refresh()
    },
    onError: onError('Could not mark this topic answered'),
  })

  const reopen = useMutation({
    mutationFn: (topic: Topic) => reopenTopic(threadId, topic.topicId, me ?? ''),
    onSuccess: async () => {
      toast.success('The topic is open again, and the thread is still yours')
      await refresh()
    },
    onError: onError('Could not undo this'),
  })

  const move = useMutation({
    mutationFn: ({ messageId, topicId }: { messageId: number; topicId: number | null }) =>
      moveMessage(threadId, messageId, topicId, me ?? ''),
    onSuccess: async (_state, { topicId }) => {
      toast.success(topicId === null ? 'Back in a topic of its own' : 'Moved into that topic')
      await refresh()
    },
    onError: onError('Could not move this message'),
  })

  const busy = answer.isPending || reopen.isPending || move.isPending

  /**
   * Only a message the customer did not link can be moved, and only by hand:
   * guessing from the text could quietly hide a request inside the wrong topic.
   */
  const moveControl = (message: Message) => {
    if (!canEdit || message.inReplyTo !== null) return null
    const current = topicOf.get(message.id)
    const targets = topics.filter((t) => t.topicId !== current)
    if (targets.length === 0 && message.assignedTo === null) return null
    return (
      <Select
        value={null}
        onValueChange={(value) => {
          if (!value) return
          move.mutate({
            messageId: message.id,
            topicId: value === OWN_TOPIC ? null : Number(value),
          })
        }}
      >
        <SelectTrigger size="sm" disabled={busy} aria-label="Move this message into another topic">
          <SelectValue placeholder="Move to topic…" />
        </SelectTrigger>
        <SelectContent>
          {message.assignedTo !== null ? (
            <SelectItem value={OWN_TOPIC}>Its own topic again</SelectItem>
          ) : null}
          {targets.map((topic) => (
            <SelectItem key={topic.topicId} value={String(topic.topicId)}>
              <span className="max-w-64 truncate">{topicLabel(topic, byId)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <section className="space-y-6" aria-label="Topics, newest first">
      <p className="text-xs text-muted-foreground">
        {head.openTopicCount} of {topics.length} topics open · {messages.length} messages · newest
        topic first
      </p>
      {topics.map((topic) => {
        const label = topicLabel(topic, byId)
        const inTopic = messages.filter((m) => topic.messageIds.includes(m.id))
        return (
          <section
            key={topic.topicId}
            aria-label={`Topic: ${label}`}
            className="space-y-3 rounded-xl border bg-muted/30 p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 truncate text-sm font-medium text-foreground">{label}</h3>
              {topic.status === 'open' ? (
                <Badge variant="secondary">
                  Open
                  {topic.unansweredCount > 1 ? ` · ${topic.unansweredCount} unanswered` : ''}
                </Badge>
              ) : (
                <Badge variant="outline">Answered by {topic.answeredBy}</Badge>
              )}
              <div className="ml-auto flex items-center gap-2">
                {canEdit && topic.status === 'open' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => answer.mutate(topic)}
                  >
                    <Check className="size-4" aria-hidden="true" />
                    Mark topic answered
                  </Button>
                ) : null}
                {mine && topic.status === 'answered' && topic.answeredBy === me ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => reopen.mutate(topic)}
                  >
                    <Undo2 className="size-4" aria-hidden="true" />
                    Undo
                  </Button>
                ) : null}
              </div>
            </div>
            <MessageList
              messages={inTopic}
              actions={moveControl}
              label={`Messages of topic: ${label}`}
              showCount={false}
            />
          </section>
        )
      })}
    </section>
  )
}
