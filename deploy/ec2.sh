#!/usr/bin/env bash
# Create and manage the EC2 instance for the AgClimate AF web app.
#
#   deploy/ec2.sh create     role + firewall + instance + fixed IP (safe to re-run)
#   deploy/ec2.sh status     instance state, IP, how to connect
#   deploy/ec2.sh stop       stop the instance (no compute charges; disk and IP still cost a little)
#   deploy/ec2.sh start      start it again
#   deploy/ec2.sh destroy    terminate the instance, release the IP, delete the firewall group
#
# Settings (environment variables, all optional):
#   AWS_REGION=af-south-1  INSTANCE_TYPE=t3.medium  DISK_GB=30  APP_NAME=agclimateaf-app
#   S3_BUCKET=agclimateaf-953975492473-af-south-1-an   SUBNET_ID=<public subnet, if no default VPC>
# Graviton: INSTANCE_TYPE=t4g.medium (the ARM image is picked automatically).
set -euo pipefail
export MSYS_NO_PATHCONV=1            # Git Bash: don't rewrite /aws/... or /dev/xvda

HERE="$(cd "$(dirname "$0")" && pwd)"
export AWS_REGION="${AWS_REGION:-af-south-1}" AWS_DEFAULT_REGION="${AWS_REGION:-af-south-1}"
NAME="${APP_NAME:-agclimateaf-app}"
ROLE="${APP_ROLE:-AgClimateAF-App-EC2}"
TYPE="${INSTANCE_TYPE:-t3.medium}"
DISK="${DISK_GB:-30}"
BUCKET="${S3_BUCKET:-agclimateaf-953975492473-af-south-1-an}"
SUBNET="${SUBNET_ID:-}"

log() { echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
none() { [[ -z "$1" || "$1" == "None" || "$1" == "null" ]]; }
fileuri() {   # file:// URI the AWS CLI understands on Windows and Linux
  if command -v cygpath >/dev/null 2>&1; then echo "file://$(cygpath -m "$1")"; else echo "file://$1"; fi
}
tmpfile() { mktemp "${TMPDIR:-/tmp}/agclimate-ec2.XXXXXX"; }

instance_id() {
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[0].InstanceId | [0]' --output text
}
eip_alloc() {
  aws ec2 describe-addresses --filters "Name=tag:Name,Values=$NAME" --query 'Addresses[0].AllocationId' --output text
}

# ------------------------------------------------------------------ steps
ensure_role() {
  if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
    log "role $ROLE exists"
  else
    log "creating role $ROLE"
    aws iam create-role --role-name "$ROLE" --description "AgClimate AF web app: read published/*" \
      --assume-role-policy-document \
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  fi
  local pol; pol="$(tmpfile)"
  sed "s/agclimateaf-953975492473-af-south-1-an/$BUCKET/g" "$HERE/iam-ec2-app-policy.json" > "$pol"
  aws iam put-role-policy --role-name "$ROLE" --policy-name ReadPublished --policy-document "$(fileuri "$pol")"
  rm -f "$pol"
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore     # shell access via Session Manager
  if ! aws iam get-instance-profile --instance-profile-name "$ROLE" >/dev/null 2>&1; then
    log "creating instance profile $ROLE"
    aws iam create-instance-profile --instance-profile-name "$ROLE" >/dev/null
  fi
  local roles
  roles="$(aws iam get-instance-profile --instance-profile-name "$ROLE" --query 'InstanceProfile.Roles[].RoleName' --output text)"
  if [[ " $roles " != *" $ROLE "* ]]; then
    aws iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"
  fi
  log "role ready (read s3://$BUCKET/published/* + Session Manager)"
}

ensure_network() {
  if [[ -n "$SUBNET" ]]; then
    VPC="$(aws ec2 describe-subnets --subnet-ids "$SUBNET" --query 'Subnets[0].VpcId' --output text)"
  else
    VPC="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
    none "$VPC" && die "no default VPC in $AWS_REGION. Re-run with SUBNET_ID=<a public subnet>, e.g. one used by the Batch compute environment"
  fi
  SG="$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$NAME" "Name=vpc-id,Values=$VPC" \
        --query 'SecurityGroups[0].GroupId' --output text)"
  if none "$SG"; then
    log "creating firewall group $NAME (ports 80, 443)"
    SG="$(aws ec2 create-security-group --group-name "$NAME" --description "AgClimate AF web app" \
          --vpc-id "$VPC" --query GroupId --output text)"
    aws ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions \
      'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' \
      'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]' >/dev/null
  else
    log "firewall group $SG exists"
  fi
}

ensure_instance() {
  ID="$(instance_id)"
  if ! none "$ID"; then
    local state; state="$(aws ec2 describe-instances --instance-ids "$ID" --query 'Reservations[0].Instances[0].State.Name' --output text)"
    log "instance $ID exists ($state)"
    if [[ "$state" == "stopped" ]]; then aws ec2 start-instances --instance-ids "$ID" >/dev/null; fi
    aws ec2 wait instance-running --instance-ids "$ID"
    return
  fi
  local arch=x86_64
  [[ "$TYPE" =~ ^[a-z]+[0-9]+g ]] && arch=arm64
  local ami
  ami="$(aws ssm get-parameter --name "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-$arch" \
         --query Parameter.Value --output text)"
  log "launching $TYPE ($arch, Amazon Linux 2023 $ami, ${DISK} GB)"
  local subnet_arg=()
  [[ -n "$SUBNET" ]] && subnet_arg=(--subnet-id "$SUBNET" --associate-public-ip-address)
  local try
  for try in 1 2 3 4 5 6; do
    # a newly created instance profile takes a few seconds to become usable
    if ID="$(aws ec2 run-instances --image-id "$ami" --instance-type "$TYPE" \
          --iam-instance-profile "Name=$ROLE" --security-group-ids "$SG" "${subnet_arg[@]}" \
          --block-device-mappings "DeviceName=/dev/xvda,Ebs={VolumeSize=$DISK,VolumeType=gp3,Encrypted=true}" \
          --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2 \
          --user-data "$(fileuri "$HERE/ec2-user-data.sh")" \
          --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
          --query 'Instances[0].InstanceId' --output text 2>"${TMPDIR:-/tmp}/agclimate-ec2.err")"; then
      break
    fi
    if grep -qi "instance profile" "${TMPDIR:-/tmp}/agclimate-ec2.err" && [[ $try -lt 6 ]]; then
      log "instance profile not ready yet, retrying in 10 s"; sleep 10
    else
      cat "${TMPDIR:-/tmp}/agclimate-ec2.err" >&2; die "run-instances failed"
    fi
  done
  log "waiting for $ID to start"
  aws ec2 wait instance-running --instance-ids "$ID"
}

ensure_ip() {
  local alloc; alloc="$(eip_alloc)"
  if none "$alloc"; then
    log "allocating a fixed public IP"
    alloc="$(aws ec2 allocate-address --domain vpc \
      --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" --query AllocationId --output text)"
  fi
  local attached; attached="$(aws ec2 describe-addresses --allocation-ids "$alloc" --query 'Addresses[0].InstanceId' --output text)"
  if [[ "$attached" != "$ID" ]]; then
    aws ec2 associate-address --instance-id "$ID" --allocation-id "$alloc" >/dev/null
  fi
  IP="$(aws ec2 describe-addresses --allocation-ids "$alloc" --query 'Addresses[0].PublicIp' --output text)"
}

summary() {
  cat <<EOF

Instance  : $ID ($TYPE, $AWS_REGION)
Public IP : $IP

Next:
 1. Wait ~3 minutes for first-boot setup (Docker, Compose, swap).
 2. Open a shell: EC2 console -> Instances -> $NAME -> Connect -> Session Manager -> Connect
    https://$AWS_REGION.console.aws.amazon.com/ec2/home?region=$AWS_REGION#ConnectToInstance:instanceId=$ID
 3. In that shell (see README "Deploying on EC2"):
      sudo su - ec2-user
      docker compose version          # confirms setup finished
      git clone <your repo> agclimate_app && cd agclimate_app/deploy
      cp .env.example .env && nano .env   # DOMAIN=:80 until you have a domain
      docker compose up -d --build
 4. Open http://$IP
    With a domain: DNS A record -> $IP, set DOMAIN=<name> in .env, docker compose up -d
EOF
}

# ------------------------------------------------------------------ commands
cmd="${1:-create}"
command -v aws >/dev/null || die "AWS CLI not found"
case "$cmd" in
  create)
    aws sts get-caller-identity --query Account --output text >/dev/null || die "AWS credentials not working"
    ensure_role; ensure_network; ensure_instance; ensure_ip; summary ;;
  status)
    ID="$(instance_id)"; none "$ID" && die "no instance named $NAME in $AWS_REGION (run: deploy/ec2.sh create)"
    aws ec2 describe-instances --instance-ids "$ID" \
      --query 'Reservations[0].Instances[0].[InstanceId,InstanceType,State.Name,PublicIpAddress]' --output text
    alloc="$(eip_alloc)"; if ! none "$alloc"; then
      IP="$(aws ec2 describe-addresses --allocation-ids "$alloc" --query 'Addresses[0].PublicIp' --output text)"; echo "Fixed IP: $IP"; fi ;;
  stop)
    ID="$(instance_id)"; none "$ID" && die "no instance"; aws ec2 stop-instances --instance-ids "$ID" >/dev/null
    log "stopping $ID" ;;
  start)
    ID="$(instance_id)"; none "$ID" && die "no instance"; aws ec2 start-instances --instance-ids "$ID" >/dev/null
    aws ec2 wait instance-running --instance-ids "$ID"; log "$ID running" ;;
  destroy)
    ID="$(instance_id)"
    read -r -p "Terminate ${ID:-<none>}, release its IP and delete firewall group $NAME? Type yes: " ok
    [[ "$ok" == "yes" ]] || die "cancelled"
    alloc="$(eip_alloc)"
    if ! none "$alloc"; then
      assoc="$(aws ec2 describe-addresses --allocation-ids "$alloc" --query 'Addresses[0].AssociationId' --output text)"
      none "$assoc" || aws ec2 disassociate-address --association-id "$assoc"
      aws ec2 release-address --allocation-id "$alloc"; log "released IP"
    fi
    if ! none "$ID"; then
      aws ec2 terminate-instances --instance-ids "$ID" >/dev/null
      aws ec2 wait instance-terminated --instance-ids "$ID"; log "terminated $ID"
    fi
    for sg in $(aws ec2 describe-security-groups --filters "Name=group-name,Values=$NAME" --query 'SecurityGroups[].GroupId' --output text); do
      aws ec2 delete-security-group --group-id "$sg" && log "deleted $sg"
    done
    log "kept IAM role $ROLE (harmless; delete in IAM if no longer needed)" ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
