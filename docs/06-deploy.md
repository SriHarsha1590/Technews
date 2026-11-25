# Guide 6: Deploy to a server

This deployment puts Caddy, the web app, API, worker, MongoDB, and Redis on one Linux server. Only ports 80 and 443 are published. Production orchestration uses a managed Temporal namespace.

## AWS EC2 layout

For the first invited beta, run this Compose stack on one EC2 instance. Choose the AWS Region and instance size after setting a monthly budget and measuring a staging build and load; this repository has no traffic measurements that justify a fixed size. Use an Ubuntu LTS image supported by Docker Engine, a persistent EBS volume for Docker's named volumes, and off-host MongoDB backups in S3. If Docker data stays on the root EBS volume, terminating the instance may also delete that volume depending on its **Delete on termination** setting. Do not treat an EBS volume or snapshot as a substitute for the MongoDB restore drill below.

1. In EC2, create a security group allowing inbound TCP 80 and 443 from readers and TCP 22 only from the operator's IP. Keep 4000, 27017, and 6379 closed to the internet. Attach a least-privilege instance role with access to the specific S3 backup bucket; do not place AWS access keys in `.env.production`.
2. Launch the instance in a public subnet, attach the EBS storage, and associate an Elastic IP. Create a domain A record pointing at that address. Add an AAAA record only after IPv6 routing and firewall rules are working. Caddy needs the domain and inbound 80/443 to issue and renew HTTPS certificates.
3. Install Docker Engine and its Compose plugin from Docker's repository, plus Git and AWS CLI v2. Verify `docker compose version` and that the operator can run Docker commands. Put the tested release revision in a dedicated directory on the instance; do not deploy an uncommitted worktree.
4. Provision the managed Temporal namespace, Firebase authorized domain, Gemini key, VAPID keys, S3 bucket, and alert destination. Fill `.env.production` from the template with `chmod 600`. Run `docker compose -f docker-compose.prod.yml --env-file .env.production config --quiet` before starting the stack. Then run the `up -d --build` command below from that exact release directory.
5. Verify the live health endpoint, a completed pipeline run, real reader and admin flows, an uploaded and restored backup, and a delivered alert before inviting readers. Install a host backup timer for `deploy/backup.sh`; the application containers do not schedule host backups themselves.

This is a manual EC2 deployment. The repository's CI workflow checks code but does not provision AWS resources or deploy a release. An invited beta on a public domain is still publicly reachable unless access control is added; decide how beta access will be enforced before sharing the address.

Use the current [AWS security-group guidance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html), [EC2 IAM-role instructions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/attach-iam-role.html), [Route 53 EC2 instructions](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-ec2-instance.html), and [Docker Engine installation instructions](https://docs.docker.com/engine/install/ubuntu/) when provisioning the host.

## Prerequisites

- Docker Engine with Compose, a domain with DNS pointed at the server, and the Firebase, Gemini, and VAPID settings from the earlier guides.
- A managed Temporal namespace, address, and API key. Set its network access policy to admit the server.
- A private S3 bucket with versioning and lifecycle retention, plus an instance role or AWS profile that can write and read backups. Install AWS CLI v2 on the server.
- A central log collector and on-call notification destination. Enable private vulnerability reporting and a monitored contact in repository settings before launch.

## Start

1. Copy this repository to the server. Keep `.env.production`, `node_modules`, and backups out of source control.
2. `cp .env.production.example .env.production && chmod 600 .env.production`. Fill every required field. Generate distinct passwords with `openssl rand -hex 32`. URL-safe characters are required for the Mongo application password embedded in `MONGO_URL`.
3. In Firebase Authentication, add the domain under **Authorized domains**.
4. Start: `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`.
5. Check `https://YOUR_DOMAIN/api/v1/health` and `docker compose -f docker-compose.prod.yml --env-file .env.production ps`. The API and worker images run compiled JavaScript as an unprivileged user. Both images have health checks; Compose starts them after Mongo and Redis health checks pass.
6. Verify a story enters the feed, a Temporal schedule is present, and the backup and alert jobs below work. If an existing Mongo volume predates `deploy/mongo-init.js`, the application user is **not** created automatically; create it in `technews` with `readWrite` before starting API and worker.

## Backups and recovery

`deploy/backup.sh` streams a compressed Mongo dump directly to `BACKUP_S3_URI`; it does not rely on a local backup volume. Schedule it on the host, for example with a systemd timer or cron entry `0 2 * * * /path/to/technews/deploy/backup.sh`. The host's AWS credentials need only bucket read/write permissions. Enable bucket versioning, encryption, lifecycle retention, and an independent access policy. Monitor exit status and object age; a configured backup destination is not proof of a recoverable backup.

Mongo initialization also creates a separate backup/restore user. The backup tools read its password from a temporary file with restricted permissions rather than process arguments. Existing volumes need this user provisioned manually alongside the application user. See MongoDB's [backup roles](https://www.mongodb.com/docs/manual/reference/built-in-roles/) and [tool configuration](https://www.mongodb.com/docs/database-tools/mongodump/).

For a restore drill, stop API and worker (`docker compose ... stop api worker`), take a fresh backup, and run `deploy/restore.sh s3://BUCKET/PATH/technews-TIMESTAMP.archive.gz` against a disposable deployment. The script uses `mongorestore --drop`, replacing collections in `technews`. Check story counts, saved cards, and API health before restarting traffic. Practice this against a separate server at least monthly. Never run a drill against production data.

## Monitoring and alerts

Deploy the optional [Fluentd logging override](../deploy/docker-compose.logging.yml) with an off-host Fluentd collector by setting `FLUENTD_ADDRESS` and including `-f deploy/docker-compose.logging.yml` in the Compose command. The collector must forward JSON logs to a durable searchable sink and route the [alert rules](../deploy/alerts.yaml) to the on-call destination. Worker logs emit `pipeline_failed`, `pipeline_ai_cap`, and `pipeline_completed`; API metrics and error events should be mapped to the same sink. Import [Loki alert rules](../deploy/alerts.yaml) and [Prometheus alert rules](../deploy/prometheus-alerts.yml) into the monitoring stack. Scrape the API’s internal `/api/v1/metrics` endpoint every minute from the Compose network; it must not be published publicly. The rules cover pipeline failure, worker and public AI exhaustion, request errors, and stale feeds. Configure Alertmanager routing to the operator’s pager or mailbox. Also monitor `/api/v1/health` from outside the server every minute and alert after two failures. Review collector delivery, alert routing, and a test incident before launch. Do not log API keys, auth tokens, or article bodies.

## Operations

- Keep Caddy, Node, Mongo, Redis, and dependencies patched. Rebuild and redeploy after Dependabot updates pass CI.
- Caddy serves HTTPS and applies HSTS and browser security headers. The API trusts one proxy so rate limits use the visitor address.
- `REFRESH_ADMIN_UIDS` restricts manual refresh to named Firebase users.
- To scale API replicas: `docker compose ... up -d --scale api=3`. For worker replicas, keep `LLM_CALLS_PER_SECOND` at the configured rate: Temporal applies the queue rate across workers. Check the aggregate Gemini quota and the worker and public daily caps. `WORKER_LLM_DAILY_CAP` and `PUBLIC_LLM_DAILY_CAP` reserve distinct daily budgets; tune them to the shared Gemini quota.
- Redis AOF and Mongo named volumes provide local restart recovery. Off-host backups and managed Temporal protect against server loss.
- Deployments using managed Mongo or Redis must update the connection strings and remove those Compose services and their `depends_on` entries.

## CI baseline

The coverage gate enforces at least 65% lines, 80% branches, and 55% functions, based on the current Node test runner baseline. Biome is locked in `package-lock.json`. Lint scans all application and shared source for debugger statements, loose equality, and global eval. Formatting checks new security modules, build configs, and root package metadata; extend that baseline as older source is normalized. The audit and container scans are blocking gates; resolve findings before deployment. Deployment images are pinned to verified registry digests; Dependabot should refresh them after upstream security fixes.
