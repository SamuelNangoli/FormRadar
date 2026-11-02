export function displayPercentages(probabilities) {
  const values = [probabilities.home, probabilities.draw, probabilities.away];
  const scaled = values.map((v) => v * 100);
  const result = scaled.map(Math.floor);
  const order = scaled.map((v,i) => ({ i, fraction: v - result[i] })).sort((a,b) => b.fraction-a.fraction);
  const deficit = 100-result.reduce((a,b) => a+b,0);
  for (let n=0; n<deficit; n++) result[order[n].i]++;
  return result;
}
