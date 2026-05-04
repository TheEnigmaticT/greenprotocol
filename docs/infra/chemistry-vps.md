# Chemistry Service VPS Runbook

This moves deterministic scoring off the Mac mini and away from `localhost.run`.

## Recommended shape

- Provider: Hetzner Cloud is still the cheapest practical default for this service.
- Size: `CPX11` is enough to start: 2 vCPU, 2 GB RAM, 40 GB NVMe.
- Region: use a US region if most users and Vercel traffic are North American; otherwise Germany/Finland is fine.
- OS: Ubuntu 24.04 LTS.
- DNS: point a subdomain such as `chemistry.greenchemistry.ai` at the VPS IPv4 address.

Hetzner's April 2026 price-adjustment docs list the new US `CPX11` price at `$6.99/mo` excluding VAT. Germany/Finland pricing is lower in euros, but a US region should reduce latency from Vercel US deployments.

## One-time VPS setup

SSH in as root, then install Docker:

```bash
apt-get update
apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Open the firewall:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

## Deploy the service

Clone the repo and configure the service:

```bash
git clone https://github.com/YOUR_ORG/greenchemistry-ai.git /opt/greenchemistry-ai
cd /opt/greenchemistry-ai/services/chemistry
cp env.example .env
cp Caddyfile.example Caddyfile
```

Edit `.env`:

```bash
CHEMISTRY_SERVICE_TOKEN=<long random token>
ANTHROPIC_API_KEY=<optional, but needed for LLM-assisted scoring inputs>
```

Edit `Caddyfile` and replace `chemistry.example.com` with the real hostname.

Start it:

```bash
docker compose up -d --build
docker compose ps
curl https://chemistry.greenchemistry.ai/health
```

Authenticated scoring smoke test:

```bash
curl -X POST https://chemistry.greenchemistry.ai/batch \
  -H "Content-Type: application/json" \
  -H "X-Chemistry-Service-Token: $CHEMISTRY_SERVICE_TOKEN" \
  -d '{"chemicals":[{"chemical_name":"ethanol","quantity":"5 mL"}]}'
```

## Vercel configuration

Set production env vars:

```bash
vercel env add CHEMISTRY_SERVICE_URL production
# value: https://chemistry.greenchemistry.ai

vercel env add CHEMISTRY_SERVICE_TOKEN production
# value: same token as the VPS .env
```

Then redeploy the app:

```bash
vercel deploy --prod
```

## Operations

Update service code:

```bash
cd /opt/greenchemistry-ai
git pull
cd services/chemistry
docker compose up -d --build
docker compose logs --tail=100 chemistry
```

Rollback:

```bash
cd /opt/greenchemistry-ai
git log --oneline -5
git checkout <known-good-sha>
cd services/chemistry
docker compose up -d --build
```

Keep `/health` public for uptime checks. `/convert`, `/batch`, and `/score` require `X-Chemistry-Service-Token` whenever `CHEMISTRY_SERVICE_TOKEN` is set in the service environment.
