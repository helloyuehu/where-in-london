const originalFetch = globalThis.fetch;

const LONDON_BOROUGHS = new Set([
  "barking and dagenham", "barnet", "bexley", "brent", "bromley", "camden", "city of london",
  "croydon", "ealing", "enfield", "greenwich", "hackney", "hammersmith and fulham", "haringey",
  "harrow", "havering", "hillingdon", "hounslow", "islington", "kensington and chelsea", "kingston upon thames",
  "lambeth", "lewisham", "merton", "newham", "redbridge", "richmond upon thames", "southwark", "sutton",
  "tower hamlets", "waltham forest", "wandsworth", "westminster",
]);

function normalise(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/^royal borough of /, "")
    .replace(/^london borough of /, "")
    .replace(/^city of westminster$/, "westminster")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isWardLayer(url) {
  return url.includes("gis.london.gov.uk") && url.includes("MapServer/9/query");
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const response = await originalFetch(input, init);

  if (!isWardLayer(url) || !response.ok) return response;

  const payload = await response.json();
  const originalCount = Array.isArray(payload?.features) ? payload.features.length : 0;
  const features = (payload?.features || []).filter((feature) => {
    const properties = feature?.properties || {};
    const borough = properties.la_name || properties.LA_NAME || properties.lad22nm || properties.LAD22NM;
    return LONDON_BOROUGHS.has(normalise(borough));
  });

  console.log(`London geography guard: ${originalCount} source features → ${features.length} Greater London wards.`);

  return new Response(JSON.stringify({ ...payload, features }), {
    status: response.status,
    statusText: response.statusText,
    headers: { "content-type": "application/json" },
  });
};

await import("./sync-ward-metrics.mjs");
