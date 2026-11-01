export type ThreadStatus = 'waiting' | 'claimed' | 'answered'

export type ThreadState = {
  status: ThreadStatus
  claimedBy: string | null
  claimedAt: string | null
  answeredBy: string | null
  answeredAt: string | null
}

export type ThreadSummary = ThreadState & {
  /** Stable id of the thread (the customer's first message). */
  threadId: number
  customer: string
  contactName: string | null
  messageCount: number
  channels: string[]
  lastMessageAt: string
  lastChannel: string
  latestMessageId: number
  /** How many topics (reply chains) this customer has, and how many are open. */
  topicCount: number
  openTopicCount: number
  /** Messages nobody has answered yet — 3 means the customer is chasing. */
  unansweredCount: number
  /** Arrival of the oldest unanswered message; what the wait is measured from. */
  waitingSince: string | null
}

export type Message = {
  id: number
  channel: string
  receivedAt: string
  contactName: string | null
  subject: string | null
  /** Untrusted customer text. Always rendered as text, never as HTML. */
  body: string
  inReplyTo: number | null
  /**
   * The reply link the server actually used, which is `inReplyTo` unless that
   * link was unusable. Screens must follow this one.
   */
  answersId: number | null
  /** The topic a colleague moved this message into by hand, or `null`. */
  assignedTo: number | null
}

/** One topic of a customer: a reply chain, answered on its own. */
export type Topic = {
  /** `requests.id` of the topic's first message. */
  topicId: number
  /** Its messages, newest first. */
  messageIds: number[]
  newestMessageId: number
  lastMessageAt: string
  status: 'open' | 'answered'
  answeredBy: string | null
  answeredAt: string | null
  unansweredCount: number
  waitingSince: string | null
}

export type ThreadDetail = { thread: ThreadSummary; messages: Message[]; topics: Topic[] }

/** An error carrying the server's own wording, so screens can show it. */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status)
  }
  return (await res.json()) as T
}

export async function fetchTeam(): Promise<string[]> {
  return (await request<{ team: string[] }>('/api/team')).team
}

/** Which list to show: the job, or the record of what is done. */
export type ThreadView = 'waiting' | 'answered'

export async function fetchThreads(view: ThreadView = 'waiting'): Promise<ThreadSummary[]> {
  const data = await request<{ threads: ThreadSummary[] }>(`/api/threads?show=${view}`)
  return data.threads
}

export async function fetchThread(threadId: number): Promise<ThreadDetail> {
  return await request<ThreadDetail>(`/api/threads/${threadId}`)
}

export async function claimThread(threadId: number, person: string): Promise<ThreadState> {
  const data = await request<{ state: ThreadState }>(`/api/threads/${threadId}/claim`, {
    method: 'POST',
    body: JSON.stringify({ person }),
  })
  return data.state
}

export async function markAnswered(threadId: number, person: string): Promise<ThreadState> {
  const data = await request<{ state: ThreadState }>(`/api/threads/${threadId}/answered`, {
    method: 'POST',
    body: JSON.stringify({ person }),
  })
  return data.state
}

/** Hand a thread back so a colleague can take it. */
export async function releaseThread(threadId: number, person: string): Promise<ThreadState> {
  const data = await request<{ state: ThreadState }>(`/api/threads/${threadId}/release`, {
    method: 'POST',
    body: JSON.stringify({ person }),
  })
  return data.state
}

/** Undo your own "answered" mark; the thread comes back as yours. */
export async function reopenThread(threadId: number, person: string): Promise<ThreadState> {
  const data = await request<{ state: ThreadState }>(`/api/threads/${threadId}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ person }),
  })
  return data.state
}

/**
 * Mark one topic answered. `seenMessageId` is the newest message of the topic
 * on your screen; if the customer wrote again since, the server refuses.
 */
export async function answerTopic(
  threadId: number,
  topic: Topic,
  person: string,
): Promise<ThreadState> {
  const data = await request<{ state: ThreadState }>(
    `/api/threads/${threadId}/topics/${topic.topicId}/answered`,
    {
      method: 'POST',
      body: JSON.stringify({ person, seenMessageId: topic.newestMessageId }),
    },
  )
  return data.state
}

/** Undo your own answer on one topic. */
export async function reopenTopic(
  threadId: number,
  topicId: number,
  person: string,
): Promise<ThreadState> {
  const data = await request<{ state: ThreadState }>(
    `/api/threads/${threadId}/topics/${topicId}/reopen`,
    { method: 'POST', body: JSON.stringify({ person }) },
  )
  return data.state
}

/** Move a message without a reply link into a topic, or back on its own (`null`). */
export async function moveMessage(
  threadId: number,
  messageId: number,
  topicId: number | null,
  person: string,
): Promise<ThreadState> {
  const data = await request<{ state: ThreadState }>(
    `/api/threads/${threadId}/messages/${messageId}/topic`,
    { method: 'POST', body: JSON.stringify({ person, topicId }) },
  )
  return data.state
}
