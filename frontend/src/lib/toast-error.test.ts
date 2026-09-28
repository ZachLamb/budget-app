import { describe, it, expect } from "vitest";
import { getApiErrorMessage } from "./toast-error";

const apiError = (detail: unknown) => ({ response: { data: { detail } } });

describe("getApiErrorMessage", () => {
  it("falls back when there is no detail to show", () => {
    expect(getApiErrorMessage(new Error("network"), "Something went wrong")).toBe(
      "Something went wrong",
    );
  });

  it("uses a plain string detail as-is", () => {
    expect(getApiErrorMessage(apiError("Rule not found"), "fallback")).toBe(
      "Rule not found",
    );
  });

  it("takes the first message out of a validation error list", () => {
    expect(
      getApiErrorMessage(apiError([{ msg: "Give something to match on." }]), "f"),
    ).toBe("Give something to match on.");
  });

  it("drops Pydantic's own label from a message written for a person", () => {
    // A validator's sentence arrives prefixed by the framework. The
    // prefix says nothing the user can act on and makes deliberate copy
    // read like an internal error leaked into the UI.
    expect(
      getApiErrorMessage(
        apiError([{ msg: "Value error, That is not a valid regular expression: bad escape" }]),
        "f",
      ),
    ).toBe("That is not a valid regular expression: bad escape");
  });

  it("drops the assertion label too", () => {
    expect(
      getApiErrorMessage(apiError([{ msg: "Assertion failed, Pick a category." }]), "f"),
    ).toBe("Pick a category.");
  });

  it("strips it from a string detail as well", () => {
    expect(
      getApiErrorMessage(apiError("Value error, Keep it under 200 characters."), "f"),
    ).toBe("Keep it under 200 characters.");
  });

  it("leaves a message that merely mentions a value alone", () => {
    // Only the framework's leading label goes -- not any sentence that
    // happens to contain the word.
    expect(
      getApiErrorMessage(apiError("That value error is expected"), "f"),
    ).toBe("That value error is expected");
  });

  it("falls back on an empty validation list", () => {
    expect(getApiErrorMessage(apiError([]), "fallback")).toBe("fallback");
  });
});
