import { describe, expect, test } from "bun:test";
import { resolveAppVersion } from "../apps/web/build-metadata";

describe("web build metadata", () => {
  test("uses the exact release version on a tagged commit", () => {
    expect(resolveAppVersion("0.1.3", "v0.2.3-0-g2f052fa")).toBe("0.2.3");
  });

  test("identifies commits made after the latest release", () => {
    expect(resolveAppVersion("0.1.3", "v0.2.3-3-g96032af")).toBe("0.2.3+3");
  });

  test("falls back to package metadata when Git tags are unavailable", () => {
    expect(resolveAppVersion("0.2.3", null)).toBe("0.2.3");
    expect(resolveAppVersion("0.2.3", "not-a-release")).toBe("0.2.3");
  });
});
