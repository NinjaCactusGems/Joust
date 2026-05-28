// Centralized Vibration API patterns. Each call is a no-op (via optional
// chaining) on devices/browsers without vibration support, so callers don't
// need to feature-detect. Durations are milliseconds; arrays alternate
// vibrate / pause.
export const haptics = {
  // Small per-second tick during the "Get Ready" countdown.
  tick: () => navigator.vibrate?.(40),
  // Slightly larger buzz on "Go".
  go: () => navigator.vibrate?.([80, 40, 160]),
  // Big, unmistakable buzz when a player is eliminated.
  elimination: () => navigator.vibrate?.([200, 80, 200, 80, 200]),
  // Generic shake pulse (used by the motion-sensor demo).
  shake: () => navigator.vibrate?.(200),
};
