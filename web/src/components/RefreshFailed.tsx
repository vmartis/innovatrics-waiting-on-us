import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Something loaded once and a later refresh failed. Keeping the last good data
 * beats an empty screen, but silently it would look current — and a stale
 * "Waiting" badge is how two of us end up replying to one customer.
 */
export function RefreshFailed({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
      <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
      <p className="text-sm text-foreground">
        Could not reach the server — what you see may be out of date.
      </p>
      <Button variant="outline" size="sm" className="ml-auto" onClick={onRetry} disabled={busy}>
        {busy ? 'Trying…' : 'Try again'}
      </Button>
    </div>
  )
}
