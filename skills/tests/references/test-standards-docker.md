# Docker / Container Test Standards

## Dockerfile Linting

Use hadolint to catch common Dockerfile issues:

```
hadolint Dockerfile
hadolint --ignore DL3008 Dockerfile
```

Common rules to enforce:
- `DL3008` — pin apt package versions
- `DL3009` — delete apt lists after install
- `DL3015` — avoid additional packages with apt
- `DL3025` — use JSON form for CMD
- `DL4006` — set SHELL with pipefail for pipe commands

## Build Testing

### Basic build verification

```
docker build -t myapp:test .
docker build --target test -t myapp:test .
```

### Multi-stage build verification

```dockerfile
# In Dockerfile
FROM node:20-slim AS test
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm test

FROM node:20-slim AS production
# ... production stage
```

Test the test stage:
```
docker build --target test .
```

## docker-compose Testing

### Config validation

```
docker-compose config
docker-compose config --quiet
```

### Service integration tests (TypeScript - testcontainers)

```typescript
import { GenericContainer, Wait } from 'testcontainers';

describe('API with database', () => {
  let pgContainer;

  beforeAll(async () => {
    pgContainer = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_PASSWORD: 'test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('ready to accept connections'))
      .start();
  });

  afterAll(async () => {
    await pgContainer.stop();
  });

  it('connects to database', async () => {
    const port = pgContainer.getMappedPort(5432);
    const host = pgContainer.getHost();
    // ... test with real database
  });
});
```

### Rust testcontainers

```rust
use testcontainers::{clients, images::postgres::Postgres};

#[tokio::test]
async fn test_with_postgres() {
    let docker = clients::Cli::default();
    let node = docker.run(Postgres::default());
    let port = node.get_host_port_ipv4(5432);

    let url = format!("postgres://postgres:postgres@localhost:{}/postgres", port);
    // ... test with real database
}
```

### Python testcontainers

```python
from testcontainers.postgres import PostgresContainer

def test_with_postgres():
    with PostgresContainer("postgres:16") as pg:
        url = pg.get_connection_url()
        # ... test with real database
```

## Container Health Check Testing

```
docker inspect --format='{{.Config.Healthcheck}}' myapp:test
docker run -d --name test-app myapp:test
docker inspect --format='{{.State.Health.Status}}' test-app
```

## Network and Volume Testing

```typescript
describe('Container networking', () => {
  it('services communicate over shared network', async () => {
    const network = await new Network().start();

    const db = await new GenericContainer('postgres:16')
      .withNetwork(network)
      .withNetworkAliases('db')
      .withEnvironment({ POSTGRES_PASSWORD: 'test' })
      .start();

    const app = await new GenericContainer('myapp:test')
      .withNetwork(network)
      .withEnvironment({ DATABASE_HOST: 'db' })
      .start();

    // Verify app can reach db via network alias
    await app.stop();
    await db.stop();
    await network.stop();
  });
});
```

## Validation Commands

```
hadolint Dockerfile
docker build .
docker-compose config
docker run --rm myapp:test test
```

## What to Focus On

1. **Dockerfile correctness** — linting, layer efficiency, security
2. **Build stages** — each stage builds successfully
3. **Service connectivity** — containers can communicate
4. **Health checks** — services report healthy
5. **Environment configuration** — env vars properly passed and used
6. **Volume mounts** — data persists correctly

## What to Skip

- Performance benchmarking in CI (environment-dependent)
- Cloud-specific deployment behavior
- Container orchestration specifics (Kubernetes, ECS)
- Image size optimization (verify separately)
