import React from 'react'

/* Lightweight skeleton primitives for the dashboard's progressive loading.
   Every section renders its own placeholder immediately and swaps in real
   data only when that section's request resolves. */

export function CardValueSkeleton() {
  return <div className="h-7 w-36 bg-slate-200/70 rounded-lg animate-pulse" />
}

export function RowsSkeleton({ rows = 4, tall = false }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`bg-slate-100 rounded-lg animate-pulse ${tall ? 'h-16' : 'h-12'}`}
        />
      ))}
    </div>
  )
}

export function BarSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-3 w-24 bg-slate-100 rounded-full animate-pulse" />
          <div
            className="h-3 bg-slate-200 rounded-full animate-pulse"
            style={{ width: `${72 - i * 14}%` }}
          />
        </div>
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 5 }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
      ))}
    </div>
  )
}