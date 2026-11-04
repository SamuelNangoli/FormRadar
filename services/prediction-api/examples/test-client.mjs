import { predictMatch } from "./predict.mjs";

const result = await predictMatch({
  home_team: "Arsenal", away_team: "Chelsea",
  home_rating: 1740, away_rating: 1660,
  home_form: 11, away_form: 8,
});
console.log(JSON.stringify(result, null, 2));
