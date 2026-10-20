#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
function getContentTypeByPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({ ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".ts": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8" })[extension] || "application/octet-stream";
}

function parseArgs(argv) {
  const args = {
    sdkDir: path.resolve(__dirname, "../versions"),
    sdkPrefix: "sdk",
    version: null,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--sdk-dir") {
      args.sdkDir = path.resolve(process.cwd(), next || "");
      i += 1;
      continue;
    }
    if (token === "--sdk-prefix") {
      args.sdkPrefix = normalizePrefix((next || "").trim() || "sdk");
      i += 1;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--version") {
      if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
        throw new Error("--version requires a version folder, for example: 1.1.2");
      }
      args.version = next;
      i += 1;
      continue;
    }
  }

  return args;
}

function normalizePrefix(prefix) {
  return prefix.replace(/^\/+|\/+$/g, "");
}

function getSdkCacheControl(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (/^\d+\.\d+\.\d+\//.test(normalized)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600";
}

async function collectFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && /\.(?:js|mjs|ts|json|map|md)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function runConcurrently(items, concurrency, worker) {
  let index = 0;
  const runners = new Array(concurrency).fill(0).map(async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await worker(items[current]);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const args = parseArgs(process.argv);
  const sdkPath = args.sdkDir;
  const sdkPrefix = normalizePrefix(args.sdkPrefix);

  const sourcePath = args.version ? path.join(sdkPath, args.version) : sdkPath;
  const files = await collectFiles(sourcePath);
  if (!files.length) {
    throw new Error(`No SDK files found in: ${sourcePath}`);
  }

  const tasks = files.map((fullPath) => {
    const relativePath = path.relative(sdkPath, fullPath).replace(/\\/g, "/");
    return {
      fullPath,
      relativePath,
      key: `${sdkPrefix}/${relativePath}`,
    };
  });

  console.log(`[deploy-sdk-cdn] sdkDir=${sdkPath}`);
  console.log(`[deploy-sdk-cdn] sdkPrefix=${sdkPrefix}`);
  if (args.version) {
    console.log(`[deploy-sdk-cdn] version=${args.version}`);
  }
  console.log(`[deploy-sdk-cdn] uploads=${tasks.length}`);

  if (args.dryRun) {
    for (const task of tasks) console.log(`[planned] sdk: ${task.key}`);
    console.log("[deploy-sdk-cdn] dry-run enabled, no upload performed");
    return;
  }

  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
  const { S3_ENDPOINT, S3_BUCKET: bucket, S3_KEY_ID, S3_APPLICATION_KEY, S3_REGION } = process.env;
  if (!S3_ENDPOINT || !bucket || !S3_KEY_ID || !S3_APPLICATION_KEY) {
    throw new Error("Required: S3_ENDPOINT, S3_BUCKET, S3_KEY_ID, S3_APPLICATION_KEY");
  }
  const s3 = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION || "eu-central-003",
    forcePathStyle: false,
    credentials: { accessKeyId: S3_KEY_ID, secretAccessKey: S3_APPLICATION_KEY },
  });

  await runConcurrently(tasks, 8, async (task) => {
    const body = await fs.readFile(task.fullPath);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: task.key,
        Body: body,
        ContentType: getContentTypeByPath(task.fullPath),
        CacheControl: getSdkCacheControl(task.relativePath),
      }),
    );
    console.log(`[uploaded] sdk: ${task.key}`);
  });

  console.log("[deploy-sdk-cdn] done");
}

main().catch((error) => {
  console.error("[deploy-sdk-cdn] failed:", error.name || "Error");
  process.exitCode = 1;
});
