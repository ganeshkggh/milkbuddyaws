const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCustomerFields } = require("../src/controllers/customerController");

const validCustomer = {
  name: "  Test Customer  ",
  phone: "9876543210",
  ratePerLiter: "36",
  dailyQuantity: "10",
  billingCycleDays: "30",
  shift: "Both",
  product: "Milk",
  products: ["Milk", "Curd"],
  alternatePhone: "9123456789",
  address: "Address",
};

test("customer fields are normalized and validated", () => {
  const fields = validateCustomerFields(validCustomer);
  assert.equal(fields.name, "Test Customer");
  assert.equal(fields.phone, "9876543210");
  assert.equal(fields.ratePerLiter, 36);
  assert.equal(fields.dailyQuantity, 10);
  assert.equal(fields.billingCycleDays, 30);
  assert.equal(fields.shift, "Both");
  assert.deepEqual(fields.products, ["Milk", "Curd"]);
});

test("invalid customer fields produce client validation errors", () => {
  assert.throws(() => validateCustomerFields({ ...validCustomer, phone: "123" }), { statusCode: 400 });
  assert.throws(() => validateCustomerFields({ ...validCustomer, ratePerLiter: "NaN" }), { statusCode: 400 });
  assert.throws(() => validateCustomerFields({ ...validCustomer, dailyQuantity: -1 }), { statusCode: 400 });
  assert.throws(() => validateCustomerFields({ ...validCustomer, billingCycleDays: 0 }), { statusCode: 400 });
  assert.throws(() => validateCustomerFields({ ...validCustomer, shift: "Night" }), { statusCode: 400 });
  assert.throws(() => validateCustomerFields({ ...validCustomer, products: "Milk" }), { statusCode: 400 });
});

test("customer partial updates validate only supplied fields", () => {
  assert.deepEqual(validateCustomerFields({ dailyQuantity: "0" }, true), { dailyQuantity: 0 });
  assert.throws(() => validateCustomerFields({ ratePerLiter: -1 }, true), { statusCode: 400 });
});
