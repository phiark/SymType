import { describe, expect, it } from "vitest";

import { createServerFragment } from "./p2-server-report.mjs";

const measured = {
  reads: { metric: {}, scenarios: {} },
  commonSave: {},
  settingsSave: {},
  eventSave: {},
  nextBlock: { latency: {} },
  eventLoop: { count: 1, p99Ms: 1 }
};

describe("server performance evidence", () => {
  it("records a portable fixture path instead of the measurement machine path", () => {
    const fragment = createServerFragment(
      {
        id: "100k",
        path: "/Users/example/project/.symtype-perf-data/fixtures/100k.sqlite3",
        manifest: { relativePath: "fixtures/100k.sqlite3" }
      },
      { byteSize: 1, sha256: "fixture-sha", sqliteVersion: "3.53.2" },
      measured,
      { samples: 20, warmups: 5 }
    );

    expect(fragment.fixture.path).toBe("fixtures/100k.sqlite3");
  });

  it("uses only the filename for an external custom fixture", () => {
    const fragment = createServerFragment(
      {
        id: "custom",
        path: "/private/tmp/private-location/custom.sqlite3",
        manifest: null
      },
      { byteSize: 1, sha256: "fixture-sha", sqliteVersion: "3.53.2" },
      measured,
      { samples: 20, warmups: 5 }
    );

    expect(fragment.fixture.path).toBe("custom.sqlite3");
  });
});
