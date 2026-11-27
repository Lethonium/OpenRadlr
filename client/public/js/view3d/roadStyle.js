/** The biome's road colours and shapes as plain data for the road layer (the worker hands it over). */

/** Warm grey kerb stone for biomes that name no pavement colour. */
const PAVEMENT = Object.freeze([0.62, 0.6, 0.56]);

/**
 * @typedef {{postWhite: number[], postRed: number[], postDark: number[], postCap: {color: number[]} | null}} PostStyle
 * @typedef {{surface: number[], pavement: number[], verge: number[], marking: number[], edge: number[], bank: {color: number[], height: number} | null, rut: {color: number[], width: number} | null, post: PostStyle}} RoadStyle
 * @param {{road: object}} biome
 * @returns {RoadStyle}
 */
export function roadStyle(biome) {
  const { surface, verge, marking, edge, bank = null, rut = null, pavement = PAVEMENT, postWhite, postRed, postDark, postCap = null } = biome.road;
  return {
    surface: [...surface],
    pavement: [...pavement],
    verge: [...verge],
    marking: [...marking],
    edge: [...edge],
    bank: bank && { color: [...bank.color], height: bank.height },
    rut: rut && { color: [...rut.color], width: rut.width },
    post: { postWhite: [...postWhite], postRed: [...postRed], postDark: [...postDark], postCap: postCap && { color: [...postCap.color] } },
  };
}
