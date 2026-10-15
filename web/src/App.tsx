import { Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { useMe } from '@/lib/me'
import { InboxPage } from '@/pages/InboxPage'
import { ThreadPage } from '@/pages/ThreadPage'

export default function App() {
  const [me, chooseMe] = useMe()

  return (
    <AppShell me={me} onChoose={chooseMe}>
      <Routes>
        <Route path="/" element={<InboxPage me={me} />} />
        <Route path="/threads/:threadId" element={<ThreadPage me={me} />} />
        <Route path="*" element={<InboxPage me={me} />} />
      </Routes>
    </AppShell>
  )
}
