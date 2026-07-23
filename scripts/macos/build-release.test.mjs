import { describe, expect, it } from "vitest";

import { nativeReleaseBuildArguments } from "./build-release.mjs";

describe("native release build", () => {
  it("builds an optimized app with all coverage instrumentation disabled", () => {
    const arguments_ = nativeReleaseBuildArguments(
      "/source/apps/macos/SymType.xcodeproj",
      "/tmp/SymTypeDerivedData",
      7
    );

    expect(arguments_).toEqual(
      expect.arrayContaining([
        "-configuration",
        "Release",
        "CURRENT_PROJECT_VERSION=7",
        "ENABLE_CODE_COVERAGE=NO",
        "CLANG_ENABLE_CODE_COVERAGE=NO",
        "GCC_GENERATE_TEST_COVERAGE_FILES=NO",
        "GCC_INSTRUMENT_PROGRAM_FLOW_ARCS=NO"
      ])
    );
    expect(arguments_).not.toContain("-enableCodeCoverage");
    expect(arguments_.slice(-2)).toEqual(["clean", "build"]);
  });
});
