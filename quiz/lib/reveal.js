// Variable-tempo reveal kernel.
//
// Each question carries its own tempo_ms (800ms first, dropping to 200ms by
// Q7). We expose two browser-facing helpers:
//
//   1. applyTempo(element, tempo_ms) — sets a CSS var --tempo so the
//      element's `transition: opacity var(--tempo)` resolves to that duration
//   2. reveal(element) — flips the element's opacity from 0 to 1 in the
//      next animation frame so the transition fires deterministically
//
// Honours `prefers-reduced-motion: reduce` — when present, tempo collapses
// to 0ms so nothing moves but content still appears.

const REDUCED_MOTION = typeof matchMedia === "function"
  ? matchMedia("(prefers-reduced-motion: reduce)").matches
  : false;

const MIN_TEMPO_MS = 50;
const MAX_TEMPO_MS = 1200;

export function clampTempo(ms) {
  if (typeof ms !== "number" || !isFinite(ms)) return 400;
  if (REDUCED_MOTION) return 0;
  return Math.max(MIN_TEMPO_MS, Math.min(MAX_TEMPO_MS, Math.round(ms)));
}

export function applyTempo(element, tempo_ms) {
  if (!element) return;
  const t = clampTempo(tempo_ms);
  element.style.setProperty("--tempo", `${t}ms`);
}

export function reveal(element, tempo_ms) {
  if (!element) return;
  applyTempo(element, tempo_ms);
  // Force a layout flush so the next paint sees opacity:0 → 1 transition.
  // Reading offsetHeight is the cheapest cross-browser trigger.
  // eslint-disable-next-line no-unused-expressions
  element.offsetHeight;
  element.classList.add("revealed");
}

export function hide(element) {
  if (!element) return;
  element.classList.remove("revealed");
}

// Stagger reveal across multiple elements with a per-step delay derived
// from the parent's tempo_ms. Used for option lists where each option
// rises ~80ms after the previous (within reduced-motion budget).
export function staggerReveal(elements, parentTempoMs) {
  const base = clampTempo(parentTempoMs);
  const stepDelay = REDUCED_MOTION ? 0 : Math.max(60, Math.round(base / 6));
  elements.forEach((el, i) => {
    setTimeout(() => reveal(el, base), i * stepDelay);
  });
}
