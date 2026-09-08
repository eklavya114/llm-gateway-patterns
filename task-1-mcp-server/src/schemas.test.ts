import assert from "node:assert/strict";
import { customerIdSchema, getCustomerRecordSchema, triggerRefundSchema } from "./schemas.js";

// customer_id pattern: ^CUST-[A-Z0-9]{5}$
{
  assert.equal(customerIdSchema.safeParse("CUST-A1B2C").success, true, "valid id should pass");
  assert.equal(customerIdSchema.safeParse("CUST-1").success, false, "too short should fail");
  assert.equal(customerIdSchema.safeParse("CUST-ABCDEF").success, false, "too long should fail");
  assert.equal(customerIdSchema.safeParse("cust-a1b2c").success, false, "lowercase should fail");
  assert.equal(customerIdSchema.safeParse("CUST_A1B2C").success, false, "wrong separator should fail");
  assert.equal(customerIdSchema.safeParse("").success, false, "empty string should fail");
  console.log("PASS: customer_id regex boundaries");
}

// get_customer_record schema
{
  const valid = getCustomerRecordSchema.safeParse({ customer_id: "CUST-A1B2C" });
  assert.equal(valid.success, true, "well formed input should pass");

  const missing = getCustomerRecordSchema.safeParse({});
  assert.equal(missing.success, false, "missing customer_id should fail");

  const wrongType = getCustomerRecordSchema.safeParse({ customer_id: 12345 });
  assert.equal(wrongType.success, false, "non-string customer_id should fail");

  console.log("PASS: get_customer_record schema");
}

// trigger_refund schema: amount boundary
{
  const zero = triggerRefundSchema.safeParse({
    customer_id: "CUST-A1B2C",
    amount: 0,
    reason: "long enough reason text",
  });
  assert.equal(zero.success, false, "amount of exactly 0 should fail, positive() excludes zero");

  const negative = triggerRefundSchema.safeParse({
    customer_id: "CUST-A1B2C",
    amount: -5,
    reason: "long enough reason text",
  });
  assert.equal(negative.success, false, "negative amount should fail");

  const nonNumeric = triggerRefundSchema.safeParse({
    customer_id: "CUST-A1B2C",
    amount: "10",
    reason: "long enough reason text",
  });
  assert.equal(nonNumeric.success, false, "string amount should fail, no implicit coercion");

  const smallestValid = triggerRefundSchema.safeParse({
    customer_id: "CUST-A1B2C",
    amount: 0.01,
    reason: "long enough reason text",
  });
  assert.equal(smallestValid.success, true, "smallest positive amount should pass");

  console.log("PASS: trigger_refund amount boundary");
}

// trigger_refund schema: reason length boundary
{
  const nineChars = triggerRefundSchema.safeParse({
    customer_id: "CUST-A1B2C",
    amount: 10,
    reason: "123456789",
  });
  assert.equal(nineChars.success, false, "9 char reason should fail, below the 10 char minimum");

  const tenChars = triggerRefundSchema.safeParse({
    customer_id: "CUST-A1B2C",
    amount: 10,
    reason: "1234567890",
  });
  assert.equal(tenChars.success, true, "exactly 10 char reason should pass");

  console.log("PASS: trigger_refund reason length boundary");
}

console.log("\nAll schema tests passed.");
