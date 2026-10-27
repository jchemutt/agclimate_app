# AgClimate AF web app

Interactive seasonal outlooks from the AgClimate AF pipeline. The app has a
map of each forecast layer, County / Sub-county / Ward summaries, the ensemble
spread at any point, and advisory text in the country's languages.

```
 S3  published/<country>/...        written by agclimate-prep `publish`
   │  (read-only instance role)
   ▼
 api   FastAPI   profiles/<country>.yaml  +  published catalog   →  /api/...
 web   Next.js   map (OpenLayers draws the COGs in the browser), panels
 caddy           HTTPS; /api → api, everything else → web
```

## Country profiles: adding a country without code changes

Everything country-specific lives in `profiles/<id>.yaml`:
- names and languages;
- map view;
- admin-level labels (County / Sub-county / Ward, or Province / District / Sector);
- season names per forecast start month;
- the layer menu, plus title and class translations;
- advisory messages per class;
- links and attribution.

`profiles/_template.yaml` documents every option.

To add a country (for example Rwanda):

1. **Pipeline** (agclimate-prep):
   - copy `config/aws_kenya.yaml` to `config/aws_rwanda.yaml`;
   - set `name: rwanda`, the `bbox` and `publish.levels` (e.g. `[province, district, sector]`);
   - build the boundaries GeoPackage with `agclimate-prep boundaries` and upload it with `DOMAIN=rwanda deploy/deploy.sh boundaries rwanda_admin.gpkg`;
   - run the one-off historical step and add a schedule. These steps are in prep's `deploy/README.md`, "Adding a domain".
2. **App**: copy `profiles/_template.yaml` to `profiles/rwanda.yaml` and fill it in. The `id` must equal the pipeline `name`, and the `admin_levels` ids must equal the published levels.
3. Copy the file to the server's `profiles/` folder. The API notices new and changed files on the next request, so no restart is needed.

Until its first run is published, the country shows as "No forecast published yet". An invalid profile never breaks the other countries; it's listed under `invalid_profiles` in `/api/health`.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | status, loaded countries, invalid profiles |
| `GET /api/countries` | country list with the latest run |
| `GET /api/countries/{id}/profile` | the profile |
| `GET /api/countries/{id}/runs` | published runs, newest first, with season names |
| `GET /api/countries/{id}/runs/{init\|latest}` | everything the map needs for one run (layers, legends, groups, admin levels) |
| `GET /api/countries/{id}/runs/{init}/areas/{level}` | per-area summaries |
| `GET /api/countries/{id}/boundaries/{level}` | GeoJSON boundaries |
| `GET /api/countries/{id}/runs/{init}/point?lat=&lon=` | map values and every member at one grid cell (runs published by prep v8+) |
| `GET /api/files/{id}/{init}/layers/...` | layer files when no CloudFront is configured (supports Range requests) |

Interactive docs are at `/api/docs`. Published runs never change, so their responses are cached as immutable; `latest` and the run list refresh every `INDEX_TTL` seconds (default 300).

## Local development

```bash
# API: point it at a folder with published output (published/<country>/...)
cd api && pip install -r requirements.txt
DATA_DIR=/path/to/published PROFILES_DIR=../profiles uvicorn app.main:app --reload --port 8000
python -m pytest -q tests

# Web (proxies /api to the API on :8000)
cd web && npm install && npm run dev     # http://localhost:3000
```

To use S3 instead of a local folder, set `S3_BUCKET=...` and `AWS_REGION=af-south-1` in place of `DATA_DIR`. This needs AWS credentials that can read `published/*`.

## Deploying on EC2

1. **Instance:** a `t3.small` (2 GB) is enough for a few countries; use `t3.medium` with many. Use Amazon Linux 2023 or Ubuntu with Docker and the compose plugin.
2. **IAM:** attach a role with `deploy/iam-ec2-app-policy.json`, which only allows reading `published/*`.
3. **Network:** open ports 80 and 443 in the security group, and point a DNS A record at the instance's Elastic IP.
4. **Start it:**
   ```bash
   git clone <this repo> agclimate_app && cd agclimate_app/deploy
   cp .env.example .env          # set DOMAIN, S3_BUCKET, AWS_REGION
   docker compose up -d --build
   docker compose logs -f api    # "Profiles loaded: kenya"
   ```
   Caddy gets the HTTPS certificate automatically once DNS points at the instance.
5. **Update after code changes:** `git pull && docker compose up -d --build`. Profile edits need no rebuild.

Optional CloudFront: put a distribution in front of `s3://<bucket>/published` and set `PUBLIC_DATA_URL=https://<id>.cloudfront.net`. Layer files are then served from the edge instead of the EC2 instance. The S3 bucket CORS (or a CloudFront response-headers policy) must allow `GET` and `Range` from your domain.

## Notes

- Maps are drawn in the browser from the published COGs (OpenLayers WebGL), so no tile server is needed. Kenya at 0.1° is about 86×106 pixels per layer.
- The basemap is CARTO Positron (OpenStreetMap data), and needs its attribution. Set `map.basemap` in a profile to use another XYZ source.
- The interface has its own strings in `web/lib/i18n.ts` (English and Kiswahili). Add a block there to support another language; country content comes from the profile.
- Kiswahili text in `profiles/kenya.yaml` is a draft for review by KMD or extension staff.
