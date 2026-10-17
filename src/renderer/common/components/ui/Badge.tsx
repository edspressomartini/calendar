import type { JSX, ReactNode } from 'react'

interface BadgeProps {
  readonly children: ReactNode
  readonly tone?: 'neutral' | 'urgent' | 'live'
}

const TONES: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-bg-subtle text-text-muted',
  urgent: 'bg-urgent/10 text-urgent',
  live: 'bg-live/10 text-live',
}

export function Badge({ children, tone = 'neutral' }: BadgeProps): JSX.Element {
  return <span className={`rounded px-1.5 py-0.5 text-body ${TONES[tone]}`}>{children}</span>
}
