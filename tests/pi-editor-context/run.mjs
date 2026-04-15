#!/usr/bin/env node

import { testCases } from "./cases.mjs";

function parseArgs(argv) {
  const options = {
    caseName: "",
    forceFail: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--case") {
      options.caseName = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--force-fail") {
      options.forceFail = true;
    }
  }

  return options;
}

function formatDuration(ms) {
  return `${ms.toFixed(1)}ms`;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const selected = options.caseName
    ? testCases.filter((item) => item.name === options.caseName)
    : testCases;

  if (selected.length === 0) {
    console.error(
      `FAIL No matching case for --case ${JSON.stringify(options.caseName)}`,
    );
    process.exit(2);
  }

  const results = [];

  for (const testCase of selected) {
    const start = performance.now();
    try {
      await testCase.run();
      const duration = performance.now() - start;
      results.push({
        name: testCase.name,
        ac: testCase.ac,
        status: "PASS",
        duration,
      });
      console.log(
        `PASS ${testCase.name} [${testCase.ac.join(", ")}] (${formatDuration(duration)})`,
      );
    } catch (error) {
      const duration = performance.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        name: testCase.name,
        ac: testCase.ac,
        status: "FAIL",
        duration,
        message,
      });
      console.log(
        `FAIL ${testCase.name} [${testCase.ac.join(", ")}] (${formatDuration(duration)})`,
      );
      console.log(`  ↳ ${message}`);
    }
  }

  if (options.forceFail) {
    results.push({
      name: "forced-failure-check",
      ac: ["META"],
      status: "FAIL",
      duration: 0,
      message: "Forced failure requested via --force-fail",
    });
    console.log("FAIL forced-failure-check [META] (0.0ms)");
    console.log("  ↳ Forced failure requested via --force-fail");
  }

  const passed = results.filter((item) => item.status === "PASS").length;
  const failed = results.filter((item) => item.status === "FAIL").length;

  console.log("");
  console.log(`Summary: ${passed} passed, ${failed} failed, ${results.length} total`);

  process.exit(failed > 0 ? 1 : 0);
}

await run();
