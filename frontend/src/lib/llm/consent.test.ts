import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { clearLocalConsent, getLocalConsent, setDownloadModel, setUseLiteModel } from "./consent";

describe("local consent", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    clearLocalConsent();
  });

  it("returns empty object when nothing is stored", () => {
    expect(getLocalConsent()).toEqual({});
  });

  it("persists download grant", () => {
    setDownloadModel("granted");
    expect(getLocalConsent().downloadModel).toBe("granted");
  });

  it("persists download denial separately from grant", () => {
    setDownloadModel("granted");
    setDownloadModel("denied");
    expect(getLocalConsent().downloadModel).toBe("denied");
  });

  it("persists Lite model preference", () => {
    setUseLiteModel(true);
    expect(getLocalConsent().useLiteModel).toBe(true);
  });

  it("clearLocalConsent removes the key", () => {
    setDownloadModel("granted");
    clearLocalConsent();
    expect(getLocalConsent()).toEqual({});
  });

  it("ignores corrupt stored JSON", () => {
    window.localStorage.setItem("snacks.llm.localConsent", "{not json");
    expect(getLocalConsent()).toEqual({});
  });
});
