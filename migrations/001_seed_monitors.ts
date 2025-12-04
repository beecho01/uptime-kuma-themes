/**
 * Migration: Seed Monitors for Mock Server Endpoints
 *
 * This migration adds monitors to the Uptime Kuma database for each
 * mock server endpoint. It uses Bun's native SQLite module.
 *
 * Run with: bun run migrations/001_seed_monitors.ts
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Configuration
const DB_PATH = join(import.meta.dir, "..", "data", "kuma.db");
const MOCK_SERVER_BASE = "http://host.docker.internal:3000";
const DEFAULT_USER_ID = 1;

// Monitor definitions matching server/index.ts endpoints
const monitors = [
  // Always states
  { name: "Always Up", path: "/always-up", description: "Always returns 200 OK" },
  { name: "Always Down", path: "/always-down", description: "Always returns 500 error" },

  // Failure patterns
  { name: "Random Failures (20%)", path: "/random-failures", description: "20% chance of failure" },
  { name: "Frequent Failures (50%)", path: "/frequent-failures", description: "50% chance of failure" },
  { name: "Intermittent (Every 3rd)", path: "/intermittent", description: "Fails every 3rd request" },
  { name: "Flapping", path: "/flapping", description: "Alternates between up and down" },

  // Timing issues
  { name: "Slow Response", path: "/slow-response", description: "2-5 second delay", timeout: 10 },
  { name: "Very Slow", path: "/very-slow", description: "10-15 second delay (may timeout)", timeout: 20 },
  { name: "Timeout Simulation", path: "/timeout", description: "Never responds (tests timeout handling)", timeout: 5 },
  { name: "Memory Leak Sim", path: "/memory-leak", description: "Gets slower with each request" },

  // Status variations
  { name: "Degraded Status", path: "/degraded", description: "Returns 200 with degraded status" },
  { name: "Maintenance Mode", path: "/maintenance", description: "Returns 503 maintenance mode" },
  { name: "Scheduled Downtime", path: "/scheduled-down", description: "Down during minutes 0-5 and 30-35" },
  { name: "Partial Outage", path: "/partial-outage", description: "Random partial service outage" },
  { name: "Rate Limited", path: "/rate-limited", description: "Returns 429 after 10 req/min" },

  // Health checks
  { name: "Health Check", path: "/health", description: "Detailed health check response" },
  { name: "Ping", path: "/ping", description: "Simple ping/pong" },
  { name: "Keyword Check", path: "/keyword-check", description: "JSON with monitorable keywords", keyword: "OPERATIONAL" },
  { name: "HTML Status", path: "/html-status", description: "HTML page with status" },
  { name: "Cert Check", path: "/cert-check", description: "Certificate expiry simulation" },

  // Docker simulation
  { name: "Docker Healthy", path: "/docker/healthy", description: "Healthy container status" },
  { name: "Docker Unhealthy", path: "/docker/unhealthy", description: "Unhealthy container status" },
];

function seedMonitors(db: Database): void {
  // Prepare the insert statement
  const insertStmt = db.prepare(`
    INSERT INTO monitor (
      name,
      active,
      user_id,
      interval,
      url,
      type,
      weight,
      method,
      maxretries,
      ignore_tls,
      upside_down,
      maxredirects,
      accepted_statuscodes_json,
      dns_resolve_type,
      dns_resolve_server,
      retry_interval,
      http_body_encoding,
      timeout,
      resend_interval,
      packet_size,
      gamedig_given_port_only,
      kafka_producer_ssl,
      kafka_producer_allow_auto_topic_creation,
      mqtt_check_type,
      json_path_operator,
      cache_bust,
      conditions,
      ping_count,
      ping_numeric,
      ping_per_request_timeout,
      description,
      keyword
    ) VALUES (
      $name,
      1,
      $user_id,
      60,
      $url,
      'http',
      2000,
      'GET',
      0,
      0,
      0,
      10,
      '["200-299"]',
      'A',
      null,
      0,
      null,
      $timeout,
      0,
      56,
      1,
      0,
      0,
      'keyword',
      null,
      0,
      '[]',
      1,
      1,
      2,
      $description,
      $keyword
    )
  `);

  // Check for existing monitors to avoid duplicates
  const existingStmt = db.prepare("SELECT id FROM monitor WHERE url = $url");

  let inserted = 0;
  let skipped = 0;

  for (const monitor of monitors) {
    const url = `${MOCK_SERVER_BASE}${monitor.path}`;
    const existing = existingStmt.get({ $url: url });

    if (existing) {
      console.log(`⏭️  Skipping "${monitor.name}" (already exists)`);
      skipped++;
      continue;
    }

    insertStmt.run({
      $name: monitor.name,
      $user_id: DEFAULT_USER_ID,
      $url: url,
      $timeout: monitor.timeout ?? 48,
      $description: monitor.description,
      $keyword: monitor.keyword ?? null,
    });

    console.log(`✅ Inserted "${monitor.name}"`);
    inserted++;
  }

  console.log(`\n📊 Summary: ${inserted} inserted, ${skipped} skipped`);
}

function clearMonitors(db: Database): void {
  // Only delete monitors pointing to our mock server
  const result = db.run(`DELETE FROM monitor WHERE url LIKE '${MOCK_SERVER_BASE}%'`);
  console.log(`🗑️  Cleared ${result.changes} existing mock server monitors`);
}

function main(): void {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║         Uptime Kuma Monitor Seeder                         ║");
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log(`║  Database: ${DB_PATH.substring(DB_PATH.lastIndexOf("/") + 1).padEnd(47)}║`);
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Check if database exists
  if (!existsSync(DB_PATH)) {
    console.error(`❌ Database not found at: ${DB_PATH}`);
    console.error("   Make sure Uptime Kuma has been started at least once.");
    process.exit(1);
  }

  // Open database
  const db = new Database(DB_PATH);

  try {
    // Parse command line args
    const args = process.argv.slice(2);
    const shouldClear = args.includes("--clear") || args.includes("-c");
    const shouldForce = args.includes("--force") || args.includes("-f");

    if (shouldClear) {
      clearMonitors(db);
    }

    if (shouldForce) {
      clearMonitors(db);
    }

    seedMonitors(db);

    // Show current count
    const countResult = db.query("SELECT COUNT(*) as count FROM monitor").get() as { count: number };
    console.log(`\n📈 Total monitors in database: ${countResult.count}`);

  } finally {
    db.close();
  }

  console.log("\n✨ Migration complete!");
  console.log("💡 Restart Uptime Kuma to see the changes: bun run docker:down && bun run docker:up");
}

// Run migration
main();
