// Centralized Vibration API patterns. Each call is a no-op (via optional
// chaining) on devices/browsers without vibration support, so callers don't
// need to feature-detect.
//
// Single-number durations only — some Android/Chrome builds honor
// `vibrate(n)` but silently ignore pattern arrays, and very short pulses
// (<~80ms) are dropped. Durations scale small -> large for tick/go/elimination.
export const haptics = {
  // Small, light per-second tick during the "Get Ready" countdown — the
  // smallest of the three, building up to the Go/elimination buzzes.
  tick: () => navigator.vibrate?.(120),
  // Larger buzz on "Go".
  go: () => navigator.vibrate?.(300),
  // Big, unmistakable buzz when a player is eliminated.
  elimination: () => navigator.vibrate?.(600),
  // Generic shake pulse (used by the motion-sensor demo).
  shake: () => navigator.vibrate?.(200),
};
