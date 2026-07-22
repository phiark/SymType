import { describe, expect, it } from "vitest";

import { strategyForLocalDate } from "./experiment";

describe("local training algorithm alternation", () => {
  it("keeps every session on one local date in the same arm", () => {
    const morning = new Date(2026, 6, 20, 8, 0);
    const evening = new Date(2026, 6, 20, 22, 0);

    expect(strategyForLocalDate(true, morning)).toBe(strategyForLocalDate(true, evening));
  });

  it("alternates the arm on the following local date and stays adaptive when disabled", () => {
    const first = new Date(2026, 6, 20, 23, 59);
    const next = new Date(2026, 6, 21, 0, 1);

    expect(strategyForLocalDate(true, first)).not.toBe(strategyForLocalDate(true, next));
    expect(strategyForLocalDate(false, next)).toBe("adaptive");
  });
});
