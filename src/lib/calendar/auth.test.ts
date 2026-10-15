import { afterEach, expect, it, vi } from "vitest";
interface Response {
  access_token?: string;
  scope?: string;
  expires_in: number;
}
async function setup() {
  vi.resetModules();
  vi.useFakeTimers();
  let callback: (response: Response) => void = () => {};
  let errorCallback: () => void = () => {};
  const request = vi.fn();
  const init = vi.fn((config) => {
    callback = config.callback;
    errorCallback = config.error_callback;
    return { requestAccessToken: request };
  });
  const revoke = vi.fn((_token, done) => done({ successful: true }));
  const script = { src: "", async: false, onload: () => {}, remove: vi.fn() };
  vi.stubGlobal("document", {
    createElement: () => script,
    head: { append: () => script.onload() },
  });
  vi.stubGlobal("window", {
    google: { accounts: { oauth2: { initTokenClient: init, revoke } } },
  });
  const auth = await import("./auth");
  await auth.loadIdentity();
  return {
    auth,
    init,
    request,
    revoke,
    respond: (response: Response) => callback(response),
    fail: () => errorCallback(),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("requests only read scopes, keeps tokens in memory, and expires them", async () => {
  const { auth, request, init, respond } = await setup();
  const pending = auth.authorize("public-client-id");
  expect(request).toHaveBeenCalledWith({ prompt: "select_account" });
  expect(init.mock.calls[0][0].include_granted_scopes).toBe(false);
  respond({
    access_token: "test-token",
    scope: auth.scopes.join(" "),
    expires_in: 3600,
  });
  await expect(pending).resolves.toBe("test-token");
  expect(auth.accessToken()).toBe("test-token");
  vi.advanceTimersByTime(3600000);
  expect(auth.accessToken()).toBeUndefined();
});
it("rejects partial grants and late callbacks after cancellation", async () => {
  const { auth, respond } = await setup();
  const partial = auth.authorize("id");
  respond({
    access_token: "test-token",
    scope: auth.scopes[0],
    expires_in: 3600,
  });
  await expect(partial).rejects.toThrow("Both read-only");
  expect(auth.accessToken()).toBeUndefined();
  const cancelled = auth.authorize("id");
  auth.clearToken();
  respond({
    access_token: "test-token",
    scope: auth.scopes.join(" "),
    expires_in: 3600,
  });
  await expect(cancelled).rejects.toThrow("cancelled");
  expect(auth.accessToken()).toBeUndefined();
});
it("reports popup failure and times out without accepting late tokens", async () => {
  const { auth, respond, fail } = await setup();
  const failed = auth.authorize("id");
  fail();
  await expect(failed).rejects.toThrow("blocked");
  const timedOut = auth.authorize("id");
  const rejected = expect(timedOut).rejects.toThrow("timed out");
  vi.advanceTimersByTime(90000);
  await rejected;
  respond({
    access_token: "test-token",
    scope: auth.scopes.join(" "),
    expires_in: 3600,
  });
  expect(auth.accessToken()).toBeUndefined();
});
it("clears local credentials and reports whether Google revocation succeeded", async () => {
  const { auth, respond, revoke } = await setup();
  const pending = auth.authorize("id");
  respond({
    access_token: "test-token",
    scope: auth.scopes.join(" "),
    expires_in: 3600,
  });
  await pending;
  expect(await auth.revokeAccess()).toBe(true);
  expect(revoke).toHaveBeenCalled();
  expect(auth.accessToken()).toBeUndefined();
  expect(await auth.revokeAccess()).toBe(false);
});
