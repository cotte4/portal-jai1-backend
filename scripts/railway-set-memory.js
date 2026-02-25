/**
 * Uses Railway GraphQL API to set backend service memory to 1024 MB.
 * Run: node scripts/railway-set-memory.js
 */
const https = require('https');

const TOKEN = 'c1273d98-f5d4-4ad6-9fee-fd7ab1f7d8f2';
const API = 'https://backboard.railway.app/graphql/v2';

function gql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request(API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // Step 1: find project + service IDs
  console.log('Fetching Railway projects...');
  const resp = await gql(`{
    projects {
      edges {
        node {
          id name
          services { edges { node { id name } } }
        }
      }
    }
  }`);

  if (resp.errors) {
    console.error('GraphQL error:', resp.errors);
    process.exit(1);
  }

  const projects = resp.data.projects.edges;
  projects.forEach(({ node: p }) => {
    console.log(`Project: ${p.name} (${p.id})`);
    p.services.edges.forEach(({ node: s }) => console.log(`  Service: ${s.name} (${s.id})`));
  });

  // Find the backend service (contains 'backend' in name)
  let serviceId = null;
  let projectId = null;
  for (const { node: p } of projects) {
    for (const { node: s } of p.services.edges) {
      if (s.name.toLowerCase().includes('backend')) {
        serviceId = s.id;
        projectId = p.id;
        console.log(`\nTargeting: ${s.name} (${s.id})`);
        break;
      }
    }
    if (serviceId) break;
  }

  if (!serviceId) {
    console.error('Could not find a service with "backend" in the name. Update the script to target the correct service.');
    process.exit(1);
  }

  // Step 2: update memory limit via serviceInstanceUpdate
  console.log('Setting memory to 1024 MB...');
  const update = await gql(`
    mutation ServiceInstanceUpdate($serviceId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, input: $input)
    }
  `, {
    serviceId,
    input: { memoryLimitMegabytes: 1024 },
  });

  if (update.errors) {
    console.error('Failed to update memory:', JSON.stringify(update.errors, null, 2));
    process.exit(1);
  }

  console.log('✅  Memory limit set to 1024 MB');
}

main();
