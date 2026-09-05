// Usage: node pipeline/buffer-list-channels.mjs
// Fetches connected Buffer channels and prints their ids so they can be
// saved into .env — never prints the API key itself.

import "dotenv/config";

const API_KEY = process.env.BUFFER_API_KEY;

if (!API_KEY) {
  console.error("BUFFER_API_KEY not found in .env — check the file exists and is formatted correctly.");
  process.exit(1);
}

const ORG_QUERY = `
  query GetOrgs {
    account {
      organizations { id name }
    }
  }
`;

const CHANNELS_QUERY = `
  query GetChannels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      name
      service
      displayName
    }
  }
`;

async function graphql(query, variables) {
  const res = await fetch("https://api.buffer.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }
  return json.data;
}

async function main() {
  const { account } = await graphql(ORG_QUERY);
  const org = account.organizations[0];
  if (!org) {
    console.log("No organization found on this account.");
    return;
  }

  const { channels } = await graphql(CHANNELS_QUERY, { organizationId: org.id });

  console.log(`\nConnected Buffer channels (organization: ${org.name}):\n`);
  for (const ch of channels) {
    console.log(`  ${ch.service.padEnd(12)} ${ch.displayName || ch.name}`);
    console.log(`               id: ${ch.id}\n`);
  }

  console.log("Add these lines to .env:");
  for (const ch of channels) {
    const envName = `BUFFER_CHANNEL_${ch.service.toUpperCase()}`;
    console.log(`  ${envName}=${ch.id}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
