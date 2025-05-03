# Knowledge Garden - Backend Services

This repository contains the backend microservices for the Knowledge Garden application. The backend is built using a microservice architecture with service discovery via Consul and event-driven communication via Kafka.

## Architecture Overview

The project consists of four main microservices:

- **API Gateway**: Entry point for all client requests, handles authentication and routes requests to appropriate services
- **Authentication Service**: Manages user authentication, registration, and authorization
- **Resources Service**: Handles file uploads, storage, and management with S3 integration
- **Search Service**: Provides search functionality across knowledge resources using Elasticsearch

## Prerequisites

Before you begin, ensure you have the following installed:

- Node.js (v16+)
- npm (v8+)
- PostgreSQL (v14+)
- MongoDB (v5+)
- Elasticsearch (v8+)
- Consul (v1.14+)
- Kafka (v3.3+) & ZooKeeper (v3.8+)
- S3-compatible storage (MinIO or AWS S3)
- TypeScript (v4.5+) for Resources Service

## Backend Requirements

### System Requirements

- **CPU**: 2+ cores recommended for development, 4+ cores for production
- **Memory**: Minimum 8GB RAM (16GB recommended for production)
- **Storage**: 20GB+ free disk space
- **Network**: Stable internet connection for service communication

### Software Dependencies

| Dependency    | Version | Purpose                     |
| ------------- | ------- | --------------------------- |
| Node.js       | v16+    | Runtime environment         |
| TypeScript    | v4.5+   | For strongly-typed services |
| PostgreSQL    | v14+    | User data storage           |
| MongoDB       | v5+     | Document storage            |
| Elasticsearch | v8+     | Search engine               |
| Consul        | v1.14+  | Service discovery           |
| Kafka         | v3.3+   | Event messaging             |
| ZooKeeper     | v3.8+   | Kafka coordination          |
| S3 Storage    | -       | File storage                |

### Environment Configuration

Each service requires specific environment variables to be set:

#### Common Variables (All Services)

```bash
NODE_ENV=development
LOG_LEVEL=debug
CONSUL_HOST=localhost
CONSUL_PORT=8500
CONSUL_DC=dc1
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=knowledge-garden
KAFKA_GROUP_ID_PREFIX=kg
```

#### API Gateway

```bash
GATEWAY_PORT=5000
JWT_SECRET=your-jwt-secret
API_TIMEOUT_MS=10000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

#### Authentication Service

```bash
PORT=5001
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=1h
PGHOST=localhost
PGPORT=5432
PGDATABASE=kg_auth
PGUSER=postgres
PGPASSWORD=yourpassword
BCRYPT_SALT_ROUNDS=10
```

#### Resources Service

```bash
PORT=3000
KAFKA_BROKER=localhost:9092
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=knowledge-garden-resources
S3_ENDPOINT=http://localhost:9000
MONGODB_URI=mongodb://localhost:27017/knowledge_garden
SERVICE_NAME=resource-service
JWT_SECRET=your-jwt-secret
```

#### Search Service

```bash
PORT=5002
ELASTICSEARCH_NODE=http://localhost:9200
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=yourpassword
MONGODB_URI=mongodb://localhost:27017/kg_documents
INDEX_BATCH_SIZE=100
```

## Setup Instructions

### 1. Install Consul for Service Discovery

Consul is used for service discovery and must be running before starting the services.

macOS (using Homebrew):

```bash
brew install consul
consul agent -dev
```

Linux:

```bash
# Download Consul
wget https://releases.hashicorp.com/consul/1.14.4/consul_1.14.4_linux_amd64.zip
unzip consul_1.14.4_linux_amd64.zip
sudo mv consul /usr/local/bin/

# Start Consul in development mode
consul agent -dev
```

Verify Consul is running by accessing the UI at: http://localhost:8500/ui/

### 2. Install Kafka and ZooKeeper

Kafka is used for event-driven communication between services.

#### Using Docker (Recommended for Development)

```bash
# Start ZooKeeper and Kafka using Docker Compose
docker-compose up -d zookeeper kafka

# Verify Kafka is running
docker-compose logs kafka | grep "started"
```

#### Manual Installation

macOS (using Homebrew):

```bash
brew install kafka
brew services start zookeeper
brew services start kafka
```

Linux:

```bash
# Download and extract Kafka
wget https://downloads.apache.org/kafka/3.3.1/kafka_2.13-3.3.1.tgz
tar -xzf kafka_2.13-3.3.1.tgz
cd kafka_2.13-3.3.1

# Start ZooKeeper
bin/zookeeper-server-start.sh -daemon config/zookeeper.properties

# Start Kafka
bin/kafka-server-start.sh -daemon config/server.properties

# Verify Kafka is running
bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
```

### 3. Set up S3-compatible Storage

You can use MinIO for local development or AWS S3 for production:

#### Using MinIO (Recommended for Development)

```bash
# Start MinIO using Docker
docker run -p 9000:9000 -p 9001:9001 --name minio \
  -v ~/minio/data:/data \
  -e "MINIO_ROOT_USER=minioadmin" \
  -e "MINIO_ROOT_PASSWORD=minioadmin" \
  quay.io/minio/minio server /data --console-address ":9001"

# Create a bucket for resources
mc alias set myminio http://localhost:9000 minioadmin minioadmin
mc mb myminio/knowledge-garden-resources
```

#### AWS S3

For production, create an S3 bucket and IAM user with appropriate permissions.

### 4. Configure Environment Variables

Copy the example .env file for each service:

```bash
# Create environment files for each service
cp .env.example api-gateway/.env
cp .env.example authentication/.env
cp .env.example resources/.env
cp .env.example search/.env
```

Edit each service's .env file to configure:

- Database connection strings
- Service ports
- JWT secret
- S3 credentials and endpoint
- Elasticsearch connection
- Consul settings
- Kafka settings

### 5. Install Dependencies

Install dependencies for each service:

```bash
# Install dependencies for API Gateway
cd api-gateway && npm install

# Install dependencies for Authentication Service
cd ../authentication && npm install

# Install dependencies for Resources Service
cd ../resources && npm install

# Install dependencies for Search Service
cd ../search && npm install
```

### 6. Start the Services

Start each service in separate terminal windows:

```bash
# Terminal 1 - Start API Gateway
cd api-gateway && npm run dev

# Terminal 2 - Start Authentication Service
cd ../authentication && npm run dev

# Terminal 3 - Start Resources Service
cd ../resources && npm run dev

# Terminal 4 - Start Search Service
cd ../search && npm run dev
```

## Service Details

### Resources Service

The Resources Service handles file uploads, downloads, and metadata management. It integrates with:

- **S3 Storage**: For storing uploaded files
- **MongoDB**: For storing file metadata and enabling search
- **Kafka**: For publishing events when resources are created, updated, or deleted
- **Service Discovery**: For registration and discovery via Consul

#### Key Features:

- Secure file uploads with configurable size limits
- File metadata management with MongoDB
- Access control based on user roles and resource ownership
- Integration with search indexing through Kafka events
- Support for various file types with proper MIME type handling

#### API Endpoints:

```
POST   /api/resources            # Upload a new resource
GET    /api/resources/:id        # Get resource metadata by ID
GET    /api/resources            # List resources with filtering and pagination
GET    /api/resources/download/:id # Download a resource file
PUT    /api/resources/:id        # Update resource metadata
DELETE /api/resources/:id        # Delete a resource
GET    /api/resources/user/:userId # Get resources by owner ID
```

## Comprehensive Testing Guide

This section outlines the comprehensive testing strategy for the Knowledge Garden backend services.

### 1. Unit Testing

Each service contains unit tests that verify individual components in isolation:

```bash
# Run unit tests across all services
npm run test:unit

# Run tests for a specific service
cd api-gateway && npm test
cd ../authentication && npm test
cd ../resources && npm test
cd ../search && npm test
```

Unit tests cover:

- Controllers
- Services
- Models
- Middleware
- Utility functions

#### Test Coverage Requirements

- Minimum 80% line coverage
- Minimum 70% branch coverage
- All critical paths must have tests

### 2. Integration Testing

Integration tests verify that different components work together correctly:

```bash
# Run integration tests
npm run test:integration
```

Integration tests cover:

- Database operations
- Service interactions
- Authentication flows
- Search indexing and querying
- Kafka event handling

#### Integration Test Requirements

- Must use a separate test database
- Should clean up all test data after completion
- Should verify all microservice interactions

### 3. End-to-End Testing

E2E tests verify the entire application flow from API requests to database operations:

```bash
# Run E2E tests
npm run test:e2e
```

E2E tests cover:

- Complete user journeys
- API request/response cycles
- Authentication flows
- Document operations
- Search functionality

#### E2E Test Requirements

- Tests should run against isolated test services
- Tests should verify API responses meet specifications
- Should test error conditions and edge cases

### 4. Performance Testing

Performance tests evaluate system behavior under load:

```bash
# Run performance tests
npm run test:performance
```

#### Using Apache Bench

```bash
# Test API Gateway health endpoint (1000 requests, 50 concurrent)
ab -n 1000 -c 50 http://localhost:5000/health

# Test authenticated endpoint (100 requests, 10 concurrent)
ab -n 100 -c 10 -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/auth/profile

# Test search service (500 requests, 20 concurrent)
ab -n 500 -c 20 "http://localhost:5000/api/search?q=test"
```

#### Using JMeter

The repository includes JMeter test plans for more advanced performance testing:

```bash
# Run JMeter tests
jmeter -n -t performance/test-plans/api-gateway-load-test.jmx -l results.jtl -e -o report
```

#### Performance Requirements

- API Gateway: Must handle 100 requests/second with <500ms response time
- Authentication Service: Must handle 50 logins/second with <1s response time
- Search Service: Must handle 20 search queries/second with <2s response time

### 5. Service Discovery Testing

To test the service discovery functionality:

```bash
# Start multiple instances of the search service
cd search
PORT=5003 npm run dev
PORT=5004 npm run dev

# Verify instances in Consul
curl http://localhost:8500/v1/catalog/service/search-service

# Test load balancing
for i in {1..20}; do curl -s "http://localhost:5000/api/search/health" | jq '.instance_id'; done
```

### 6. Kafka Event Testing

Test Kafka event production and consumption:

```bash
# Create test document to trigger indexing events
curl -X POST http://localhost:5000/api/search/documents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title": "Kafka Test Document",
    "content": "Testing Kafka events for document indexing",
    "is_public": true
  }'

# Upload a resource file to trigger resource events
curl -X POST http://localhost:5000/api/resources \
  -H "Authorization: Bearer $TOKEN" \
  -F "resource=@test.pdf" \
  -F "title=Kafka Test Resource" \
  -F "resourceType=document"

# Verify document was indexed asynchronously (may take a moment)
curl -X GET "http://localhost:5000/api/search?q=kafka+test" \
  -H "Authorization: Bearer $TOKEN"

# View Kafka topics and messages
kafkacat -b localhost:9092 -L
kafkacat -b localhost:9092 -t document.created -C -e
```

### 7. Security Testing

Security tests verify that the system is protected against common vulnerabilities:

```bash
# Run security tests
npm run test:security
```

Security tests cover:

- Authentication bypass attempts
- Authorization checks
- Input validation
- SQL injection protection
- NoSQL injection protection
- JWT security

#### OWASP ZAP Scanning

```bash
# Run OWASP ZAP scan against API endpoints
docker run -v $(pwd)/security-reports:/zap/wrk/:rw -t owasp/zap2docker-stable \
  zap-baseline.py -t http://host.docker.internal:5000 -g gen.conf -r security-report.html
```

### 8. Automated Test Pipelines

The repository includes GitHub Actions workflows for CI/CD:

- **Pull Request Workflow**: Runs unit and integration tests
- **Main Branch Workflow**: Runs all tests including E2E and security tests
- **Release Workflow**: Runs all tests and performance tests

## Debugging and Troubleshooting

### Common Issues and Solutions

#### Service Discovery Issues

```bash
# Check if Consul is running
curl http://localhost:8500/v1/status/leader

# Check registered services
curl http://localhost:8500/v1/catalog/services

# Deregister problematic service
curl -X PUT http://localhost:8500/v1/agent/service/deregister/service-id
```

#### Kafka Issues

```bash
# Check if topics exist
kafkacat -b localhost:9092 -L | grep document

# Manually create required topics if missing
kafka-topics --bootstrap-server localhost:9092 --create --topic document.created --partitions 3 --replication-factor 1

# Check consumer groups
kafka-consumer-groups --bootstrap-server localhost:9092 --list
```

#### Database Connection Issues

```bash
# Check PostgreSQL connection
pg_isready -h localhost -p 5432

# Check MongoDB connection
mongo --eval "db.runCommand({ping:1})"

# Check Elasticsearch connection
curl -X GET "localhost:9200/_cat/health"
```

### Debug Logging

To enable detailed debug logging:

```bash
# Set environment variable
export LOG_LEVEL=debug

# Restart the services with debug logging
cd api-gateway && npm run dev:debug
```

## Monitoring and Observability

### Health Check Endpoints

```bash
# API Gateway health (includes downstream services)
curl http://localhost:5000/health

# Authentication service health
curl http://localhost:5001/health

# Resources service health
curl http://localhost:3000/health

# Search service health
curl http://localhost:5002/health
```

### Service Metrics

The system exposes Prometheus metrics at the `/metrics` endpoint:

```bash
# Get API Gateway metrics
curl http://localhost:5000/metrics

# Get authentication service metrics
curl http://localhost:5001/metrics

# Get search service metrics
curl http://localhost:5002/metrics
```

### Logging and Monitoring Dashboard

For production deployments, the following stack is recommended:

- Elasticsearch, Logstash, Kibana (ELK) for log aggregation
- Prometheus and Grafana for metrics visualization

## API Documentation

For detailed API documentation, refer to the Swagger documentation available at:

```
http://localhost:5000/api-docs
```

## Contributing

### Pull Request Process

1. Ensure all tests pass before submitting a pull request
2. Update the documentation to reflect any changes
3. Include unit tests for new features or bug fixes
4. Maintain minimum code coverage requirements
5. Follow code style guidelines

### Code Quality Standards

- ESLint configuration is included in the repository
- Prettier is used for code formatting
- All code must pass linting checks before merge

## License

This project is licensed under the MIT License - see the LICENSE.md file for details.

