/**
 * What kinds of settlement the island knows and how each is laid out. Data only; the layout lives in
 * `index.js`. A city is a grid, a village a main street with one cross lane, a hamlet a farm cluster.
 */

/** Width of a settlement's main road entry, metres: the road itself is drawn by the road layer. */
export const MAIN_WIDTH = 7.4;

/** The kinds of settlement the island knows. */
export const SETTLEMENT_KIND = Object.freeze({
  city: "city",
  town: "town",
  village: "village",
  harbour: "harbour",
  hamlet: "hamlet",
});

/**
 * How each kind is laid out. A city is a grid; a village is a main street with
 * one cross lane; a hamlet is a farm cluster with no grid at all.
 */
export const SETTLEMENT_STYLE = Object.freeze({
  city: Object.freeze({
    block: 100,
    crossFrom: -2,
    crossTo: 2,
    rows: [-1, 1],
    streetWidth: 7,
    pavement: 2.4,
    garden: 3,
    gap: [2, 5],
    plotWidth: [7, 12],
    plotDepth: [10, 15],
    square: [50, 40],
    lampEvery: 26,
    maxSlope: 0.35,
    mainHouses: true,
    blocks: true,
  }),
  town: Object.freeze({
    block: 84,
    crossFrom: -1,
    crossTo: 1,
    rows: [-1, 1],
    streetWidth: 6.4,
    pavement: 2.2,
    garden: 3,
    gap: [2.5, 6],
    plotWidth: [7, 13],
    plotDepth: [10, 15],
    square: [34, 28],
    lampEvery: 28,
    maxSlope: 0.35,
    mainHouses: true,
    blocks: true,
  }),
  village: Object.freeze({
    block: 72,
    crossFrom: 0,
    crossTo: 0,
    rows: [-1, 1],
    streetWidth: 5.6,
    pavement: 2,
    garden: 3,
    gap: [3, 7],
    plotWidth: [8, 14],
    plotDepth: [9, 14],
    square: [26, 22],
    lampEvery: 32,
    maxSlope: 0.35,
    mainHouses: true,
    blocks: true,
    // A village hugs its green and cross lane; it does not line the whole road.
    frontage: 0.45,
  }),
  harbour: Object.freeze({
    block: 68,
    crossFrom: 0,
    crossTo: 0,
    rows: [-1, 1],
    streetWidth: 5.4,
    pavement: 2,
    garden: 2.5,
    gap: [3, 8],
    plotWidth: [8, 14],
    plotDepth: [9, 13],
    square: [28, 20],
    lampEvery: 30,
    maxSlope: 0.55,
    mainHouses: true,
    blocks: true,
    frontage: 0.45,
  }),
  hamlet: Object.freeze({
    block: 58,
    crossFrom: 0,
    crossTo: 0,
    rows: [-1, 1],
    streetWidth: 4.6,
    pavement: 1.6,
    garden: 3,
    gap: [6, 12],
    plotWidth: [10, 16],
    plotDepth: [10, 15],
    square: null,
    lampEvery: 40,
    maxSlope: 0.4,
    mainHouses: false,
    blocks: false,
  }),
});
