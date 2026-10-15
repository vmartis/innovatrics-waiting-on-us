import { useQuery } from '@tanstack/react-query'
import { UserRound } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchTeam } from '@/lib/api'

/** Pick which teammate you are. No password: this is a trusted team tool. */
export function WhoAmI({ me, onChoose }: { me: string | null; onChoose: (name: string) => void }) {
  const team = useQuery({ queryKey: ['team'], queryFn: fetchTeam, staleTime: Infinity })

  if (team.isPending) return <Skeleton className="h-8 w-[190px]" />
  if (team.isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Team list unavailable — reload to claim a thread
      </p>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
      <Select
        value={me ?? null}
        onValueChange={(value) => {
          if (value) onChoose(value)
        }}
      >
        <SelectTrigger className="w-[190px]" aria-label="Who are you?">
          <SelectValue placeholder="Who are you?" />
        </SelectTrigger>
        <SelectContent>
          {team.data.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
