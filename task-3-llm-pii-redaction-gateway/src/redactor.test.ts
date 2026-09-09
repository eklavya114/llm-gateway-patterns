import assert from "node:assert/strict";
import { StreamRedactor } from "./redactor.js";

function runStream(chunks: string[]): string {
  const redactor = new StreamRedactor();
  let out = "";
  for (const chunk of chunks) {
    out += redactor.push(chunk);
  }
  out += redactor.flush();
  return out;
}

// (a) PII fully inside one chunk
{
  const out = runStream(["Contact me at bob@example.com please."]);
  assert.ok(out.includes("[REDACTED]"), "email in single chunk should be redacted");
  assert.ok(!out.includes("bob@example.com"), "raw email must not leak");
  console.log("PASS: PII fully inside one chunk");
}

// (b) PII split across a chunk boundary
{
  const out = runStream(["My SSN is 123-", "45-6789, keep it safe."]);
  assert.ok(out.includes("[REDACTED]"), "SSN split across chunks should be redacted");
  assert.ok(!out.includes("123-45-6789"), "raw SSN must not leak");
  console.log("PASS: PII split across chunk boundary");
}

{
  const out = runStream(["reach jane.doe@exam", "ple.com for support"]);
  assert.ok(out.includes("[REDACTED]"), "email split across chunks should be redacted");
  assert.ok(!out.includes("jane.doe@example.com"), "raw email must not leak");
  console.log("PASS: email split across chunk boundary");
}

// (c) non-PII text streams through unmodified
{
  const chunks = ["This is ", "just plain ", "conversational text ", "with nothing sensitive."];
  const out = runStream(chunks);
  assert.equal(out, chunks.join(""), "plain text must pass through unchanged");
  console.log("PASS: non-PII text streams through unmodified");
}

// per-chunk flush should not wait for the whole stream (sanity: early chunks
// produce output before flush(), given enough chunk volume to exceed HOLD_BACK)
{
  const redactor = new StreamRedactor();
  const early = redactor.push("x".repeat(100));
  assert.ok(early.length > 0, "large early chunk should flush immediately, not wait for stream end");
  console.log("PASS: large chunk flushes before stream end");
}

// (d) card number fully inside one chunk
{
  const out = runStream(["Your card on file is 4111111111111234, thanks."]);
  assert.ok(out.includes("[REDACTED]"), "card number in single chunk should be redacted");
  assert.ok(!out.includes("4111111111111234"), "raw card number must not leak");
  console.log("PASS: card number fully inside one chunk");
}

// (e) card number split across a chunk boundary, same failure mode that
// already caught email/SSN splits, now proven for the card pattern too
{
  const out = runStream(["The card ending in 1234 is 41111111", "11111234, confirmed."]);
  assert.ok(out.includes("[REDACTED]"), "card number split across chunks should be redacted");
  assert.ok(!out.includes("4111111111111234"), "raw card number must not leak across the split");
  console.log("PASS: card number split across chunk boundary");
}

// (f) card number grouped with dashes or spaces, the two formats the spec
// calls out explicitly alongside the plain 16 digit form
{
  const dashed = runStream(["Card: 4111-1111-1111-1234 on file."]);
  assert.ok(dashed.includes("[REDACTED]"), "dash grouped card number should be redacted");
  assert.ok(!dashed.includes("4111-1111-1111-1234"), "raw dash grouped card number must not leak");

  const spaced = runStream(["Card: 4111 1111 1111 1234 on file."]);
  assert.ok(spaced.includes("[REDACTED]"), "space grouped card number should be redacted");
  assert.ok(!spaced.includes("4111 1111 1111 1234"), "raw space grouped card number must not leak");

  console.log("PASS: dash and space grouped card numbers");
}

// (g) a digit run just under the 13 digit floor must pass through untouched,
// proving the pattern isn't so loose it catches ordinary numbers like a
// phone number or an order id
{
  const out = runStream(["Order number 411111111111 was placed today."]);
  assert.ok(out.includes("411111111111"), "12 digit number below the card floor must not be redacted");
  assert.ok(!out.includes("[REDACTED]"), "no pattern should match a 12 digit number");
  console.log("PASS: digit run under the card length floor is left alone");
}

console.log("\nAll redactor tests passed.");
