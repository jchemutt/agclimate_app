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

Until its first run is published, the country shows as "No forecast published yet". An invalid profile never breaks the other countries; it's listed under `invalid_profiles` in `/api/v1/health`.

## API (for this app and for other systems)

Everything is under `/api/v1`, documented in Swagger at **`/api/docs`** (ReDoc at
`/api/redoc`, OpenAPI 3.1 JSON at `/api/openapi.json`). Each endpoint has a stable
`operationId`, so clients can be generated with OpenAPI Generator or `openapi-typescript`.
Use `latest` for the newest run, or a date such as `2026-10-01`. Dated runs never
change, so they are served with immutable cache headers.

| Endpoint | Use |
|---|---|
| `GET /countries` | countries and their latest run |
| `GET /countries/{cid}` | the country profile |
| `GET /countries/{cid}/runs` | published runs, newest first |
| `GET /countries/{cid}/runs/{init}` | one run: layers, legends, COG links, admin levels |
| `GET /countries/{cid}/runs/{init}/areas/{level}` | every area's values; `?q=` name search, `?parent=` filter, `?format=csv` spreadsheet |
| `GET /countries/{cid}/runs/{init}/areas/{level}/{area_id}?lang=sw` | **one area's outlook as text**: advisory class and message, every layer with title, class name or date (for chatbots, SMS, other platforms) |
| `GET /countries/{cid}/runs/{init}/point?lat=&lon=&lang=` | the same for a location, plus each ensemble member's value and the tercile thresholds |
| `GET /countries/{cid}/boundaries/{level}` | GeoJSON boundaries (`id` matches the area ids) |
| `GET /files/{cid}/{init}/layers/{id}.tif` | layer COGs (HTTP Range supported: QGIS/GDAL can read them directly) |
| `GET /health` | status, loaded countries, invalid profiles |

Code layout (`api/app/`):

```
core/       config, storage (local folder or S3, disk cache), country profiles, shared dependencies
services/   joining profiles with published runs, text outlooks and CSV, point reads
schemas/    response models: the public contract shown in Swagger
routers/    one module per resource (countries, runs, areas, points, files, system)
main.py     application factory: metadata, middleware, routers
```

To add an endpoint, add a model in `schemas/`, the logic in `services/`, and a route in
`routers/` (or a new router registered in `main.py`). A future breaking change goes in
a new `routers/v2` with prefix `/api/v2`, while `/api/v1` keeps working.

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

## Try it on your own machine first

With Docker Desktop running, unzip the demo data (or real published output) into `deploy/`, so that you have `deploy/demo_published/kenya/...`. Then:

```bash
cd deploy
echo "DOMAIN=:80" > .env
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Open http://localhost. To stop it: `docker compose down`.

## Server size and scaling

The app is light. Everything it serves is precomputed files from S3, cached on the
instance's disk. There's no database and no on-the-fly raster processing.

| Stage | Instance | Notes |
|---|---|---|
| Pilot, 1–3 countries | **t3.medium** (2 vCPU, 4 GB), 30 GB gp3 | Recommended start. A t3.small (2 GB) runs it but is tight while building images. **t4g.medium** (Graviton) is cheaper for the same capacity; see below. |
| National rollout, 5–15 countries, heavier integration use | t3.large (8 GB), `API_WORKERS=2` + **CloudFront** in front | |
| Continental, or sustained high traffic | Same containers on **ECS Fargate behind a load balancer** (2+ API tasks, auto-scaling) | The API keeps no state between requests, so no code change. |

Rough memory use: each API worker ~200–300 MB, Next.js ~150 MB, Caddy ~30 MB. Peak is
during `docker compose build`, which is why the setup script adds 2 GB of swap. Disk: the
cache grows by one run per country per month (Kenya ≈ 12 MB per run; an Africa-wide
0.1° run would be around 1 GB, mostly the members file).

**The biggest scaling step is CloudFront, not a bigger instance.** Put a CloudFront
distribution in front of the whole site (origin: the instance). Dated runs, layer files
and boundaries are cacheable, so most requests are then served from the CDN edge and
the instance mostly answers `latest` and point queries. A CDN also helps users on slow
mobile connections, because the boundaries and layers come from the edge closest to them.

**Graviton (t4g):** the Python, Node and Caddy images are multi-architecture, and the
setup script detects the CPU type. Use `--instance-type t4g.medium` and the arm64 image:
`/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64`.

## Deploying on EC2 (af-south-1)

One script creates everything, from Git Bash with your admin AWS credentials:

```bash
deploy/ec2.sh create          # role, firewall, t3.medium instance, fixed IP; prints the IP
```

It is safe to re-run: it reuses whatever already exists. The pieces:
- an **IAM role** that can only read `s3://<bucket>/published/*`, plus Session Manager for shell access (no SSH keys, no port 22);
- a **firewall group** with only ports 80 and 443 open;
- an **Amazon Linux 2023** instance (30 GB encrypted disk) that installs Docker and Compose on first boot (`ec2-user-data.sh`);
- an **Elastic IP**, so the address never changes.

Options: `INSTANCE_TYPE=t4g.medium deploy/ec2.sh create` for Graviton; `SUBNET_ID=subnet-...` if the account has no default VPC; `S3_BUCKET=...` for another bucket. Other commands: `deploy/ec2.sh status`, `stop`, `start`, `destroy`.

Then open a shell on the instance. In the EC2 console select **agclimateaf-app**, then **Connect** → **Session Manager** → **Connect**. Allow a few minutes after launch for the setup script to finish.

```bash
sudo su - ec2-user
# get the code: push this repo to GitHub first, then add the instance as a read-only deploy key
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
#   -> GitHub repo -> Settings -> Deploy keys -> Add (paste the key, leave write access off)
git clone git@github.com:<you>/agclimate_app.git && cd agclimate_app/deploy
cp .env.example .env && nano .env      # DOMAIN=:80 until you have a domain name
docker compose up -d --build           # first build takes ~5-10 minutes
docker compose logs api | grep -i profiles   # "Profiles loaded: kenya"
```

The app is then at `http://<the Elastic IP>`. It shows "No forecast published yet" until the first monthly run has published.

**HTTPS with a domain:** create a DNS A record (e.g. `outlook.yourdomain.org`) pointing at the Elastic IP. Set `DOMAIN=outlook.yourdomain.org` in `.env` and run `docker compose up -d`; Caddy gets the certificate by itself.

**Updates:** run `git pull && docker compose up -d --build`. For a profile change, `git pull` is enough.

Optional CloudFront: put a distribution in front of `s3://<bucket>/published` and set `PUBLIC_DATA_URL=https://<id>.cloudfront.net`. Layer files are then served from the edge instead of the EC2 instance. The S3 bucket CORS (or a CloudFront response-headers policy) must allow `GET` and `Range` from your domain.

## Notes

- Maps are drawn in the browser from the published COGs (OpenLayers WebGL), so no tile server is needed. Kenya at 0.1° is about 86×106 pixels per layer.
- The basemap is CARTO Positron (OpenStreetMap data), and needs its attribution. Set `map.basemap` in a profile to use another XYZ source.
- The interface has its own strings in `web/lib/i18n.ts` (English and Kiswahili). Add a block there to support another language; country content comes from the profile.
- Kiswahili text in `profiles/kenya.yaml` is a draft for review by KMD or extension staff.
