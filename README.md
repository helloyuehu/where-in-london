# where-in-london

**Where in London?**  
*Find areas that fit your priorities.*

A map-first decision-support prototype for exploring where to live in London using commute, rent, bedroom and reported-crime constraints.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## How it works

The prototype evaluates 80 London living areas and shows Match, Almost and Doesn't match states across a full-city map. Selecting an area on the map focuses the corresponding result card, and selecting a result card focuses the map.

Commute is currently an explicit distance-based estimate so the decision loop remains fast and usable. The work postcode is geocoded through Postcodes.io.

## Data sources

- Geography: Greater London Authority official ward geography
- Rent: ONS Price Index of Private Rents, local-authority averages by bedroom count
- Reported crime: Police.uk reported-crime data around each area reference point
- Postcodes: Postcodes.io

Rent is intentionally presented at borough/local-authority level rather than implying ward-level precision. Reported-crime values are treated as reported incidents, not as a safety score.

## Prototype approach

The map groups official London wards around 80 representative living-area anchors to provide full-city coverage. These groupings are a prototype decision layer rather than a new official geography.

The product prioritises transparent constraints over a single opaque score: users can see which criteria an area passes, which one it nearly misses, and the underlying rent, commute and reported-crime values.
