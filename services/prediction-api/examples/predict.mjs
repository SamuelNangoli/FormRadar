// Run on the backend only. Never import this into browser code.
export async function predictMatch(match) {
  const base = process.env.FORMRADAR_API_URL;
  const key = process.env.FORMRADAR_API_KEY;
  if (!base || !key) throw new Error("FormRadar API settings missing");
  const url = new URL("/predict", base);
  if (url.protocol !== "https:" &&
      !(url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname))) {
    throw new Error("Use HTTPS for the prediction service");
  }
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": key,
    },
    body: JSON.stringify(match),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Prediction API returned ${response.status}`);
  }
  return response.json();
}
