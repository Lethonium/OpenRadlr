/**
 * Winter's materials: snow, ice, exposed rock and the timber of a mountain
 * village. Same keys as the temperate palette, so the shared feature builders
 * (bridges, pavements, rails, barriers) need no winter-specific code.
 */

export const SNOW = Object.freeze([0.94, 0.96, 0.99]);
export const SNOW_SHADE = Object.freeze([0.82, 0.87, 0.94]);
export const ICE = Object.freeze([0.76, 0.86, 0.93]);
export const TIMBER = Object.freeze([0.46, 0.32, 0.22]);
export const TIMBER_DARK = Object.freeze([0.3, 0.21, 0.15]);
export const STONE = Object.freeze([0.56, 0.58, 0.62]);
export const STONE_DARK = Object.freeze([0.43, 0.45, 0.49]);
export const PINE = Object.freeze([0.12, 0.23, 0.17]);
export const WINDOW = Object.freeze([0.24, 0.29, 0.35]);

export const WINTER_PALETTE = Object.freeze({
  walls: [
    [0.56, 0.38, 0.26],
    [0.63, 0.45, 0.31],
    [0.86, 0.83, 0.77],
    [0.72, 0.73, 0.72],
    [0.48, 0.33, 0.23],
  ],
  roofs: [
    [0.3, 0.22, 0.18],
    [0.24, 0.2, 0.19],
    [0.36, 0.27, 0.21],
  ],
  window: WINDOW,
  door: TIMBER_DARK,
  stone: STONE,
  stoneDark: STONE_DARK,
  pavement: SNOW_SHADE,
  kerb: [0.67, 0.7, 0.74],
  forecourt: SNOW_SHADE,
  forecourtEdge: [0.65, 0.68, 0.72],
  barn: TIMBER,
  barnRoof: [0.26, 0.22, 0.2],
  silo: [0.74, 0.78, 0.82],
  hay: [0.78, 0.68, 0.44],
  metal: [0.66, 0.7, 0.75],
  white: [0.95, 0.96, 0.98],
  red: [0.78, 0.2, 0.18],
  yellow: [0.95, 0.78, 0.24],
  black: [0.1, 0.11, 0.13],
  lamp: [1.0, 0.9, 0.64],
  pole: [0.3, 0.32, 0.36],
  cowWhite: [0.9, 0.9, 0.88],
  cowBrown: [0.45, 0.32, 0.24],
  sheep: [0.9, 0.9, 0.87],
  dark: [0.12, 0.12, 0.13],
  skin: [0.88, 0.72, 0.6],
  pants: [0.22, 0.24, 0.3],
});
