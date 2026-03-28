import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'

const s3 = new S3Client({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const UPLOAD_EXPIRATION_TIME = 300

export const handler = async () => {
  console.log('createUpload invoked', {
    bucket: process.env.BUCKET_NAME,
    table: process.env.TABLE_NAME,
  })

  const uploadId = randomUUID()
  const key = `uploads/${uploadId}`
  console.log('new upload', { uploadId, key })

  // Generate pre-signed URL for the upload
  const presignedUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: key }),
    { expiresIn: UPLOAD_EXPIRATION_TIME },
  )

  console.log('presigned PutObject URL issued', {
    key,
    expiresInSeconds: UPLOAD_EXPIRATION_TIME,
    urlLength: presignedUrl.length,
  })

  // Write PENDING record to DynamoDB
  await ddb.send(
    new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        uploadId,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      },
    }),
  )
  console.log('DynamoDB PENDING write ok', { uploadId })

  return {
    statusCode: 200,
    body: JSON.stringify({ uploadId, uploadUrl: presignedUrl }),
  }
}
