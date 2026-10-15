import { Inbox, RotateCcw, TriangleAlert } from 'lucide-react'
import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type Props = {
  children: ReactNode
  /**
   * `page` (the default) replaces the whole screen, for the outermost
   * boundary. `conversation` replaces only one block, so a single odd message
   * does not cost you the header, the name picker and the rest of the page.
   */
  where?: 'page' | 'conversation'
}

/**
 * Last line of defence. A screen that throws while rendering — a date the
 * browser cannot format, a field that is suddenly null — would otherwise make
 * React unmount everything and leave a blank white page, which tells the
 * teammate nothing. This catches it and leaves them a readable way out.
 */
export class ErrorBoundary extends Component<Props, { crashed: boolean }> {
  state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error: Error) {
    // Only the error type, and only in the browser console. A message that one
    // day quotes customer text in its error would otherwise end up written
    // down on a shared machine.
    console.error(`The app crashed while rendering: ${error.name}`)
  }

  render() {
    if (!this.state.crashed) return this.props.children
    return this.props.where === 'conversation' ? <BrokenBlock /> : <Crashed />
  }
}

/**
 * Deliberately standalone: no app data, no router, no server query. A fallback
 * that leans on the broken parts can throw in turn, and React cannot catch an
 * error thrown by a boundary's own fallback — that really is a blank page.
 */
function Crashed() {
  return (
    <div className="min-h-svh bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Inbox className="size-5" aria-hidden="true" />
          </span>
          <span className="text-base font-semibold leading-tight text-foreground">
            Waiting on us
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <TriangleAlert className="size-8 text-destructive" aria-hidden="true" />
            <p className="font-medium text-foreground">Something broke on this screen</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Claims and answers are kept on the server, so nothing you finished is lost. Reload
              and carry on.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => window.location.reload()}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Reload the page
              </Button>
              <Button render={<a href="/" />} variant="outline">
                Back to the waiting list
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

/** One block failed; the page around it still works. */
function BrokenBlock() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <TriangleAlert className="size-6 text-destructive" aria-hidden="true" />
        <p className="font-medium text-foreground">This conversation could not be shown</p>
        <p className="max-w-md text-sm text-muted-foreground">
          The claim on this thread is unaffected. Reload the page to try again.
        </p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Reload the page
        </Button>
      </CardContent>
    </Card>
  )
}
