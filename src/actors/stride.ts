/** How many footfalls a clip crossed. Plants sit on each half of the cycle, including the end. */
export function footfalls(before: number, after: number, duration: number): number {
  if (!(duration > 0) || after === before) return 0
  if (after < before) return marks(before, duration, duration) + marks(0, after, duration)
  return marks(before, after, duration)
}

function marks(before: number, after: number, duration: number): number {
  if (after <= before) return 0
  const half = duration * 0.5
  let mark = Math.floor(before / half) * half
  if (mark <= before) mark += half
  let count = 0
  while (mark <= after && count < 8) {
    count++
    mark += half
  }
  return count
}
