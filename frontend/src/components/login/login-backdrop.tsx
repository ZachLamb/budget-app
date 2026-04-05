"use client";

import { useEffect, useId, useRef, useState } from "react";

const PATHS = [
  "M -40 220 C 70 30, 180 280, 210 90 S 380 200, 440 60",
  "M 460 200 C 320 40, 120 260, -30 140 S -50 40, -40 280",
  "M 220 -20 C 80 80, 360 140, 200 260 S 40 180, 420 240",
] as const;

type PlaneSpec = {
  d: string;
  durationSec: number;
  phase: number;
  trailFrac: number;
  opacity: number;
};

const PLANE_SPECS: PlaneSpec[] = [
  { d: PATHS[0], durationSec: 14, phase: 0, trailFrac: 0.18, opacity: 0.92 },
  { d: PATHS[1], durationSec: 18, phase: 0.35, trailFrac: 0.16, opacity: 0.68 },
  { d: PATHS[2], durationSec: 16, phase: 0.62, trailFrac: 0.17, opacity: 0.52 },
];

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);

  return matches;
}

export function LoginBackdrop() {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const compact = useMediaQuery("(max-width: 640px)");
  const rawId = useId();
  const safeId = rawId.replace(/:/g, "");
  const maskRefs = useRef<(SVGPathElement | null)[]>([]);
  const planeRefs = useRef<(SVGGElement | null)[]>([]);
  const startRef = useRef(0);

  const specs = compact ? PLANE_SPECS.slice(0, 2) : PLANE_SPECS;

  useEffect(() => {
    if (reduceMotion) return;

    const planeSpecs = compact ? PLANE_SPECS.slice(0, 2) : PLANE_SPECS;

    startRef.current = performance.now();
    maskRefs.current = [];
    planeRefs.current = [];

    let raf = 0;
    let running = false;

    const tick = (now: number) => {
      if (document.visibilityState === "hidden") {
        running = false;
        return;
      }

      const tSec = (now - startRef.current) / 1000;

      for (let i = 0; i < planeSpecs.length; i++) {
        const maskPath = maskRefs.current[i];
        const planeG = planeRefs.current[i];
        if (!maskPath || !planeG) continue;

        const L = maskPath.getTotalLength();
        if (L < 2) continue;

        const spec = planeSpecs[i]!;
        const w = L * spec.trailFrac;
        const u = (tSec / spec.durationSec + spec.phase) % 1;
        const s = u * L;

        const dash =
          s >= w
            ? `0 ${s - w} ${w} ${Math.max(L - s, 0.001)}`
            : `0 0 ${s} ${Math.max(L - s, 0.001)}`;
        maskPath.setAttribute("stroke-dasharray", dash);

        const p = maskPath.getPointAtLength(s);
        const look = Math.min(8, L * 0.03);
        const p2 = maskPath.getPointAtLength(Math.min(s + look, L));
        const deg = (Math.atan2(p2.y - p.y, p2.x - p.x) * 180) / Math.PI;
        planeG.setAttribute("transform", `translate(${p.x},${p.y}) rotate(${deg})`);
      }

      raf = requestAnimationFrame(tick);
      running = true;
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        cancelAnimationFrame(raf);
        running = false;
      } else if (!running) {
        startRef.current = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduceMotion, compact]);

  if (reduceMotion) {
    return null;
  }

  return (
    <div
      className="login-backdrop pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 400 300"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {specs.map((spec, i) => (
            <mask
              key={`mask-${spec.d.slice(0, 12)}-${i}`}
              id={`${safeId}-m-${i}`}
              maskUnits="userSpaceOnUse"
              x="-100"
              y="-100"
              width="600"
              height="500"
            >
              <rect x="-100" y="-100" width="600" height="500" fill="black" />
              <path
                ref={(el) => {
                  maskRefs.current[i] = el;
                }}
                d={spec.d}
                fill="none"
                stroke="white"
                strokeLinecap="round"
                style={{ strokeWidth: "var(--login-mask-stroke-width, 14px)" }}
              />
            </mask>
          ))}
        </defs>

        {specs.map((spec, i) => (
          <g key={`plane-${i}`} opacity={spec.opacity}>
            <g style={{ color: "var(--login-trail-stroke)" }}>
              <path
                className="login-backdrop-trail"
                d={spec.d}
                fill="none"
                mask={`url(#${safeId}-m-${i})`}
              />
            </g>
            <g
              ref={(el) => {
                planeRefs.current[i] = el;
              }}
            >
              <polygon className="login-backdrop-plane" points="0,-4 6,0 0,4 -3,0" />
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}
