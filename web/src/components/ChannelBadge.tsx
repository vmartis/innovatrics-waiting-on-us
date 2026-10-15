import { Mail, MessageSquare, Phone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

const CHANNELS = {
  email: { label: 'Email', Icon: Mail },
  chat: { label: 'Chat', Icon: MessageSquare },
  call: { label: 'Call', Icon: Phone },
} as const

/** Shows which channel a message came in on. Unknown values show as-is. */
export function ChannelBadge({ channel }: { channel: string }) {
  const known = CHANNELS[channel as keyof typeof CHANNELS]
  const Icon = known?.Icon
  return (
    <Badge variant="secondary" className="gap-1 font-normal">
      {Icon ? <Icon className="size-3" aria-hidden="true" /> : null}
      {known?.label ?? channel}
    </Badge>
  )
}
