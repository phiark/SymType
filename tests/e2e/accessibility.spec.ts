import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { assertNoPageOverflow, finishOnboarding, restoreFreshE2eState } from "./helpers";

const primaryRoutes = ["/", "/train", "/test", "/game", "/analytics", "/settings"] as const;

test("primary routes meet automated WCAG 2.2 AA checks at desktop and 1024px", async ({
  page,
  request
}) => {
  await restoreFreshE2eState(request, { theme: "dark" });
  await finishOnboarding(page);

  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of primaryRoutes) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await assertNoPageOverflow(page);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        result.violations,
        `${route} at ${width}px:\n${result.violations
          .map(
            (violation) =>
              `${violation.id}: ${violation.help}\n${violation.nodes
                .map((node) => `  ${node.target.join(" ")}: ${node.failureSummary ?? ""}`)
                .join("\n")}`
          )
          .join("\n")}`
      ).toEqual([]);
    }
  }
});
