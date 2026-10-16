const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateExtraMilkUpdate } = require("../src/controllers/deliveryController");

test("extra milk adds to existing quantity and recalculates amount from saved rate", () => {
  const result = calculateExtraMilkUpdate(
    { quantityLiters: 2, rateAtTime: 36, amount: 72, isNoDelivery: false },
    1,
  );

  assert.equal(result.additionalQuantityLiters, 1);
  assert.equal(result.quantityLiters, 3);
  assert.equal(result.amount, 108);

  const fractionalResult = calculateExtraMilkUpdate(
    { quantityLiters: 2, rateAtTime: 36, amount: 72, isNoDelivery: false },
    1.125,
  );
  assert.equal(fractionalResult.quantityLiters, 3.125);
  assert.equal(fractionalResult.amount, 112.5);
});

test("extra milk rejects invalid amounts and No Delivery rows", () => {
  const delivery = { quantityLiters: 2, rateAtTime: 36, isNoDelivery: false };
  assert.throws(() => calculateExtraMilkUpdate(delivery, 0), { statusCode: 400 });
  assert.throws(() => calculateExtraMilkUpdate(delivery, -1), { statusCode: 400 });
  assert.throws(() => calculateExtraMilkUpdate(delivery, "invalid"), { statusCode: 400 });
  assert.throws(() => calculateExtraMilkUpdate({ ...delivery, quantityLiters: 0, isNoDelivery: true }, 1), { statusCode: 400 });
});
