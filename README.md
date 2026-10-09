# London Rental Fit

A map-first decision-support prototype for exploring which official London wards fit commute, rent, bedroom and reported-crime constraints.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The product now loads every official GLA London ward. Wards can be selected even while individual metrics are still being refreshed.

## Default search

- Work postcode: `W1D 3QW`
- Arrive by: `09:00`
- Public transport and walking supported

The work postcode is geocoded through Postcodes.io and shown on the map.

## Official data sources

- Geography: Greater London Authority, London Wards (2022)
- Commute: Transport for London Journey Planner API
- Reported crime: Police.uk street-level crime, one-mile radius around each ward reference point
- Rent: ONS Price Index of Private Rents, local-authority averages by bedroom count

Rent is intentionally labelled at borough/local-authority level rather than pretending it is a ward-level measurement.

## Refresh every ward

Run:

```bash
npm run sync:wards
```

The sync script:

1. loads every official London ward;
2. calculates a reference point for each ward;
3. fetches the latest Police.uk reported-crime count;
4. calculates TfL public-transport and walking journeys to `W1D 3QW`;
5. downloads and normalises the latest ONS rent workbook;
6. writes `lib/data/ward-metrics.generated.json`.

A TfL API key is optional. If `TFL_APP_KEY` is absent, the script uses anonymous access with conservative throttling. To use a registered key, create `.env.local`:

```bash
TFL_APP_KEY=your_key
WORK_POSTCODE=W1D 3QW
ARRIVE_BY=09:00
SYNC_CONCURRENCY=6
```

`.env.local` is gitignored.

## Automatic refresh

`.github/workflows/refresh-ward-metrics.yml` runs the same pipeline monthly and can also be started manually in GitHub Actions. It validates a production build before committing refreshed metrics.

## Data honesty

If a source is unavailable, the UI shows `Data pending` instead of inventing a value. Changing the destination postcode also invalidates precomputed commute values until they are recalculated for that destination.
