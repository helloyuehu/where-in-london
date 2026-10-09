# London Rental Fit · V1

A map-first prototype for exploring which parts of Greater London fit a renter's commute, rent, bedroom and reported-crime constraints.

## What is real in V1

- The app is a working Next.js + TypeScript product shell.
- The map uses MapLibre GL JS.
- `/api/geography/london` proxies official Greater London Authority geography at runtime:
  - Greater London Boundary, GLA FeatureServer layer 303
  - London Wards, GLA MapServer layer 3
- Filter logic, map/result selection, ranking and "almost matches" behaviour are real application logic.
- Data-source adapter contracts are already separated for commute, crime, rent and postcode geocoding.

## What is intentionally fixture data

The commute times, route legs, reported-crime counts, rents and area summaries in `lib/data/areas.ts` are demo fixtures. The UI labels this clearly. Do not present these values as factual until the real adapters are connected.

The first implementation treats neighbourhoods as curated reference points while official ward polygons are shown as background geography. This avoids inventing neighbourhood boundaries.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## V1 product behaviour

- Enter a work postcode.
- Set maximum commute time and select Transit and/or Walk.
- Set arrive-by time.
- Set monthly rent range.
- Select bedroom count.
- Set maximum monthly reported-crime count.
- Matching areas appear on the map and in the results list.
- Areas that miss exactly one criterion appear under "Almost matches".
- Clicking a result focuses its map point. Clicking a map point selects its result.

When Transit and Walk are both selected, commute filtering uses **OR** logic. An area qualifies if either selected mode is within the maximum time.

## Next implementation phases

1. **Postcodes.io** adapter for validation/geocoding of the user's work postcode.
2. **TfL Journey Planner** adapter for real public-transport and walking journeys, including route legs and arrive-by time.
3. **Police.uk** adapter for latest-month street-level reported-crime counts around each reference point.
4. **ONS private rent** ingestion and borough/local-authority mapping by bedroom count.
5. Grounded area-summary pipeline using source packets, with claim-level source references.
6. Cache expensive commute calculations by destination + origin + arrive-by time + mode.

## Geography sources

Official GLA runtime endpoints are defined in `app/api/geography/london/route.ts`. The server proxy requests GeoJSON in WGS84 (`outSR=4326`) so MapLibre can render it directly.

## Deployment

The project is deployable to Vercel. No environment variables are needed for this fixture-data V1. Real TfL integration will require adding credentials securely on the server side.
