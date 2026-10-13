import { mulberry32 } from '../rng.js';

/** 합법수 중 균등 무작위. */
export function createRandomAgent(seed = 1) {
  const rng = mulberry32(seed);
  return {
    name: 'random',
    chooseMove(obs, legalMoves) {
      return legalMoves[Math.floor(rng() * legalMoves.length)];
    },
  };
}
