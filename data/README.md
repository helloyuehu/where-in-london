# Ward data inputs

The all-ward sync writes `lib/data/ward-metrics.generated.json` and the app automatically uses complete generated wards when available.

## Geography

Official Greater London Authority ward polygons.

## Reported crime

`data.police.uk` street-level crime, latest available month, using the standard one-mile radius around each ward reference point.

## Commute

Transport for London Journey Planner API. Put your personal TfL key in `.env.local`:

```bash
TFL_APP_KEY=your_key_here
WORK_POSTCODE=W1D 3QW
ARRIVE_BY=09:00
SYNC_CONCURRENCY=4
```

`.env.local` is gitignored and must never be committed.

Then run:

```bash
npm run sync:wards
```

## Rent

Use the latest ONS Price Index of Private Rents property-size data. ONS publishes bedroom-level average private rents for local authorities in England and Wales. A ward therefore inherits its borough/local-authority rent value, and the UI must describe that as a borough-level proxy rather than a ward measurement.

Normalised file: `data/ons-rents-by-borough.json`

```json
{
  "Camden": {
    "studio": 0,
    "1": 0,
    "2": 0,
    "3": 0,
    "4+": 0
  }
}
```

## Area profile

Use current official GLA / ONS ward evidence. Suitable factual inputs include the London Datastore Census 2021 ward tables for population by age, household composition, accommodation type and tenure. Summaries should only compress supplied evidence and must not infer stereotypes.

Normalised file: `data/ward-profiles.json`

```json
{
  "WARD_CODE": {
    "summary": "35–60 word factual summary based only on the supplied evidence.",
    "tags": ["..."],
    "source": "GLA Census 2021 ward estimates / ONS"
  }
}
```

The sync marks a ward `complete` only when crime, public-transport commute, walking commute, rent and profile are all present. Incomplete wards remain visually labelled as not evaluated rather than receiving fabricated values.
