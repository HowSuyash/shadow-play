import { Vector3 } from '@iwsdk/core';

/**
 * Room-local layout. The whole room is authored around a seated player whose
 * eyes sit at (0, EYE_Y, 0) looking down -Z. On entering XR the room root is
 * re-anchored to the real head position, so these numbers hold for any player
 * height (see Room.anchorTo).
 */
export const EYE_Y = 1.2;

/** The shadow wall plane (faces +Z, toward the player). */
export const WALL_Z = -1.5;

/**
 * Candle flame = the single shadow-casting light. It sits low and close to the
 * player (on a stand at lap height) so hands held comfortably in front of the
 * chest land their shadow at ~3-4x magnification on the wall.
 */
export const CANDLE_FLAME = new Vector3(0, EYE_Y - 0.42, -0.14);

/** The 2D "shadow world" stage drawn on the wall. */
export const STAGE = {
  /** Slightly in front of the wall to avoid z-fighting. */
  z: WALL_Z + 0.012,
  /** Line that silhouettes stand on. */
  groundY: EYE_Y + 0.02,
  left: -1.25,
  right: 1.25,
  /** Where titles and level names appear. */
  titleY: EYE_Y + 0.75,
};

/** Near-field pause menu, well within the 0.6 m seated reach envelope. */
export const MENU = {
  center: new Vector3(0, EYE_Y - 0.2, -0.36),
  buttonOffsetX: 0.115,
  buttonRadius: 0.1,
};
