/** The biome's road colours and shapes as plain data for the road layer (the worker hands it over). */

/**
 * @typedef {{surface: number[], verge: number[], marking: number[], edge: number[], bank: {color: number[], height: number} | null, rut: {color: number[], width: number} | null}} RoadStyle
 * @param {{road: object}} biome
 * @returns {RoadStyle}
 */
export function roadStyle(biome) {
  const { surface, verge, marking, edge, bank = null, rut = null } = biome.road;
  return { surface: [...surface], verge: [...verge], marking: [...marking], edge: [...edge], bank: bank && { color: [...bank.color], height: bank.height }, rut: rut && { color: [...rut.color], width: rut.width } };
}
