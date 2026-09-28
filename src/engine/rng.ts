import { RNG, type State } from './state';

/** mulberry32。状態は State[RNG] に保持する。 */
export function rand(s: State): number {
  let t = (s[RNG] = (s[RNG] + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
