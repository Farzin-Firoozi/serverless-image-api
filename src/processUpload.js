import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'

const UPLOAD_PREFIX = 'uploads/'

const s3 = new S3Client({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

function decodeS3Key(key) {
  return decodeURIComponent(key.replace(/\+/g, ' '))
}

/** S3 → SQS sends a JSON body with a top-level Records[] of S3 events. */
function jobsFromSqsBody(body) {
  const jobs = []
  if (body?.Records?.length) {
    for (const r of body.Records) {
      const rawKey = r.s3?.object?.key
      if (!rawKey) continue
      const s3Key = decodeS3Key(rawKey)
      if (!s3Key.startsWith(UPLOAD_PREFIX)) continue
      const uploadId = s3Key.slice(UPLOAD_PREFIX.length)
      if (!uploadId) continue
      jobs.push({ uploadId, s3Key })
    }
    return jobs
  }
  if (body?.uploadId && body?.s3Key) {
    jobs.push({ uploadId: body.uploadId, s3Key: body.s3Key })
  }
  return jobs
}

export const handler = async (event) => {
  console.log(
    'processUpload invoked',
    JSON.stringify({
      recordCount: event.Records?.length,
      recordMessageIds: event.Records?.map((r) => r.messageId),
    }),
  )

  for (const record of event.Records) {
    try {
      console.log('SQS record', {
        messageId: record.messageId,
        bodyLength: record.body?.length,
        bodyPreview: record.body?.slice(0, 500),
      })

      const body = JSON.parse(record.body)
      const jobs = jobsFromSqsBody(body)
      console.log('parsed jobs', { count: jobs.length, jobs })
      if (jobs.length === 0) {
        console.warn('no upload jobs in message; check S3 event shape', {
          messageId: record.messageId,
        })
      }

      for (const { uploadId, s3Key } of jobs) {
        const head = await s3.send(
          new HeadObjectCommand({
            Bucket: process.env.BUCKET_NAME,
            Key: s3Key,
          }),
        )
        console.log('HeadObject ok', {
          uploadId,
          contentLength: head.ContentLength,
          contentType: head.ContentType,
        })

        await ddb.send(
          new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { uploadId },
            UpdateExpression:
              'SET #st = :done, fileKey = :key, fileSize = :size, contentType = :ct, processedAt = :ts',
            ExpressionAttributeNames: { '#st': 'status' },
            ExpressionAttributeValues: {
              ':done': 'DONE',
              ':key': s3Key,
              ':size': head.ContentLength,
              ':ct': head.ContentType,
              ':ts': new Date().toISOString(),
            },
          }),
        )
        console.log('DynamoDB updated to DONE', { uploadId })
      }
    } catch (err) {
      console.error('processUpload record failed', {
        messageId: record.messageId,
        name: err.name,
        message: err.message,
      })
      throw err
    }
  }
}
