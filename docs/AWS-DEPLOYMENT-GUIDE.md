# AWS Deployment Guide

Deploy DocPythia from a fresh AWS account to a production-ready setup using App Runner, ECR, RDS, and S3. Builds are handled by GitHub Actions and pushed to ECR automatically on merge to `main`.

**Architecture Overview:**
```
  ┌──────────────┐     push to main     ┌──────────────────┐
  │   GitHub      │ ──────────────────► │  GitHub Actions   │
  │   Repository  │                     │  (CI: test+build) │
  └──────────────┘                      └────────┬─────────┘
                                                 │ docker push
                                        ┌────────▼─────────┐
                                        │   Amazon ECR      │
                                        │   (Docker images) │
                                        └────────┬─────────┘
                                                 │ auto-deploy
                    ┌─────────────────┐ ┌────────▼─────────┐
                    │   Route 53      │ │   App Runner      │
                    │  (DNS + Domain) ├─┤  (DocPythia App)     │
                    └─────────────────┘ │  Port 8080        │
                                        └──┬─────┬────┬────┘
                                           │     │    │
                              ┌────────────▼┐ ┌──▼──┐ ├──────────┐
                              │ RDS          │ │ S3  │ │ Secrets  │
                              │ PostgreSQL   │ │     │ │ Manager  │
                              │ + pgvector   │ │     │ │          │
                              └──────────────┘ └─────┘ └──────────┘
```

**Estimated time:** 45-60 minutes (one-time setup)

> **Disclaimer:** This guide provides a functional starting point for deploying DocPythia on AWS. It is not a substitute for professional advice. Consult with your cloud infrastructure, networking, and security experts to ensure your deployment meets your organization's requirements for production hardening, network architecture, access controls, compliance, and data protection.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [AWS CLI Setup](#2-aws-cli-setup)
3. [IAM Configuration](#3-iam-configuration)
4. [Database Setup (RDS PostgreSQL + pgvector)](#4-database-setup)
5. [S3 Bucket for Instance Configs](#5-s3-bucket-for-instance-configs)
6. [Secrets Manager](#6-secrets-manager)
7. [ECR Repository](#7-ecr-repository)
8. [GitHub Actions OIDC + Repository Setup](#8-github-actions-oidc--repository-setup)
9. [App Runner Service](#9-app-runner-service)
10. [Post-Deployment Setup](#10-post-deployment-setup)

---

## 1. Prerequisites

Before you begin, ensure you have:

- An AWS account with admin access
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed
- A GitHub repository with this codebase
- A Google Gemini API key ([Get one here](https://aistudio.google.com/apikey))
- Node.js 20+ (for running database migrations locally)

**Optional (for integrations):**
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Zulip bot credentials
- GitHub Personal Access Token (for PR generation)

---

## 2. AWS CLI Setup

Configure the CLI with your account credentials:

```bash
aws configure
# AWS Access Key ID: <your-key>
# AWS Secret Access Key: <your-secret>
# Default region name: eu-central-1
# Default output format: json
```

Verify it works:

```bash
aws sts get-caller-identity
```

### 2.1 Required IAM Permissions for Setup

The IAM user or role running these setup commands needs the following permissions. You can either use an admin user or create a custom policy with these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "IAMRoleManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:GetRole",
        "iam:PutRolePolicy",
        "iam:AttachRolePolicy",
        "iam:CreateOpenIDConnectProvider",
        "iam:GetOpenIDConnectProvider"
      ],
      "Resource": "*"
    },
    {
      "Sid": "IAMPassRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::*:role/docpythia-apprunner-*"
    },
    {
      "Sid": "ECRManagement",
      "Effect": "Allow",
      "Action": [
        "ecr:CreateRepository",
        "ecr:DescribeRepositories",
        "ecr:PutLifecyclePolicy",
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    },
    {
      "Sid": "RDSManagement",
      "Effect": "Allow",
      "Action": [
        "rds:CreateDBInstance",
        "rds:CreateDBSubnetGroup",
        "rds:DescribeDBInstances",
        "rds:DescribeDBSubnetGroups",
        "rds:DescribeDBEngineVersions",
        "rds:ModifyDBInstance"
      ],
      "Resource": "*"
    },
    {
      "Sid": "EC2NetworkingForRDS",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups",
        "ec2:CreateSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:DescribeAvailabilityZones"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3BucketOperations",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:ListBucket",
        "s3:PutBucketPolicy",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::docpythia-*"
    },
    {
      "Sid": "S3ObjectOperations",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::docpythia-*/*"
    },
    {
      "Sid": "SecretsManagerSetup",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:PutSecretValue",
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:docpythia/*"
    },
    {
      "Sid": "AppRunnerManagement",
      "Effect": "Allow",
      "Action": [
        "apprunner:CreateService",
        "apprunner:DescribeService",
        "apprunner:ListServices",
        "apprunner:StartDeployment",
        "apprunner:UpdateService",
        "apprunner:CreateAutoScalingConfiguration",
        "apprunner:DescribeAutoScalingConfiguration"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchMonitoring",
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogGroups",
        "logs:CreateLogGroup",
        "logs:PutRetentionPolicy",
        "cloudwatch:PutMetricAlarm",
        "cloudwatch:DescribeAlarms"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SNSAlerts",
      "Effect": "Allow",
      "Action": [
        "sns:CreateTopic",
        "sns:Subscribe",
        "sns:GetTopicAttributes"
      ],
      "Resource": "arn:aws:sns:*:*:docpythia-*"
    }
  ]
}
```

> **Tip**: For initial setup, using an IAM user with `AdministratorAccess` is simpler. After setup, you can restrict access to only the deploy role for CI/CD.

Set your region as a variable for the rest of this guide:

```bash
export AWS_REGION=eu-central-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

---

## 3. IAM Configuration

### 3.1 Create an App Runner ECR access role

App Runner needs a role to pull images from ECR:

```bash
aws iam create-role --role-name docpythia-apprunner-ecr \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "build.apprunner.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy --role-name docpythia-apprunner-ecr \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
```

### 3.2 Create an App Runner instance role

This role gives the running container access to S3 and Secrets Manager:

```bash
aws iam create-role --role-name docpythia-apprunner-instance \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "tasks.apprunner.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam put-role-policy --role-name docpythia-apprunner-instance \
  --policy-name docpythia-instance-policy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
        "Resource": [
          "arn:aws:s3:::docpythia-config-*",
          "arn:aws:s3:::docpythia-config-*/*"
        ]
      },
      {
        "Effect": "Allow",
        "Action": ["secretsmanager:GetSecretValue"],
        "Resource": "arn:aws:secretsmanager:*:*:secret:docpythia/*"
      }
    ]
  }'
```

### 3.3 Create a GitHub Actions OIDC deploy role

This allows GitHub Actions to authenticate with AWS without storing long-lived credentials.

> **For forks:** Replace `GITHUB_ORG` and `GITHUB_REPO` below with your GitHub username/organization and repository name.

```bash
# Create the OIDC identity provider (one-time per AWS account)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# Set your GitHub org/username and repo name
# Examples:
#   GITHUB_ORG="my-username"    GITHUB_REPO="DocPythia"     (personal fork)
#   GITHUB_ORG="my-company"     GITHUB_REPO="docpythia"     (org fork)
GITHUB_ORG="your-github-username-or-org"
GITHUB_REPO="your-repo-name"

aws iam create-role --role-name docpythia-github-deploy \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::'"$AWS_ACCOUNT_ID"':oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:'"$GITHUB_ORG/$GITHUB_REPO"':ref:refs/heads/main"
        }
      }
    }]
  }'

# Grant ECR push and App Runner deploy permissions
aws iam put-role-policy --role-name docpythia-github-deploy \
  --policy-name docpythia-deploy-policy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "ECRAuth",
        "Effect": "Allow",
        "Action": "ecr:GetAuthorizationToken",
        "Resource": "*"
      },
      {
        "Sid": "ECRPush",
        "Effect": "Allow",
        "Action": [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ],
        "Resource": "arn:aws:ecr:'"$AWS_REGION"':'"$AWS_ACCOUNT_ID"':repository/docpythia"
      },
      {
        "Sid": "AppRunnerDeploy",
        "Effect": "Allow",
        "Action": "apprunner:StartDeployment",
        "Resource": "arn:aws:apprunner:'"$AWS_REGION"':'"$AWS_ACCOUNT_ID"':service/docpythia/*"
      }
    ]
  }'

# Note: The App Runner resource uses docpythia/* to match service IDs.
# For tighter security, replace with the exact service ARN after creation:
#   arn:aws:apprunner:<region>:<account>:service/docpythia/<service-id>

echo "Deploy role ARN (save this for GitHub setup):"
echo "arn:aws:iam::${AWS_ACCOUNT_ID}:role/docpythia-github-deploy"
```

---

## 4. Database Setup

> **Note:** This guide uses the default VPC for simplicity. If your account doesn't have a default VPC, or you prefer to use a different VPC, replace `DEFAULT_VPC` with your VPC ID.

```bash
DEFAULT_VPC=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" \
  --query "Vpcs[0].VpcId" --output text)

# Verify VPC was found (should not be "None")
echo "Using VPC: $DEFAULT_VPC"

SUBNET_IDS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$DEFAULT_VPC" \
  --query "Subnets[*].SubnetId" --output text | tr '\t' ',')

aws rds create-db-subnet-group \
  --db-subnet-group-name docpythia-db-subnet \
  --db-subnet-group-description "DocPythia database subnets" \
  --subnet-ids $(echo $SUBNET_IDS | tr ',' ' ')

DB_SG=$(aws ec2 create-security-group \
  --group-name docpythia-db-sg \
  --description "DocPythia database security group" \
  --vpc-id $DEFAULT_VPC \
  --query 'GroupId' --output text)

# Allow PostgreSQL traffic (restrict the CIDR in production)
aws ec2 authorize-security-group-ingress \
  --group-id $DB_SG \
  --protocol tcp --port 5432 --cidr 0.0.0.0/0

# Generate and save the password (alphanumeric only to avoid RDS restrictions)
DB_PASSWORD=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 24)
echo "Save this password: $DB_PASSWORD"

# Find latest PostgreSQL 15.x version available in your region
# (omit --engine-version to use the default if this fails)
PG_VERSION=$(aws rds describe-db-engine-versions --engine postgres \
  --query "DBEngineVersions[?starts_with(EngineVersion, '15')].EngineVersion" \
  --output text 2>/dev/null | tr '\t' '\n' | sort -V | tail -1)

if [ -n "$PG_VERSION" ]; then
  echo "Using PostgreSQL version: $PG_VERSION"
  ENGINE_VERSION_ARG="--engine-version $PG_VERSION"
else
  echo "Could not detect version, using RDS default for PostgreSQL 15"
  ENGINE_VERSION_ARG=""
fi

aws rds create-db-instance \
  --db-instance-identifier docpythia-db \
  --db-instance-class db.t3.micro \
  --engine postgres $ENGINE_VERSION_ARG \
  --master-username docpythia \
  --master-user-password "$DB_PASSWORD" \
  --allocated-storage 20 \
  --db-name docpythia \
  --vpc-security-group-ids $DB_SG \
  --db-subnet-group-name docpythia-db-subnet \
  --publicly-accessible \
  --backup-retention-period 7 \
  --storage-encrypted --no-multi-az

echo "Waiting for RDS instance (5-10 minutes)..."
aws rds wait db-instance-available --db-instance-identifier docpythia-db

DB_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier docpythia-db \
  --query 'DBInstances[0].Endpoint.Address' --output text)

echo "Database endpoint: $DB_ENDPOINT"
echo "DATABASE_URL: postgresql://docpythia:${DB_PASSWORD}@${DB_ENDPOINT}:5432/docpythia?sslmode=require"
```

Enable pgvector:

```bash
psql "postgresql://docpythia:${DB_PASSWORD}@${DB_ENDPOINT}:5432/docpythia?sslmode=require" \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Run database migrations

From your local machine, using the variables from the previous steps:

```bash
# Option A: Use shell variables (if still in same session)
export DATABASE_URL="postgresql://docpythia:${DB_PASSWORD}@${DB_ENDPOINT}:5432/docpythia?sslmode=require"

# Option B: Set values directly (if starting a new session)
# export DATABASE_URL="postgresql://docpythia:<your-password>@<your-endpoint>:5432/docpythia?sslmode=require"

# Verify the connection string
echo "DATABASE_URL: $DATABASE_URL"

npm ci
npx prisma generate
npx prisma migrate deploy
```

Optionally, save to `.env` for local development:

```bash
cp .env.example .env
# Edit .env and set DATABASE_URL to your connection string
```

---

## 5. S3 Bucket for Instance Configs

```bash
aws s3 mb s3://docpythia-config-${AWS_ACCOUNT_ID} --region $AWS_REGION
```

### 5.1 Create your instance configuration

Copy and customize the example config:

```bash
mkdir -p config/myinstance
cp config/instance.example.json config/myinstance/instance.json
```

Edit `config/myinstance/instance.json` with your settings. Key fields to update:

| Section | Field | Description |
|---------|-------|-------------|
| `project` | `name`, `shortName` | Your project's display name and URL slug |
| `project` | `domain` | Your production domain (e.g., `docs.myproject.com`) |
| `documentation` | `gitUrl` | GitHub URL of your documentation repository |
| `documentation` | `branch`, `docsPath` | Branch and folder containing docs |
| `admin` | `token` | Secure admin API token (use `openssl rand -base64 32`) |
| `admin` | `allowedOrigins` | List of allowed CORS origins for your domain |

Optional integrations (set `enabled: false` to skip):
- `community.telegram` — Bot token and channel for Telegram ingestion
- `community.discord` — Bot token and guild/channel IDs for Discord
- `community.zulip` — Zulip site URL and credentials

### 5.2 Upload to S3

```bash
aws s3 cp config/myinstance/instance.json \
  s3://docpythia-config-${AWS_ACCOUNT_ID}/configs/myinstance/instance.json
```

> **Note:** The instance name in the S3 path (`myinstance`) becomes the URL path: `https://your-domain.com/myinstance/admin`

---

## 6. Secrets Manager

Store secrets using the variables from previous steps:

```bash
# Database URL (uses DB_PASSWORD and DB_ENDPOINT from step 4)
aws secretsmanager create-secret \
  --name docpythia/database-url \
  --description "DocPythia PostgreSQL connection string" \
  --secret-string "postgresql://docpythia:${DB_PASSWORD}@${DB_ENDPOINT}:5432/docpythia?sslmode=require"

# Gemini API key (replace with your actual key)
aws secretsmanager create-secret \
  --name docpythia/gemini-api-key \
  --description "Google Gemini API key" \
  --secret-string "YOUR_GEMINI_API_KEY"

# Admin token (auto-generated)
aws secretsmanager create-secret \
  --name docpythia/admin-token \
  --description "DocPythia admin API token" \
  --secret-string "$(openssl rand -base64 32)"
```

> **Note:** The app reads secrets from environment variables. You'll pass these as App Runner env vars in Step 9.

---

## 7. ECR Repository

```bash
aws ecr create-repository \
  --repository-name docpythia \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256 \
  --region $AWS_REGION

# Lifecycle policy: keep last 10 images
aws ecr put-lifecycle-policy \
  --repository-name docpythia \
  --lifecycle-policy-text '{
    "rules": [{
      "rulePriority": 1,
      "description": "Keep last 10 images",
      "selection": {
        "tagStatus": "any",
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": {"type": "expire"}
    }]
  }'
```

---

## 8. GitHub Actions OIDC + Repository Setup

The CI pipeline (`.github/workflows/ci.yml`) builds the Docker image and pushes to ECR on every merge to `main`. It uses OIDC federation — no long-lived AWS credentials stored in GitHub.

### 8.1 Set GitHub repository variables

Go to **Settings > Secrets and variables > Actions > Variables** in your GitHub repo and add:

| Variable | Value | Example |
|----------|-------|---------|
| `AWS_REGION` | Your AWS region | `eu-central-1` |
| `AWS_DEPLOY_ROLE_ARN` | The deploy role ARN from step 3.3 | `arn:aws:iam::123456789:role/docpythia-github-deploy` |
| `WIDGET_DOMAIN` | Your production domain | `https://docs.yourdomain.com` |
| `APPRUNNER_SERVICE_ARN` | App Runner service ARN (add after step 9) | `arn:aws:apprunner:eu-central-1:123456789:service/docpythia/...` |

### 8.2 CI/CD pipeline flow

On every push to `main`, GitHub Actions will:

1. **Test** — Lint, type check, run tests against a pgvector service container
2. **Build** — Compile TypeScript frontend and backend
3. **Docker** — Build the Docker image, push to ECR with tags (`latest`, version, git SHA)
4. **Deploy** — Trigger an App Runner redeployment (if `APPRUNNER_SERVICE_ARN` is set)

The workflow is defined in `.github/workflows/ci.yml`. No manual docker build or push is needed.

### 8.3 First push

For the initial deployment, you need to push an image to ECR before creating the App Runner service. Either:

**Option A:** Push to `main` and let CI build it (recommended — tests the full pipeline).

**Option B:** Build and push locally for the first time only:
```bash
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin \
  ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

docker build --build-arg WIDGET_DOMAIN=https://your-domain.com -t docpythia .

ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/docpythia"
docker tag docpythia:latest ${ECR_URI}:latest
docker push ${ECR_URI}:latest
```

---

## 9. App Runner Service

### 9.1 Get IAM role ARNs and set up variables

```bash
ECR_ROLE_ARN=$(aws iam get-role --role-name docpythia-apprunner-ecr --query 'Role.Arn' --output text)
INSTANCE_ROLE_ARN=$(aws iam get-role --role-name docpythia-apprunner-instance --query 'Role.Arn' --output text)
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/docpythia"

# Build secret ARNs (App Runner will fetch values automatically)
SECRET_PREFIX="arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:docpythia"
```

### 9.2 Create the service

App Runner references secrets directly from Secrets Manager using `RuntimeEnvironmentSecrets`. When you update a secret, redeploy the service to pick up the new value.

```bash
aws apprunner create-service \
  --service-name docpythia \
  --source-configuration '{
    "AuthenticationConfiguration": {
      "AccessRoleArn": "'"$ECR_ROLE_ARN"'"
    },
    "AutoDeploymentsEnabled": false,
    "ImageRepository": {
      "ImageIdentifier": "'"$ECR_URI:latest"'",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "8080",
        "RuntimeEnvironmentVariables": {
          "NODE_ENV": "production",
          "PORT": "8080",
          "CONFIG_SOURCE": "s3",
          "S3_BUCKET": "docpythia-config-'"$AWS_ACCOUNT_ID"'",
          "S3_REGION": "'"$AWS_REGION"'",
          "CONFIG_S3_PREFIX": "configs/",
          "SCHEDULER_ENABLED": "false",
          "STREAM_MANAGER_ENABLED": "true"
        },
        "RuntimeEnvironmentSecrets": {
          "DATABASE_URL": "'"${SECRET_PREFIX}/database-url"'",
          "GEMINI_API_KEY": "'"${SECRET_PREFIX}/gemini-api-key"'",
          "ADMIN_TOKEN": "'"${SECRET_PREFIX}/admin-token"'"
        }
      }
    }
  }' \
  --instance-configuration '{
    "Cpu": "1 vCPU",
    "Memory": "2 GB",
    "InstanceRoleArn": "'"$INSTANCE_ROLE_ARN"'"
  }' \
  --health-check-configuration '{
    "Protocol": "HTTP",
    "Path": "/api/health",
    "Interval": 20,
    "Timeout": 5,
    "HealthyThreshold": 1,
    "UnhealthyThreshold": 5
  }' \
  --region $AWS_REGION
```

### 9.3 Wait and get the URL

```bash
SERVICE_ARN=$(aws apprunner list-services \
  --query "ServiceSummaryList[?ServiceName=='docpythia'].ServiceArn" --output text)

# Wait for service to be running (takes 2-5 minutes)
echo "Waiting for App Runner service to start..."
while true; do
  STATUS=$(aws apprunner describe-service --service-arn $SERVICE_ARN \
    --query 'Service.Status' --output text)
  echo "Status: $STATUS"
  if [ "$STATUS" = "RUNNING" ]; then break; fi
  if [ "$STATUS" = "CREATE_FAILED" ]; then echo "Service creation failed!"; exit 1; fi
  sleep 15
done

SERVICE_URL=$(aws apprunner describe-service \
  --service-arn $SERVICE_ARN \
  --query 'Service.ServiceUrl' --output text)

echo "DocPythia is live at: https://${SERVICE_URL}"
```

### 9.4 Add the service ARN to GitHub

Now that the service exists, add `APPRUNNER_SERVICE_ARN` to your GitHub repository variables (see step 8.1) so that future CI runs auto-deploy:

```bash
echo "Add this to GitHub Actions variables as APPRUNNER_SERVICE_ARN:"
echo "$SERVICE_ARN"
```

### 9.5 Verify

> **Note:** The service won't be healthy until an image is pushed to ECR. If you haven't pushed an image yet, either push to `main` to trigger the CI pipeline (step 8.3), or build and push manually first.

```bash
curl https://${SERVICE_URL}/api/health
# Expected: {"status":"ok","timestamp":"..."}
```

If the health check fails, check the App Runner logs:
```bash
aws logs tail "/aws/apprunner/docpythia" --since 10m
```

---

## 10. Post-Deployment Setup

### 10.1 Set your admin password

Your instance configuration (uploaded to S3 in step 5) needs a bcrypt password hash for admin login. Generate one:

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-secure-password', 12).then(h => console.log(h));"
```

Update your `instance.json` with the hash:

```json
{
  "admin": {
    "passwordHash": "$2b$12$...<your-hash-here>...",
    "allowedOrigins": ["https://your-app-runner-url.awsapprunner.com"]
  }
}
```

Re-upload to S3:

```bash
aws s3 cp config/myinstance/instance.json \
  s3://docpythia-config-${AWS_ACCOUNT_ID}/configs/myinstance/instance.json
```

### 10.2 Access the admin dashboard

The admin dashboard is available at your instance path:

```
https://<SERVICE_URL>/<instance-name>/admin
```

For example, if your instance is named `myinstance`:
```
https://abc123.eu-central-1.awsapprunner.com/myinstance/admin
```

Log in with the password you hashed above.

### 10.3 Sync documentation

From the admin dashboard, navigate to the Documentation section and click **Sync** to import your documentation from the configured Git repository.

---

**Deployment complete!** Your DocPythia instance is now running on AWS App Runner.
