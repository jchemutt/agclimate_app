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

## Try it on your own machine first

With Docker Desktop running, unzip the demo data (or real published output) into `deploy/`, so that you have `deploy/demo_published/kenya/...`. Then:

```bash
cd deploy
echo "DOMAIN=:80" > .env
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Open http://localhost. To stop it: `docker compose down`.

## Deploying on EC2 (af-south-1)

Run these once, from Git Bash in `deploy/`, with your admin AWS credentials:

```bash
export AWS_REGION=af-south-1 MSYS_NO_PATHCONV=1

# 1. Instance role: read published/* only, plus Session Manager for shell access (no SSH)
aws iam create-role --role-name AgClimateAF-App-EC2 --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam put-role-policy --role-name AgClimateAF-App-EC2 --policy-name ReadPublished \
  --policy-document file://iam-ec2-app-policy.json
aws iam attach-role-policy --role-name AgClimateAF-App-EC2 \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam create-instance-profile --instance-profile-name AgClimateAF-App-EC2
aws iam add-role-to-instance-profile --instance-profile-name AgClimateAF-App-EC2 --role-name AgClimateAF-App-EC2

# 2. Firewall: web traffic only
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 create-security-group --group-name agclimateaf-app --description "AgClimate AF web app" \
  --vpc-id "$VPC" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions \
  'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' \
  'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]'

# 3. The instance (Amazon Linux 2023, t3.small, 30 GB). Hop limit 2 lets the API
#    container reach the instance role's credentials.
AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query Parameter.Value --output text)
ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.small \
  --iam-instance-profile Name=AgClimateAF-App-EC2 --security-group-ids "$SG" \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=30,VolumeType=gp3}' \
  --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2 \
  --user-data file://ec2-user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=agclimateaf-app}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$ID"

# 4. A fixed public IP
EIP=$(aws ec2 allocate-address --query AllocationId --output text)
aws ec2 associate-address --instance-id "$ID" --allocation-id "$EIP"
aws ec2 describe-addresses --allocation-ids "$EIP" --query 'Addresses[0].PublicIp' --output text
```

If `run-instances` says the instance profile is invalid, wait 10 seconds and run it again; new IAM roles take a moment to become usable. If `describe-vpcs` returns `None`, there is no default VPC: use the VPC and a public subnet of your Batch compute environment, and add `--subnet-id <subnet>` to `run-instances`.

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
