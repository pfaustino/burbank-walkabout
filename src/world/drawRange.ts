export type DrawSpot = { x: number; z: number; reach: number }

/** Metres past the show distance before an actor is taken back off screen. */
const HOLD = 40

export const PERSON_DRAW = 140
export const CAR_DRAW = 240
export const BUS_DRAW = 320

/** True while the actor should have a mesh. `shown` keeps them up a little past the edge. */
export function staysDrawn(
  x: number,
  z: number,
  viewX: number,
  viewZ: number,
  reach: number,
  shown: boolean,
): boolean {
  const limit = shown ? reach + HOLD : reach
  const dx = x - viewX
  const dz = z - viewZ
  return dx * dx + dz * dz <= limit * limit
}
