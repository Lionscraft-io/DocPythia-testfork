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
10. [Custom Domain (Optional)](#10-custom-domain-optional)
11. [Monitoring and Alarms](#11-monitoring-and-alarms)
12. [Post-Deployment Setup](#12-post-deployment-setup)
13. [Multi-Instance Setup](#13-multi-instance-setup)
14. [Deploying Updates](#14-deploying-updates)
15. [Troubleshooting](#15-troubleshooting)

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
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": [
            "apprunner.amazonaws.com",
            "build.apprunner.amazonaws.com",
            "tasks.apprunner.amazonaws.com"
          ]
        }
      }
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

# Generate and save the password
DB_PASSWORD=$(openssl rand -base64 24)
echo "Save this password: $DB_PASSWORD"

aws rds create-db-instance \
  --db-instance-identifier docpythia-db \
  --db-instance-class db.t3.micro \
  --engine postgres --engine-version 15.7 \
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
echo "DATABASE_URL: postgresql://docpythia:${DB_PASSWORD}@${DB_ENDPOINT}:5432/docpythia"
```

Enable pgvector:

```bash
psql "postgresql://docpythia:${DB_PASSWORD}@${DB_ENDPOINT}:5432/docpythia" \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Run database migrations

From your local machine:

```bash
export DATABASE_URL="postgresql://docpythia:YOUR_PASSWORD@YOUR_ENDPOINT:5432/docpythia"

npm ci
npx prisma generate
npx prisma migrate deploy
```

---

## 5. S3 Bucket for Instance Configs

```bash
aws s3 mb s3://docpythia-config-${AWS_ACCOUNT_ID} --region $AWS_REGION
```

Upload your instance configuration:

```bash
cp config/instance.example.json config/myinstance/instance.json
# Edit config/myinstance/instance.json with your settings

aws s3 cp config/myinstance/instance.json \
  s3://docpythia-config-${AWS_ACCOUNT_ID}/configs/myinstance/instance.json
```

---

## 6. Secrets Manager

```bash
aws secretsmanager create-secret \
  --name docpythia/database-url \
  --description "DocPythia PostgreSQL connection string" \
  --secret-string "postgresql://docpythia:YOUR_PASSWORD@YOUR_ENDPOINT:5432/docpythia"

aws secretsmanager create-secret \
  --name docpythia/gemini-api-key \
  --description "Google Gemini API key" \
  --secret-string "YOUR_GEMINI_API_KEY"

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

### 9.1 Get IAM role ARNs

```bash
ECR_ROLE_ARN=$(aws iam get-role --role-name docpythia-apprunner-ecr --query 'Role.Arn' --output text)
INSTANCE_ROLE_ARN=$(aws iam get-role --role-name docpythia-apprunner-instance --query 'Role.Arn' --output text)
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/docpythia"
```

### 9.2 Retrieve secrets

```bash
DB_URL=$(aws secretsmanager get-secret-value --secret-id docpythia/database-url --query SecretString --output text)
GEMINI_KEY=$(aws secretsmanager get-secret-value --secret-id docpythia/gemini-api-key --query SecretString --output text)
ADMIN_TOKEN=$(aws secretsmanager get-secret-value --secret-id docpythia/admin-token --query SecretString --output text)
```

### 9.3 Create the service

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
          "DATABASE_URL": "'"$DB_URL"'",
          "GEMINI_API_KEY": "'"$GEMINI_KEY"'",
          "ADMIN_TOKEN": "'"$ADMIN_TOKEN"'",
          "CONFIG_SOURCE": "s3",
          "S3_BUCKET": "docpythia-config-'"$AWS_ACCOUNT_ID"'",
          "S3_REGION": "'"$AWS_REGION"'",
          "CONFIG_S3_PREFIX": "configs/",
          "SCHEDULER_ENABLED": "false",
          "STREAM_MANAGER_ENABLED": "true"
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

### 9.4 Wait and get the URL

```bash
SERVICE_ARN=$(aws apprunner list-services \
  --query "ServiceSummaryList[?ServiceName=='docpythia'].ServiceArn" --output text)

echo "Waiting for App Runner service..."
aws apprunner wait service-running --service-arn $SERVICE_ARN

SERVICE_URL=$(aws apprunner describe-service \
  --service-arn $SERVICE_ARN \
  --query 'Service.ServiceUrl' --output text)

echo "DocPythia is live at: https://${SERVICE_URL}"
```

### 9.5 Add the service ARN to GitHub

Now that the service exists, add `APPRUNNER_SERVICE_ARN` to your GitHub repository variables (see step 8.1) so that future CI runs auto-deploy:

```bash
echo "Add this to GitHub Actions variables as APPRUNNER_SERVICE_ARN:"
echo "$SERVICE_ARN"
```

### 9.6 Verify

```bash
curl https://${SERVICE_URL}/api/health
# Expected: {"status":"ok","timestamp":"..."}
```

---

## 10. Custom Domain (Optional)

### 10.1 Associate with App Runner

```bash
aws apprunner associate-custom-domain \
  --service-arn $SERVICE_ARN \
  --domain-name docs.yourdomain.com \
  --enable-www-subdomain
```

### 10.2 Add DNS records

Get the validation CNAME records:

```bash
aws apprunner describe-custom-domains \
  --service-arn $SERVICE_ARN \
  --query 'CustomDomains[0].CertificateValidationRecords'
```

Add these CNAME records to your DNS provider (Route 53, Cloudflare, etc.). SSL is handled automatically by App Runner.

### 10.3 Update WIDGET_DOMAIN

Update the `WIDGET_DOMAIN` GitHub Actions variable to your custom domain, then push a commit to trigger a rebuild with the correct domain baked in.

---

## 11. Monitoring and Alarms

### 11.1 View logs

```bash
# Find the log group
aws logs describe-log-groups --log-group-name-prefix "/aws/apprunner/docpythia"

# Tail logs
aws logs tail "/aws/apprunner/docpythia/<service-id>/application" --follow
```

### 11.2 Set up CloudWatch alarms

```bash
# Create SNS topic for alerts
aws sns create-topic --name docpythia-alerts
aws sns subscribe \
  --topic-arn arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:docpythia-alerts \
  --protocol email --notification-endpoint your@email.com

# Alarm: High 5xx error rate
aws cloudwatch put-metric-alarm \
  --alarm-name docpythia-high-error-rate \
  --metric-name 5xxStatusResponses \
  --namespace AWS/AppRunner \
  --statistic Sum --period 300 --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=ServiceName,Value=docpythia \
  --alarm-actions arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:docpythia-alerts

# Alarm: Unhealthy instances
aws cloudwatch put-metric-alarm \
  --alarm-name docpythia-unhealthy \
  --metric-name UnhealthyInstanceCount \
  --namespace AWS/AppRunner \
  --statistic Maximum --period 60 --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 3 \
  --dimensions Name=ServiceName,Value=docpythia \
  --alarm-actions arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:docpythia-alerts
```

---

## 12. Post-Deployment Setup

### 12.1 Access the admin dashboard

```
https://<SERVICE_URL>/admin
```

### 12.2 Configure your first instance

Upload an instance config to S3 (see `config/instance.example.json` for the full schema).

First, generate a bcrypt hash for the admin password:

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-password', 12).then(h => console.log(h));"
```

Then create the config with that hash:

```json
{
  "project": {
    "name": "My Project",
    "shortName": "myproject",
    "description": "AI-powered documentation assistant",
    "domain": "myproject.org"
  },
  "documentation": {
    "gitUrl": "https://github.com/your-org/your-docs",
    "branch": "main",
    "docsPath": ""
  },
  "database": {
    "name": "docpythia"
  },
  "admin": {
    "passwordHash": "<paste-bcrypt-hash-here>",
    "allowedOrigins": ["https://your-domain.com"]
  }
}
```

### 12.3 Trigger initial documentation sync

```bash
curl -X POST "https://${SERVICE_URL}/api/admin/docs/sync" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

---

## 13. Multi-Instance Setup

DocPythia supports multiple project instances from a single deployment. Each instance gets its own database, configuration, and admin dashboard at `/{instanceId}/admin`.

```bash
# Create a database per instance
psql "$DATABASE_URL" -c "CREATE DATABASE myproject_docs;"

# Run migrations
DATABASE_URL="postgresql://docpythia:pass@host:5432/myproject_docs" npx prisma migrate deploy

# Upload config to S3
aws s3 cp config/myproject/instance.json \
  s3://docpythia-config-${AWS_ACCOUNT_ID}/configs/myproject/instance.json

# Access at:
# https://<SERVICE_URL>/myproject/admin
```

See `config/instance.example.json` for the full configuration schema.

---

## 14. Deploying Updates

With GitHub Actions CI/CD, deploying is simple:

```bash
# 1. Make your changes on a feature branch
git checkout -b my-feature

# 2. Push and create a PR (CI runs tests)
git push -u origin my-feature

# 3. Merge to main (CI builds image, pushes to ECR, triggers App Runner deploy)
```

The pipeline automatically:
1. Runs tests against a pgvector database
2. Builds the Docker image with your `WIDGET_DOMAIN`
3. Pushes to ECR with tags: `latest`, package.json version, and git SHA
4. Triggers an App Runner redeployment

**Manual rollback** to a previous version:

```bash
# Find the image tag you want to roll back to
aws ecr describe-images --repository-name docpythia \
  --query 'imageDetails[*].{tags:imageTags,pushed:imagePushedAt}' \
  --output table

# Update App Runner to use a specific tag
aws apprunner update-service \
  --service-arn $SERVICE_ARN \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "'"$ECR_URI:<tag>"'",
      "ImageRepositoryType": "ECR"
    }
  }'
```

---

## 15. Troubleshooting

### App Runner deployment fails

```bash
aws apprunner describe-service --service-arn $SERVICE_ARN --query 'Service.Status'
aws logs tail "/aws/apprunner/docpythia/<service-id>/application" --since 30m
```

### Health check failing

Common causes: wrong DATABASE_URL, port mismatch (must be 8080), migrations not run.

Test locally:
```bash
docker run -p 8080:8080 \
  -e DATABASE_URL="your-db-url" \
  -e GEMINI_API_KEY="your-key" \
  -e ADMIN_TOKEN="test" \
  -e NODE_ENV=production \
  -e PORT=8080 \
  docpythia:latest
```

### Database connection refused

- Check the RDS security group allows inbound on port 5432
- Verify `--publicly-accessible` was set on the RDS instance
- Verify the endpoint: `aws rds describe-db-instances --db-instance-identifier docpythia-db`

### GitHub Actions can't push to ECR

- Verify `AWS_DEPLOY_ROLE_ARN` and `AWS_REGION` are set in GitHub Actions variables (not secrets)
- Check the OIDC provider was created (step 3.3)
- Verify the trust policy references the correct `repo:org/name:ref:refs/heads/main`

### Cold starts / slow wake-up

```bash
aws apprunner update-service \
  --service-arn $SERVICE_ARN \
  --auto-scaling-configuration-arn $(aws apprunner create-auto-scaling-configuration \
    --auto-scaling-configuration-name docpythia-scaling \
    --min-size 1 --max-size 2 \
    --query 'AutoScalingConfiguration.AutoScalingConfigurationArn' --output text)
```

---

## Quick Reference

```bash
# Deploy: just merge to main. CI handles the rest.

# Manual deploy trigger
aws apprunner start-deployment --service-arn $SERVICE_ARN

# View logs
aws logs tail "/aws/apprunner/docpythia/<service-id>/application" --follow

# Health check
curl https://${SERVICE_URL}/api/health

# Trigger processing
curl -X POST "https://${SERVICE_URL}/api/admin/stream/process" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"

# Check message backlog
psql "$DATABASE_URL" \
  -c "SELECT COUNT(*) FROM \"unifiedMessage\" WHERE \"processingStatus\" = 'PENDING';"

# Rollback
aws apprunner update-service --service-arn $SERVICE_ARN \
  --source-configuration '{"ImageRepository":{"ImageIdentifier":"'"$ECR_URI:<previous-tag>"'"}}'
```
