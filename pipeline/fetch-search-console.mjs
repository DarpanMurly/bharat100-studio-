// Usage: node pipeline/fetch-search-console.mjs
// Pulls Google Search Console performance data (clicks, impressions,
// CTR, average position, top search queries) for bharatat100.com and
// writes content-queue/search-console-snapshot.json, then merged into
// the Content Desk artifact's analytics collection alongside Buffer/
// YouTube data by the caller (same pattern as fetch-analytics.mjs).
//
// NOTE: Google's "platform properties" (Instagram/X/YouTube channel
// search-performance tracking, added to Search Console July 2026) are
// NOT yet exposed by the public Search Console API — confirmed via
// direct testing 2026-09-07, sites.list() only returns the bharatat100.com
// website property. Revisit this script once/if Google exposes that data
// programmatically; don't assume a URL format and guess at it.
import { google } from "googleapis";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE_URL = "https://bharatat100.com/";

async function getAuthedClient() {
  const credentials = JSON.parse(await fs.readFile(path.join(ROOT, "youtube-client-secret.json"), "utf-8"));
  const token = JSON.parse(await fs.readFile(path.join(ROOT, "youtube-token.json"), "utf-8"));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  client.setCredentials(token);
  return client;
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  let auth;
  try {
    auth = await getAuthedClient();
  } catch (err) {
    console.log(`Skipping Search Console: ${err.code === "ENOENT" ? "no token file (run youtube-auth.mjs)" : err.message}`);
    return;
  }

  const searchconsole = google.searchconsole({ version: "v1", auth });

  // Search Console data typically has a 2-3 day reporting lag — request
  // a wide window (last 28 days) so an early/sparse period doesn't look
  // like a bug just because the site is new.
  const startDate = isoDaysAgo(28);
  const endDate = isoDaysAgo(2);

  console.log(`Fetching Search Console data for ${SITE_URL} (${startDate} to ${endDate})...`);

  let totals;
  try {
    const totalsRes = await searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: { startDate, endDate },
    });
    const rows = totalsRes.data.rows ?? [];
    totals = rows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  } catch (err) {
    console.log(`  Search Console query failed: ${err.message} — the site may still be too new for any data yet.`);
    totals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  }

  let topQueries = [];
  try {
    const queriesRes = await searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: { startDate, endDate, dimensions: ["query"], rowLimit: 20 },
    });
    topQueries = (queriesRes.data.rows ?? []).map((r) => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));
  } catch (err) {
    console.log(`  Top-queries query failed: ${err.message}`);
  }

  const summary = {
    fetchedAt: new Date().toISOString(),
    siteUrl: SITE_URL,
    dateRange: { startDate, endDate },
    totals: {
      clicks: totals.clicks ?? 0,
      impressions: totals.impressions ?? 0,
      ctr: totals.ctr ?? 0,
      position: totals.position ?? 0,
    },
    topQueries,
    // Explicitly present-but-empty, not omitted — makes clear in the
    // snapshot that platform properties were considered, not forgotten,
    // pending Google exposing this via API.
    platformProperties: null,
  };

  const outPath = path.join(ROOT, "content-queue", "search-console-snapshot.json");
  await fs.writeFile(outPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`Snapshot written to ${outPath}`);
  console.log(`Totals: ${summary.totals.clicks} clicks, ${summary.totals.impressions} impressions, ${topQueries.length} distinct queries`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
