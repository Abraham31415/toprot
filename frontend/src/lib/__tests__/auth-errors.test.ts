import { describe, expect, it } from "vitest";
import { callbackError, friendlyAuthError } from "../auth-errors";

describe("friendlyAuthError", () => {
  it("explains a duplicate account and points to log in", () => {
    expect(friendlyAuthError("User already registered")).toMatch(/already exists/);
    expect(friendlyAuthError("A user with this email address has already been registered")).toMatch(/Log in/);
  });
  it("explains wrong credentials without saying which part was wrong", () => {
    const m = friendlyAuthError("Invalid login credentials");
    expect(m).toMatch(/email or password/);
  });
  it("covers unconfirmed email, rate limits, weak passwords and network failures", () => {
    expect(friendlyAuthError("Email not confirmed")).toMatch(/Confirm your email/);
    expect(friendlyAuthError("email rate limit exceeded")).toMatch(/Too many/);
    expect(friendlyAuthError("Password should be at least 8 characters")).toMatch(/stronger password/);
    expect(friendlyAuthError("TypeError: fetch failed")).toMatch(/could not reach/);
  });
  it("passes through messages it does not know", () => {
    expect(friendlyAuthError("Something unexpected")).toBe("Something unexpected");
  });
});

describe("callbackError", () => {
  it("maps the confirmation failure code and ignores everything else", () => {
    expect(callbackError("confirmation_failed")).toMatch(/did not work/);
    expect(callbackError("other")).toBeNull();
    expect(callbackError(undefined)).toBeNull();
  });
});
