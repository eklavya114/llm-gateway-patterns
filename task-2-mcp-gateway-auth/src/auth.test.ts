import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { extractRole, AuthError } from "./auth.js";

const SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

function sign(payload: object, secret = SECRET, options?: jwt.SignOptions): string {
  return jwt.sign(payload, secret, options);
}

function assertAuthError(fn: () => void, messageIncludes: string) {
  try {
    fn();
    assert.fail("expected extractRole to throw AuthError");
  } catch (err) {
    assert.ok(err instanceof AuthError, "should throw AuthError specifically");
    assert.ok((err as Error).message.includes(messageIncludes), `expected message to include "${messageIncludes}", got "${(err as Error).message}"`);
  }
}

// missing header entirely
{
  assertAuthError(() => extractRole(undefined), "Missing or malformed");
  console.log("PASS: missing Authorization header rejected");
}

// malformed header, no Bearer prefix
{
  assertAuthError(() => extractRole("Basic abc123"), "Missing or malformed");
  console.log("PASS: non Bearer header rejected");
}

// Bearer with empty token
{
  assertAuthError(() => extractRole("Bearer "), "Missing bearer token");
  console.log("PASS: empty bearer token rejected");
}

// invalid signature, token signed with a different secret
{
  const token = sign({ role: "admin" }, "wrong-secret");
  assertAuthError(() => extractRole(`Bearer ${token}`), "Invalid or expired");
  console.log("PASS: token signed with wrong secret rejected");
}

// tampered token, valid shape but corrupted payload segment
{
  const validToken = sign({ role: "admin" });
  const parts = validToken.split(".");
  const tampered = `${parts[0]}.tampered.${parts[2]}`;
  assertAuthError(() => extractRole(`Bearer ${tampered}`), "Invalid or expired");
  console.log("PASS: tampered token rejected");
}

// expired token
{
  const expiredToken = sign({ role: "admin" }, SECRET, { expiresIn: -10 });
  assertAuthError(() => extractRole(`Bearer ${expiredToken}`), "Invalid or expired");
  console.log("PASS: expired token rejected");
}

// missing role claim
{
  const token = sign({ sub: "user-1" });
  assertAuthError(() => extractRole(`Bearer ${token}`), "missing valid role claim");
  console.log("PASS: token with no role claim rejected");
}

// role claim present but not admin or viewer
{
  const token = sign({ role: "superuser" });
  assertAuthError(() => extractRole(`Bearer ${token}`), "missing valid role claim");
  console.log("PASS: unrecognized role value rejected");
}

// valid admin token
{
  const token = sign({ role: "admin" });
  const role = extractRole(`Bearer ${token}`);
  assert.equal(role, "admin");
  console.log("PASS: valid admin token accepted");
}

// valid viewer token
{
  const token = sign({ role: "viewer" });
  const role = extractRole(`Bearer ${token}`);
  assert.equal(role, "viewer");
  console.log("PASS: valid viewer token accepted");
}

console.log("\nAll auth tests passed.");
