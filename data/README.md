# Ward data inputs

The all-ward sync writes `lib/data/ward-metrics.generated.json`.

It can fetch two data groups directly:

- Geography: Greater London Authority ward GeoJSON
- Reported crime: data.police.uk, latest available month, one-mile radius around the ward reference point
- Commute: TfL Journey Planner, using `TFL_APP_KEY`

Two normalised official-data inputs are intentionally separate so the app does not invent values:

## `data/ons-rents-by-borough.json`

Use the latest ONS Price Index of Private Rents local-authority values by bedroom count. Shape:

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

Values are average monthly private rent in GBP. A ward inherits its borough/local-authority rent value and the UI must label that geography honestly.

## `data/ward-profiles.json`

Use verified GLA / ONS ward-level evidence. Shape:

```json
{
  "WARD_CODE": {
    "summary": "35–60 word factual summary based only on the supplied evidence.",
    "tags": ["..."],
    "source": "GLA / ONS"
  }
}
```

Do not infer stereotypes or demographic claims that are absent from the source data.
