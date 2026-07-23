#!/usr/bin/env node

/* global Buffer, process */

import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseCliArguments, runCommand } from "./release-lib.mjs";

export const ICNS_PNG_TYPES = Object.freeze([
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024]
]);

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const RETAINED_PNG_CHUNKS = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "sRGB",
  "iCCP",
  "gAMA",
  "cHRM"
]);

export function pngDimensions(png) {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Icon source is not a PNG file");
  }
  if (png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Icon PNG does not begin with IHDR");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export function normalizePng(png) {
  pngDimensions(png);
  const chunks = [PNG_SIGNATURE];
  let offset = 8;
  let foundEnd = false;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > png.length) throw new Error("Icon PNG contains a truncated chunk");
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (RETAINED_PNG_CHUNKS.has(type)) chunks.push(png.subarray(offset, end));
    offset = end;
    if (type === "IEND") {
      foundEnd = true;
      break;
    }
  }
  if (!foundEnd) throw new Error("Icon PNG does not contain IEND");
  return Buffer.concat(chunks);
}

export function encodeIcns(entries) {
  const chunks = entries.map(({ type, png }) => {
    if (!/^[A-Za-z0-9]{4}$/.test(type)) throw new Error(`Invalid ICNS type: ${type}`);
    const chunk = Buffer.allocUnsafe(8 + png.length);
    chunk.write(type, 0, 4, "ascii");
    chunk.writeUInt32BE(chunk.length, 4);
    png.copy(chunk, 8);
    return chunk;
  });
  const totalLength = 8 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = Buffer.allocUnsafe(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(totalLength, 4);
  return Buffer.concat([header, ...chunks], totalLength);
}

export async function createIcon({ source, destination }) {
  const sourcePng = await readFile(source);
  const dimensions = pngDimensions(sourcePng);
  if (dimensions.width !== 1024 || dimensions.height !== 1024) {
    throw new Error(
      `App icon master must be 1024x1024, received ${dimensions.width}x${dimensions.height}`
    );
  }

  const workspace = await mkdtemp(join(tmpdir(), "symtype-icon-"));
  try {
    const entries = [];
    for (const [type, size] of ICNS_PNG_TYPES) {
      const path = join(workspace, `${size}.png`);
      if (size === 1024) {
        await copyFile(source, path);
      } else {
        await runCommand(
          "/usr/bin/sips",
          ["--resampleHeightWidth", String(size), String(size), source, "--out", path],
          { capture: true, quiet: true }
        );
      }
      const png = normalizePng(await readFile(path));
      const resized = pngDimensions(png);
      if (resized.width !== size || resized.height !== size) {
        throw new Error(
          `sips produced ${resized.width}x${resized.height} for required ${size}x${size}`
        );
      }
      entries.push({ type, png });
    }
    const icns = encodeIcns(entries);
    await writeFile(destination, icns, { mode: 0o644 });
    return { destination, bytes: icns.length, entries: ICNS_PNG_TYPES.length };
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "Unable to create AppIcon.icns because /usr/bin/sips is unavailable. Build on macOS with Xcode tools installed.",
        { cause: error }
      );
    }
    throw error;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseCliArguments(process.argv.slice(2));
  const source = resolve(
    options.source ??
      join(
        dirname(dirname(dirname(process.argv[1]))),
        "apps/macos/SymType/Resources/AppIcon-master.png"
      )
  );
  const destination = resolve(
    options.output ??
      join(dirname(dirname(dirname(process.argv[1]))), "apps/macos/SymType/Resources/AppIcon.icns")
  );
  const result = await createIcon({ source, destination });
  process.stdout.write(
    `${JSON.stringify({ status: "pass", source: basename(source), ...result }, null, 2)}\n`
  );
}
