import { describe, expect, it } from "vitest";

import { buildNativeCallbackURL, parseNativeHandoff } from "./native-handoff";

const params = (qs: string) => new URLSearchParams(qs);

describe("parseNativeHandoff", () => {
  it("returns the redirect for a valid native request", () => {
    expect(
      parseNativeHandoff(params("native=1&redirect_uri=budget://auth/callback")),
    ).toEqual({ redirectUri: "budget://auth/callback" });
  });

  it("returns null for an ordinary web login", () => {
    expect(parseNativeHandoff(params(""))).toBeNull();
  });

  it("returns null when native=1 is missing", () => {
    expect(
      parseNativeHandoff(params("redirect_uri=budget://auth/callback")),
    ).toBeNull();
  });

  it("returns null when redirect_uri is absent", () => {
    expect(parseNativeHandoff(params("native=1"))).toBeNull();
  });

  it("rejects a redirect_uri outside the allowlist", () => {
    // Guards against the login page becoming an open redirect that leaks a
    // one-time login code to an attacker-controlled target.
    expect(
      parseNativeHandoff(params("native=1&redirect_uri=https://evil.example/steal")),
    ).toBeNull();
    expect(
      parseNativeHandoff(params("native=1&redirect_uri=budget://auth/callback/../evil")),
    ).toBeNull();
    expect(
      parseNativeHandoff(params("native=1&redirect_uri=evil://auth/callback")),
    ).toBeNull();
  });
});

describe("buildNativeCallbackURL", () => {
  it("appends the code as the first query param", () => {
    expect(buildNativeCallbackURL("budget://auth/callback", "abc123")).toBe(
      "budget://auth/callback?code=abc123",
    );
  });

  it("percent-encodes the code", () => {
    expect(buildNativeCallbackURL("budget://auth/callback", "a b&c")).toBe(
      "budget://auth/callback?code=a%20b%26c",
    );
  });

  it("uses & when the redirect already has a query", () => {
    expect(buildNativeCallbackURL("budget://auth/callback?x=1", "abc")).toBe(
      "budget://auth/callback?x=1&code=abc",
    );
  });
});
