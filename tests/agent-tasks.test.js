const test = require("node:test");
const assert = require("node:assert/strict");
const { getIndiaDayRange, buildAgentTasks } = require("../src/services/agentTaskService");
const { withDeliveryStatus } = require("../src/controllers/deliveryController");

test("agent task day range uses Kolkata midnight, independent of server timezone", () => {
  const { fromDate, toDate } = getIndiaDayRange("2026-10-15");
  assert.equal(fromDate.toISOString(), "2026-10-14T18:30:00.000Z");
  assert.equal(toDate.toISOString(), "2026-10-15T18:30:00.000Z");
});

test("agent task date rejects invalid or non-ISO calendar values", () => {
  assert.throws(() => getIndiaDayRange("2026-02-30"), { statusCode: 400 });
  assert.throws(() => getIndiaDayRange("15-10-2026"), { statusCode: 400 });
});

test("Both-shift tasks remain independent and never match another product", () => {
  const customer = {
    _id: "customer-1",
    name: "Two Shift Customer",
    shift: "Both",
    product: "Milk",
    products: ["Milk", "Curd"],
    dailyQuantity: 2,
    ratePerLiter: 18,
  };
  const deliveries = [
    {
      _id: "delivery-morning-milk",
      customerId: "customer-1",
      shift: "Morning",
      product: "Milk",
      quantityLiters: 2,
      amount: 36,
      isNoDelivery: false,
    },
    {
      _id: "delivery-evening-curd",
      customerId: "customer-1",
      shift: "Evening",
      product: "Curd",
      quantityLiters: 1,
      amount: 18,
      isNoDelivery: false,
    },
  ];

  const result = buildAgentTasks([customer], deliveries, new Date("2026-10-14T18:30:00.000Z"));
  const taskFor = (shift, product) => result.tasks.find((task) => task.shift === shift && task.product === product);

  assert.equal(result.count, 4);
  assert.equal(taskFor("Morning", "Milk").status, "completed");
  assert.equal(taskFor("Evening", "Milk").status, "pending");
  assert.equal(taskFor("Morning", "Curd").status, "pending");
  assert.equal(taskFor("Evening", "Curd").status, "completed");
  assert.equal(taskFor("Morning", "Milk").deliveryId, "delivery-morning-milk");
  assert.equal(result.summary.completedTasks, 2);
  assert.equal(result.summary.pendingTasks, 2);
  assert.equal(result.summary.totalMilkLiters, 3);
});

test("No Delivery status is limited to its exact shift and product", () => {
  const result = buildAgentTasks(
    [{ _id: "customer-2", name: "Single Shift", shift: "Morning", product: "Milk", dailyQuantity: 1, ratePerLiter: 30 }],
    [{ _id: "no-delivery", customerId: "customer-2", shift: "Morning", product: "Milk", isNoDelivery: true, quantityLiters: 0, amount: 0 }],
    new Date("2026-10-14T18:30:00.000Z"),
  );

  assert.equal(result.tasks[0].status, "no_delivery");
  assert.equal(result.summary.noDeliveryCount, 1);
  assert.equal(result.summary.completedTasks, 0);
});

test("delivery create/update response derives status from the persisted No Delivery flag", () => {
  assert.equal(withDeliveryStatus({ _id: "delivery-1", isNoDelivery: false }).status, "completed");
  assert.equal(withDeliveryStatus({ _id: "delivery-2", isNoDelivery: true }).status, "no_delivery");
});