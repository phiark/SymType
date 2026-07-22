import { statSync } from "node:fs";

import { captureEnvironmentMetadata } from "./lib/index.js";
import {
  measureFiles,
  scanRemoteFindings,
  sourceMapInventory,
  sourceModulesForFiles,
  sumFileMeasurements
} from "./p2-bundle-graph.mjs";
import { duplicateModules, manifestGraph, measureLocalTransfer } from "./p2-bundle-runtime.mjs";

export async function collectBundleEvidence(manifest, routes, webDist) {
  const jsRecords = measureFiles(webDist, routes.practiceFiles.javascript);
  const cssRecords = measureFiles(webDist, routes.practiceFiles.css);
  const assetRecords = measureFiles(webDist, routes.practiceFiles.assets);
  const javascript = sumFileMeasurements(jsRecords);
  const css = sumFileMeasurements(cssRecords);
  const assets = sumFileMeasurements(assetRecords);
  const indexRecord = measureFiles(webDist, ["index.html"])[0];
  const transfer = await measureLocalTransfer(routes.practiceFiles);
  const lazyChunks = collectLazyChunks(manifest, routes.entryFiles.javascript, webDist);
  const allJs = [
    ...new Set(
      Object.values(manifest)
        .map((entry) => entry.file)
        .filter(Boolean)
    )
  ];
  const allModules = sourceModulesForFiles(webDist, allJs);
  return {
    metrics: createBundleMetrics(javascript, css, transfer.bytes, lazyChunks[0]),
    practiceInitial: {
      javascript: { ...javascript, files: jsRecords },
      css: { ...css, files: cssRecords },
      assets: { ...assets, files: assetRecords },
      transfer: {
        rawBytes: javascript.rawBytes + css.rawBytes + assets.rawBytes + indexRecord.rawBytes,
        gzipBytes: javascript.gzipBytes + css.gzipBytes + assets.gzipBytes + indexRecord.gzipBytes,
        actualBytes: transfer.bytes,
        requests: transfer.requests
      }
    },
    lazyChunks,
    remote: scanRemoteFindings(webDist),
    sourceMaps: sourceMapInventory(webDist),
    duplicateModules: duplicateModules(allModules)
  };
}

function collectLazyChunks(manifest, initialJavaScript, webDist) {
  const initialFiles = new Set(initialJavaScript);
  const paths = [
    ...new Set(
      Object.values(manifest)
        .map((entry) => entry.file)
        .filter((path) => path?.endsWith(".js") && !initialFiles.has(path))
    )
  ];
  return paths
    .map((path) => measureFiles(webDist, [path])[0])
    .sort((left, right) => right.gzipBytes - left.gzipBytes);
}

function createBundleMetrics(javascript, css, transferBytes, maxLazy) {
  if (!maxLazy) throw new Error("No lazy route chunk was found.");
  return {
    "bundle.practice_js_gzip_kib": { unit: "KiB", value: javascript.gzipBytes / 1024 },
    "bundle.practice_css_gzip_kib": { unit: "KiB", value: css.gzipBytes / 1024 },
    "bundle.practice_transfer_kib": { unit: "KiB", value: transferBytes / 1024 },
    "bundle.max_lazy_chunk_gzip_kib": { unit: "KiB", value: maxLazy.gzipBytes / 1024 }
  };
}

export function createBundleFragment(input) {
  const { build, evidence, manifest, manifestPath, options, routes, webDist } = input;
  return {
    schemaVersion: 1,
    fragment: "bundle",
    environment: captureEnvironmentMetadata({
      command: "node --import tsx scripts/perf/run-bundle.mjs",
      cacheState: options.build ? "clean Vite outDir build" : "existing build"
    }),
    build,
    metrics: evidence.metrics,
    practiceInitial: evidence.practiceInitial,
    lazyChunks: evidence.lazyChunks,
    firstRouteExclusion: routes.exclusion,
    findings: {
      sourceMaps: evidence.sourceMaps,
      remoteFonts: evidence.remote.remoteFonts,
      probableRemoteRequests: evidence.remote.probableRequests,
      externalUrlLiterals: evidence.remote.urlLiterals,
      duplicateModules: evidence.duplicateModules
    },
    graph: manifestGraph(manifest),
    manifest: { path: manifestPath, byteSize: statSync(manifestPath).size },
    webDist
  };
}

export function bundleChecksPass(fragment) {
  const metrics = fragment.metrics;
  return (
    metrics["bundle.practice_js_gzip_kib"].value <= 220 &&
    metrics["bundle.practice_css_gzip_kib"].value <= 50 &&
    metrics["bundle.practice_transfer_kib"].value <= 400 &&
    metrics["bundle.max_lazy_chunk_gzip_kib"].value <= 250 &&
    fragment.firstRouteExclusion.pass &&
    fragment.findings.remoteFonts.length === 0 &&
    fragment.findings.probableRemoteRequests.length === 0
  );
}
