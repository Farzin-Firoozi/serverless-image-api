import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

export const handler = async (event) => {
  const uploadId = event.pathParameters?.uploadId
  console.log('getUploadStatus invoked', {
    uploadId,
    table: process.env.TABLE_NAME,
    requestId: event.requestContext?.requestId,
  })

  const result = await ddb.send(
    new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { uploadId },
    }),
  )

  if (!result.Item) {
    console.warn('upload not found', { uploadId })
    return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) }
  }

  console.log('upload status', {
    uploadId,
    status: result.Item.status,
    fileKey: result.Item.fileKey,
  })

  return { statusCode: 200, body: JSON.stringify(result.Item) }
}
