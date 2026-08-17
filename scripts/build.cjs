"use strict";

const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const version = packageJson.version;

if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("package.json must contain a semver version such as 1.0.0");
}

const clientSource = fs.readFileSync(
  path.join(projectRoot, "src", "client.js"),
  "utf8",
);
if (!clientSource.includes(`export const SDK_VERSION = "${version}";`)) {
  throw new Error(`SDK_VERSION must match package.json version ${version}`);
}

const common = {
  bundle: true,
  platform: "browser",
  target: ["es2018"],
  sourcemap: true,
  legalComments: "none",
};

async function buildModule(entry, basename) {
  await esbuild.build({
    ...common,
    entryPoints: [path.join(projectRoot, entry)],
    format: "esm",
    outfile: path.join(projectRoot, "dist", `${basename}.mjs`),
  });
  await esbuild.build({
    ...common,
    entryPoints: [path.join(projectRoot, entry)],
    format: "cjs",
    outfile: path.join(projectRoot, "dist", `${basename}.cjs`),
  });
}

async function main() {
  fs.rmSync(path.join(projectRoot, "dist"), { recursive: true, force: true });
  fs.rmSync(path.join(projectRoot, "index.js.map"), { force: true });
  fs.mkdirSync(path.join(projectRoot, "dist"), { recursive: true });

  await buildModule("src/index.js", "index");
  await buildModule("src/core.js", "core");
  await buildModule("src/unity.js", "unity");

  await esbuild.build({
    ...common,
    entryPoints: [path.join(projectRoot, "src", "browser.js")],
    format: "iife",
    sourcemap: false,
    outfile: path.join(projectRoot, "index.js"),
  });

  fs.copyFileSync(
    path.join(projectRoot, "index.d.ts"),
    path.join(projectRoot, "dist", "index.d.ts"),
  );
  fs.copyFileSync(
    path.join(projectRoot, "core.d.ts"),
    path.join(projectRoot, "dist", "core.d.ts"),
  );
  fs.copyFileSync(
    path.join(projectRoot, "unity.d.ts"),
    path.join(projectRoot, "dist", "unity.d.ts"),
  );

  const outputDirectory = path.join(projectRoot, "versions", version);
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [sourceName, outputName] of [
    ["index.js", "hooligapps.js"],
    ["index.d.ts", "hooligapps.d.ts"],
    ["README.md", "README.md"],
  ]) {
    fs.copyFileSync(
      path.join(projectRoot, sourceName),
      path.join(outputDirectory, outputName),
    );
  }

  console.log(`Built HApps JS SDK ${version}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
