import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const failures = [];

const packageJson = JSON.parse(
  await readFile(join(workspace, "package.json"), "utf8")
);
const tauriConfig = JSON.parse(
  await readFile(join(workspace, "src-tauri", "tauri.conf.json"), "utf8")
);

if (packageJson.scripts?.dev !== "tauri dev") {
  failures.push('package.json scripts.dev must be "tauri dev"');
}
if (packageJson.scripts?.["dev:frontend"] !== "vite") {
  failures.push('package.json scripts.dev:frontend must be "vite"');
}
if (tauriConfig.build?.beforeDevCommand !== "pnpm dev:frontend") {
  failures.push(
    'tauri.conf.json beforeDevCommand must be "pnpm dev:frontend"'
  );
}

const migrationDirectory = join(workspace, "src-tauri", "migrations");
const migrations = (await readdir(migrationDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();
if (migrations.length !== 1 || migrations[0] !== "001_initial.sql") {
  failures.push(
    `current baseline must contain only 001_initial.sql; found ${migrations.join(", ")}`
  );
}

const forbidden = [
  ["Tauri runtime probing", /__TAURI_INTERNALS__|isTauriRuntime|isDesktopRuntime/g],
  ["browser persistence", /\blocalStorage\b|\bindexedDB\b|createJSONStorage|zustand\/persist/g],
  ["legacy snapshot migration", /validateDataIntegrityLegacy|migrateAppDataSnapshot|legacy_current/g],
  ["legacy JSON payload", /payload_json/g],
  ["mutable inventory mutation field", /deleteTransactionIds|delete_transaction_ids|upsertTransactions|upsert_transactions/g],
  ["retired page or sample", /LegacyStatisticsPage|PlaceholderPage|sampleData/g],
  ["generated legacy timeline id", /legacy-\$\{/g]
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(path));
    } else if ([".ts", ".tsx", ".rs", ".sql"].includes(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

const productionFiles = [
  ...await sourceFiles(join(workspace, "src")),
  ...await sourceFiles(join(workspace, "src-tauri", "src")),
  ...await sourceFiles(migrationDirectory)
].filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"));

for (const path of productionFiles) {
  const content = await readFile(path, "utf8");
  for (const [description, pattern] of forbidden) {
    pattern.lastIndex = 0;
    const match = pattern.exec(content);
    if (!match) continue;
    const line = content.slice(0, match.index).split(/\r?\n/).length;
    failures.push(
      `${description}: ${relative(workspace, path).replaceAll("\\", "/")}:${line} (${match[0]})`
    );
  }
}

const databaseSource = await readFile(
  join(workspace, "src-tauri", "src", "database.rs"),
  "utf8"
);
const productionDatabaseSource = databaseSource.split(
  /\r?\n#\[cfg\(test\)\]\r?\nmod tests/
)[0];
const inventoryDeletes = productionDatabaseSource.match(/DELETE FROM inventory_transactions/g) ?? [];
if (
  inventoryDeletes.length !== 1 ||
  !productionDatabaseSource.includes("allow_inventory_rewrite")
) {
  failures.push(
    "inventory transaction deletion must exist exactly once inside the guarded full-snapshot restore"
  );
}

if (failures.length) {
  console.error(
    "Storage architecture gate failed:\n" +
      failures.map((failure) => `- ${failure}`).join("\n")
  );
  process.exitCode = 1;
} else {
  console.log(
    `Storage architecture gate passed (${productionFiles.length} production source files scanned).`
  );
}
