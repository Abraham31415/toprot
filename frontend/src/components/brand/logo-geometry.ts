// Geometry of the ToProt mark on a 64 x 64 grid, traced from the approved reference animation.
//
// A magnifying glass with two stacked research layers inside it. Outlines only, round caps and joins, two flat colours:
//   frame (navy):  RING   an open lens (centre 30.75,30.22, radius 21.51) that starts where the handle meets it and runs
//                         330 degrees clockwise, leaving a gap at the lower right, like the tail of a Q.
//                  HANDLE a short stroke from that junction, down and to the right.
//   pages (teal):  CHEVRON the lower layer, left to right.
//                  DIAMOND the upper layer, a closed rhombus with softened vertices, from its left vertex over the top.
// Each stroke is one continuous line, drawn in this order.
export const LOGO_RING_PATH = "M45.97 45.43A21.51 21.51 0 1 1 51.58 35.61";
export const LOGO_HANDLE_PATH = "M45.97 45.43L53.87 53.87";
export const LOGO_CHEVRON_PATH = "M20 35.02L31.64 42.13L43.29 35.02";
export const LOGO_DIAMOND_PATH =
  "M20.16 28.92L30.24 23.35Q31.64 22.58 33.05 23.35L43.13 28.92Q44.53 29.69 43.13 30.46L33.05 36.03Q31.64 36.8 30.24 36.03L20.16 30.46Q18.76 29.69 20.16 28.92Z";

export const LOGO_STROKES = [
  { part: "ring", d: LOGO_RING_PATH, layer: "frame" },
  { part: "handle", d: LOGO_HANDLE_PATH, layer: "frame" },
  { part: "chevron", d: LOGO_CHEVRON_PATH, layer: "pages" },
  { part: "diamond", d: LOGO_DIAMOND_PATH, layer: "pages" },
] as const;

export const LOGO_VIEWBOX = "0 0 64 64";

/**
 * Stroke weights in grid units: a heavy frame and fine pages, as in the reference. At 32 px and below both get
 * heavier so the two layers stay distinct.
 */
export const STROKES = { detail: { frame: 4.6, pages: 2.1 }, compact: { frame: 5.2, pages: 3.2 } } as const;
export const COMPACT_AT_OR_BELOW = 32;

export function strokesFor(size: number): { frame: number; pages: number } {
  return size <= COMPACT_AT_OR_BELOW ? STROKES.compact : STROKES.detail;
}
