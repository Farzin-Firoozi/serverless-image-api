# Serverless Image Upload API

Minimal **Serverless Framework** app: request a pre-signed S3 upload URL, upload a file, then an **SQS**-driven worker updates **DynamoDB** with file metadata.

## Architecture

```
POST /uploads  ──► createUpload Lambda ──► S3 pre-signed URL + DynamoDB (PENDING)
                                                │
                                          Client PUT
                                                │
                                          S3 ObjectCreated
                                                │
                                         SQS UploadQueue
                                                │
                                      processUpload Lambda ──► DynamoDB (DONE + metadata)

GET /uploads/{uploadId}  ──► getUploadStatus Lambda ──► DynamoDB record
```

## Stack

- **API Gateway (HTTP API)** + Lambda: `POST /uploads`, `GET /uploads/{uploadId}`
- **S3** bucket with `ObjectCreated` notifications → **SQS** → `processUpload` Lambda
- **DynamoDB** (on-demand) for upload records
- **IAM**: least-privilege role per function

## Prerequisites

- Node.js 20+
- AWS credentials configured (`aws configure` or env vars `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`)
- IAM permissions to create/deploy CloudFormation, Lambda, API Gateway, S3, SQS, DynamoDB, and IAM roles
- Serverless Framework CLI v4:

```bash
npm install -g serverless
```

## Install

```bash
npm install
```

## Deploy

```bash
sls deploy
```

Optional: target a different stage or region:

```bash
sls deploy --stage prod --region us-east-1
```

After deploy, note the **HttpApiUrl** printed in the output, or retrieve it any time with:

```bash
sls info
```

## Test with curl

Export your API base URL (no trailing slash):

```bash
export API_URL='https://xxxxxxxx.execute-api.eu-central-1.amazonaws.com'
```

### 1. Create an upload — receive `uploadId` and pre-signed URL

```bash
curl -sS -X POST "$API_URL/uploads" | tee /tmp/upload.json
```

Example response:

```json
{
  "uploadId": "6c3b8f8e-1a2b-4c3d-8e9f-000000000000",
  "uploadUrl": "https://<bucket>.s3.eu-central-1.amazonaws.com/uploads/6c3b8f8e-...?X-Amz-Signature=..."
}
```

> The pre-signed URL expires in **5 minutes** (300 seconds). Upload your file before then.

Save the values for the next steps:

```bash
export UPLOAD_ID=$(jq -r .uploadId /tmp/upload.json)
export UPLOAD_URL=$(jq -r .uploadUrl /tmp/upload.json)
```

### 2. Upload a file to S3 via the pre-signed URL

Any file works. Using a small text file as an example:

```bash
echo 'hello world' > /tmp/sample.txt

curl -sS -X PUT \
  -H "Content-Type: text/plain" \
  -T /tmp/sample.txt \
  "$UPLOAD_URL"
```

A successful PUT returns an empty `200 OK` body.

### 3. Check status (poll until `DONE`)

Processing is asynchronous (S3 → SQS → Lambda). It typically completes within a few seconds:

```bash
curl -sS "$API_URL/uploads/$UPLOAD_ID" | jq .
```

**While processing** (`PENDING`):

```json
{
  "uploadId": "6c3b8f8e-...",
  "status": "PENDING",
  "createdAt": "2026-03-28T10:00:00.000Z"
}
```

**After processing** (`DONE`):

```json
{
  "uploadId": "6c3b8f8e-...",
  "status": "DONE",
  "createdAt": "2026-03-28T10:00:00.000Z",
  "fileKey": "uploads/6c3b8f8e-...",
  "fileSize": 12,
  "contentType": "text/plain",
  "processedAt": "2026-03-28T10:00:03.000Z"
}
```

### 4. Unknown upload ID

```bash
curl -sS "$API_URL/uploads/does-not-exist" | jq .
# → { "error": "Not found" }  (HTTP 404)
```

## One-liner end-to-end test

```bash
RESP=$(curl -sS -X POST "$API_URL/uploads") && \
UPLOAD_ID=$(echo $RESP | jq -r .uploadId) && \
UPLOAD_URL=$(echo $RESP | jq -r .uploadUrl) && \
echo "hello world" > /tmp/sample.txt && \
curl -sS -X PUT -H "Content-Type: text/plain" -T /tmp/sample.txt "$UPLOAD_URL" && \
sleep 5 && \
curl -sS "$API_URL/uploads/$UPLOAD_ID" | jq .
```

## Remove the stack

```bash
sls remove
```

> If removal fails because the S3 bucket is non-empty, manually delete the objects under `uploads/` in the AWS Console (or via `aws s3 rm s3://<bucket>/uploads/ --recursive`), then re-run `sls remove`.

## Project layout

| File                     | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `serverless.yml`         | All infrastructure + Lambda definitions                          |
| `src/createUpload.js`    | `POST /uploads` — issues pre-signed URL, writes `PENDING` record |
| `src/getUploadStatus.js` | `GET /uploads/{uploadId}` — reads DynamoDB record                |
| `src/processUpload.js`   | SQS consumer — calls `HeadObject`, writes `DONE` + metadata      |

## Notes

- **ESM**: `package.json` sets `"type": "module"` so all source files use ES module syntax (`import`/`export`).
- **Visibility timeout**: the SQS queue has a 60-second visibility timeout, giving the `processUpload` Lambda enough time to finish before a message becomes re-visible.
- **Idempotency**: S3 → SQS notifications can occasionally deliver a message more than once; the `UpdateItem` call is safe to repeat since it overwrites the same fields.
