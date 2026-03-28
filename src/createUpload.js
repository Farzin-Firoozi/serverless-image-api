import { randomUUID } from 'crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'

const s3 = new S3Client({})

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const UPLOAD_EXPIRATION_TIME = 300

export const handler = async () => {
  console.log('createUpload invoked', {
    table: process.env.TABLE_NAME,
    bucket: process.env.BUCKET_NAME,
  })

  const uploadId = randomUUID()
  const key = `uploads/${uploadId}`

  console.log('new upload', { uploadId, key })

  // Generate pre-signed URL for the upload
  const presignedUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Key: key,
      Bucket: process.env.BUCKET_NAME,
    }),
    { expiresIn: UPLOAD_EXPIRATION_TIME },
  )

  console.log('presigned PutObject URL issued', {
    key,
    urlLength: presignedUrl.length,
    expiresInSeconds: UPLOAD_EXPIRATION_TIME,
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
