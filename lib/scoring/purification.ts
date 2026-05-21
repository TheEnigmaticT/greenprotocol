export const calculatePurificationBurden = (protocol) => {
  // Logic to estimate wash-step count and isolation friction
  return { score: 0.5, metrics: { washes: 2, isolations: 1 } };
};
