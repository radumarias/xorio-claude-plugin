# AWS Service Test Standards

## Local Emulation with LocalStack

Use LocalStack for local AWS service testing:

```bash
# docker-compose.yml
services:
  localstack:
    image: localstack/localstack
    ports:
      - "4566:4566"
    environment:
      - SERVICES=s3,dynamodb,lambda,sqs
```

Configure SDK to point to LocalStack:

```typescript
// TypeScript
import { S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: 'http://localhost:4566',
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  forcePathStyle: true,
});
```

```rust
// Rust
let config = aws_config::defaults(BehaviorVersion::latest())
    .endpoint_url("http://localhost:4566")
    .region(Region::new("us-east-1"))
    .credentials_provider(Credentials::new("test", "test", None, None, "test"))
    .load()
    .await;
```

```python
# Python
import boto3

s3 = boto3.client(
    's3',
    endpoint_url='http://localhost:4566',
    aws_access_key_id='test',
    aws_secret_access_key='test',
    region_name='us-east-1',
)
```

## Mocking AWS SDK Clients

### TypeScript: aws-sdk-client-mock

```typescript
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

it('retrieves object from S3', async () => {
  s3Mock.on(GetObjectCommand).resolves({
    Body: sdkStreamMixin(Readable.from(['file content'])),
  });

  const result = await getFile('my-bucket', 'key.txt');
  expect(result).toBe('file content');
});

it('handles missing object', async () => {
  s3Mock.on(GetObjectCommand).rejects(new NoSuchKey({ message: 'Not found' }));

  await expect(getFile('my-bucket', 'missing.txt')).rejects.toThrow('Not found');
});
```

### Python: moto

```python
import boto3
import moto

@moto.mock_aws
def test_upload_to_s3():
    s3 = boto3.client('s3', region_name='us-east-1')
    s3.create_bucket(Bucket='test-bucket')

    s3.put_object(Bucket='test-bucket', Key='test.txt', Body=b'content')

    response = s3.get_object(Bucket='test-bucket', Key='test.txt')
    assert response['Body'].read() == b'content'
```

### Rust: aws-sdk mock (trait-based)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    struct MockS3 {
        objects: HashMap<String, Vec<u8>>,
    }

    #[async_trait]
    impl S3Operations for MockS3 {
        async fn get_object(&self, bucket: &str, key: &str) -> Result<Vec<u8>> {
            self.objects
                .get(&format!("{}/{}", bucket, key))
                .cloned()
                .ok_or_else(|| anyhow!("Not found"))
        }
    }

    #[tokio::test]
    async fn test_download_file() {
        let mock = MockS3 {
            objects: HashMap::from([
                ("bucket/key.txt".into(), b"content".to_vec()),
            ]),
        };

        let result = download_file(&mock, "bucket", "key.txt").await;
        assert_eq!(result.expect("should succeed"), b"content");
    }
}
```

## Lambda Handler Testing

```typescript
import { handler } from './handler';

describe('Lambda handler', () => {
  it('processes valid event', async () => {
    const event = {
      Records: [{
        s3: { bucket: { name: 'my-bucket' }, object: { key: 'file.txt' } },
      }],
    };

    const result = await handler(event, {} as any);
    expect(result.statusCode).toBe(200);
  });

  it('returns 400 for missing records', async () => {
    const result = await handler({ Records: [] }, {} as any);
    expect(result.statusCode).toBe(400);
  });
});
```

## S3 Operation Testing

```typescript
describe('S3 operations', () => {
  it('uploads file to correct path', async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    await uploadFile('bucket', 'uploads/file.txt', Buffer.from('data'));

    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input).toEqual({
      Bucket: 'bucket',
      Key: 'uploads/file.txt',
      Body: Buffer.from('data'),
    });
  });

  it('lists objects with prefix', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'prefix/a.txt', Size: 100 },
        { Key: 'prefix/b.txt', Size: 200 },
      ],
    });

    const files = await listFiles('bucket', 'prefix/');
    expect(files).toHaveLength(2);
  });
});
```

## DynamoDB Testing

```typescript
describe('DynamoDB operations', () => {
  it('stores and retrieves item', async () => {
    ddbMock.on(PutItemCommand).resolves({});
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({ id: '123', name: 'test' }),
    });

    await storeItem({ id: '123', name: 'test' });
    const item = await getItem('123');
    expect(item.name).toBe('test');
  });
});
```

## CloudFormation / CDK Snapshot Testing

```typescript
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MyStack } from './my-stack';

describe('MyStack', () => {
  it('creates expected resources', () => {
    const app = new App();
    const stack = new MyStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
    });

    template.resourceCountIs('AWS::S3::Bucket', 1);
  });

  it('matches snapshot', () => {
    const app = new App();
    const stack = new MyStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    expect(template.toJSON()).toMatchSnapshot();
  });
});
```

## IAM Policy Validation

```typescript
it('grants read access to S3 bucket', () => {
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith(['s3:GetObject']),
          Effect: 'Allow',
        }),
      ]),
    },
  });
});
```

## Validation Commands

```bash
cdk synth                # synthesize CloudFormation template
sam validate             # validate SAM template
cfn-lint template.yaml   # lint CloudFormation
npm test                 # run CDK/SDK tests
```

## What to Focus On

1. **SDK call correctness** — right parameters, right service calls
2. **Error handling** — service errors, throttling, timeouts
3. **IAM permissions** — policies grant minimum required access
4. **Event handling** — Lambda events parsed correctly
5. **Resource configuration** — CDK/CloudFormation produces expected resources

## What to Skip

- Actual AWS API behavior (trust the SDK)
- Network-level issues (latency, DNS)
- AWS console behavior
- Cross-region replication mechanics
