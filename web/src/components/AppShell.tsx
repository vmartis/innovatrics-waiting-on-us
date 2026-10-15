import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { WaitingCount } from '@/components/WaitingCount'
import { WhoAmI } from '@/components/WhoAmI'

/** Header plus centred content column, shared by every page. */
export function AppShell({
  me,
  onChoose,
  children,
}: {
  me: string | null
  onChoose: (name: string) => void
  children: ReactNode
}) {
  return (
    <div className="min-h-svh bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Inbox className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold leading-tight text-foreground">
                Waiting on us
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                Shared customer inbox
              </span>
            </span>
          </Link>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <WaitingCount />
            <WhoAmI me={me} onChoose={onChoose} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}
