import { useCallback, useEffect, useRef, useState } from 'react';
import { haptics } from '../lib/haptics';

type PermissionState = 'idle' | 'granted' | 'denied' | 'unavailable';

interface DeviceMotionEventWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

const SMOOTHING_ALPHA = 0.3;
const DEBOUNCE_MS = 500;
const GRAVITY = 9.81;

export function useShakeDetector(initialThreshold = 15) {
  const [started, setStarted] = useState(false);
  const [permissionState, setPermissionState] = useState<PermissionState>('idle');
  const [magnitude, setMagnitude] = useState(0);
  const [threshold, setThreshold] = useState(initialThreshold);
  const [shakeCount, setShakeCount] = useState(0);
  const [lastShakeAt, setLastShakeAt] = useState<number | null>(null);

  // Refs hold the high-frequency state so 60-100Hz sensor events
  // don't trigger a React re-render per sample. The rAF loop below
  // copies the smoothed value into React state at ~60Hz max.
  const smoothedRef = useRef(0);
  const thresholdRef = useRef(initialThreshold);
  const cooldownUntilRef = useRef(0);
  const wasAboveRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const listenerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);

  useEffect(() => {
    thresholdRef.current = threshold;
  }, [threshold]);

  const handleMotion = useCallback((e: DeviceMotionEvent) => {
    // Prefer gravity-removed linear acceleration. Some browsers (older
    // Android, some iOS configurations) only populate the gravity-
    // included variant; subtract a fixed gravity baseline from the
    // magnitude in that case.
    let mag: number;
    const a = e.acceleration;
    if (a && (a.x !== null || a.y !== null || a.z !== null)) {
      const x = a.x ?? 0;
      const y = a.y ?? 0;
      const z = a.z ?? 0;
      mag = Math.sqrt(x * x + y * y + z * z);
    } else {
      const g = e.accelerationIncludingGravity;
      if (!g) return;
      const x = g.x ?? 0;
      const y = g.y ?? 0;
      const z = g.z ?? 0;
      mag = Math.max(0, Math.sqrt(x * x + y * y + z * z) - GRAVITY);
    }

    const prev = smoothedRef.current;
    const next = SMOOTHING_ALPHA * mag + (1 - SMOOTHING_ALPHA) * prev;
    smoothedRef.current = next;

    const now = performance.now();
    const isAbove = next >= thresholdRef.current;
    const isRisingEdge = isAbove && !wasAboveRef.current;
    wasAboveRef.current = isAbove;

    if (isRisingEdge && now >= cooldownUntilRef.current) {
      cooldownUntilRef.current = now + DEBOUNCE_MS;
      haptics.shake();
      const ts = Date.now();
      setLastShakeAt(ts);
      setShakeCount((c) => c + 1);
    }
  }, []);

  const start = useCallback(async () => {
    if (started) return;

    if (typeof DeviceMotionEvent === 'undefined') {
      setPermissionState('unavailable');
      return;
    }

    const ctor = DeviceMotionEvent as unknown as DeviceMotionEventWithPermission;
    if (typeof ctor.requestPermission === 'function') {
      try {
        const result = await ctor.requestPermission();
        if (result !== 'granted') {
          setPermissionState('denied');
          return;
        }
      } catch {
        setPermissionState('denied');
        return;
      }
    }

    setPermissionState('granted');
    listenerRef.current = handleMotion;
    window.addEventListener('devicemotion', handleMotion);
    setStarted(true);
  }, [started, handleMotion]);

  // Pump the smoothed ref into React state at ~60Hz max.
  useEffect(() => {
    if (!started) return;
    const tick = () => {
      setMagnitude(smoothedRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [started]);

  useEffect(() => {
    return () => {
      if (listenerRef.current) {
        window.removeEventListener('devicemotion', listenerRef.current);
        listenerRef.current = null;
      }
    };
  }, []);

  return {
    start,
    started,
    permissionState,
    magnitude,
    threshold,
    setThreshold,
    shakeCount,
    lastShakeAt,
  };
}
