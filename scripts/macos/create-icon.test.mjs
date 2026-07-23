/* global Buffer */

import { describe, expect, it } from "vitest";

import { encodeIcns } from "./create-icon.mjs";

describe("ICNS encoder", () => {
  it("writes deterministic big-endian PNG payload chunks", () => {
    const first = Buffer.from("first");
    const second = Buffer.from("second");
    const icns = encodeIcns([
      { type: "icp4", png: first },
      { type: "ic10", png: second }
    ]);

    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    expect(icns.toString("ascii", 8, 12)).toBe("icp4");
    expect(icns.readUInt32BE(12)).toBe(8 + first.length);
    const secondOffset = 16 + first.length;
    expect(icns.toString("ascii", secondOffset, secondOffset + 4)).toBe("ic10");
    expect(icns.readUInt32BE(secondOffset + 4)).toBe(8 + second.length);
  });

  it("rejects an invalid chunk type", () => {
    expect(() => encodeIcns([{ type: "bad", png: Buffer.alloc(0) }])).toThrow("Invalid ICNS type");
  });
});
