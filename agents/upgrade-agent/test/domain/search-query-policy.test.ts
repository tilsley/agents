import { describe, expect, test } from "bun:test";
import { buildChangelogUrl } from "../../src/domain/policies/search-query-policy";

describe("buildChangelogUrl", () => {
  test("returns URL for known packages", () => {
    expect(buildChangelogUrl("react")).toContain("github.com");
    expect(buildChangelogUrl("typescript")).toContain("github.com");
    expect(buildChangelogUrl("aws-cdk-lib")).toContain("github.com");
  });

  test("returns null for unknown packages", () => {
    expect(buildChangelogUrl("some-obscure-package")).toBeNull();
  });
});
