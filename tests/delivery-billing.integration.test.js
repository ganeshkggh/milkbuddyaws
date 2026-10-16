const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const User = require("../src/models/User");
const Customer = require("../src/models/Customer");
const DeliveryAgent = require("../src/models/DeliveryAgent");
const Delivery = require("../src/models/Delivery");
const Bill = require("../src/models/Bill");
const Payment = require("../src/models/Payment");
const { createDelivery, getDeliveries, updateDelivery, deleteDelivery } = require("../src/controllers/deliveryController");
const { generateBill, getBills, getBillById, getCustomerBills, sendBillReceipt } = require("../src/controllers/billController");
const { addPayment } = require("../src/controllers/paymentController");
const { getCustomers, getCustomerById } = require("../src/controllers/customerController");
const { getAgentCustomers, getAgentTasks } = require("../src/controllers/agentController");
const { createCustomer, updateCustomer } = require("../src/controllers/customerController");
const { assignCustomerToAgent } = require("../src/controllers/deliveryAgentController");

const mongoTestUri = process.env.MONGODB_TEST_URI;

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const invoke = async (handler, userId, body = {}, params = {}, query = {}) => {
  const response = createResponse();
  await handler({ user: { userId: userId.toString() }, body, params, query }, response);
  return response;
};

if (!mongoTestUri) {
  test.skip("MongoDB transaction integration (set MONGODB_TEST_URI to a test replica set)", () => {});
} else {
  test("delivery, payment, bill and agent workflow is transactional and idempotent", async () => {
    const uri = new URL(mongoTestUri);
    const databaseName = decodeURIComponent(uri.pathname.replace(/^\//, ""));
    assert.match(databaseName, /test/i, "MONGODB_TEST_URI database name must include 'test'");
    await mongoose.connect(mongoTestUri);

    const suffix = new mongoose.Types.ObjectId().toString().slice(-10);
    const owned = { vendorId: null, secondVendorId: null, agentUserId: null, agentId: null, secondAgentUserId: null, secondAgentId: null, inactiveAgentUserId: null, inactiveAgentId: null, customerId: null, otherCustomerId: null, createdCustomerIds: [] };

    try {
      const vendor = await User.create({ mobileNumber: `91${suffix}`, name: "Integration Vendor", userType: "vendor", isActive: true });
      owned.vendorId = vendor._id;
      const secondVendor = await User.create({ mobileNumber: `92${suffix}`, name: "Other Vendor", userType: "vendor", isActive: true });
      owned.secondVendorId = secondVendor._id;
      const agentUser = await User.create({ mobileNumber: `93${suffix}`, name: "Integration Agent", userType: "agent", isActive: true });
      owned.agentUserId = agentUser._id;
      const agent = await DeliveryAgent.create({ vendorId: vendor._id, userId: agentUser._id, name: "Integration Agent", mobileNumber: `94${suffix}`, status: "active" });
      owned.agentId = agent._id;
      const secondAgentUser = await User.create({ mobileNumber: `96${suffix}`, name: "Other Vendor Agent", userType: "agent", isActive: true });
      owned.secondAgentUserId = secondAgentUser._id;
      const secondAgent = await DeliveryAgent.create({ vendorId: secondVendor._id, userId: secondAgentUser._id, name: "Other Vendor Agent", mobileNumber: `97${suffix}`, status: "active" });
      owned.secondAgentId = secondAgent._id;
      const inactiveAgentUser = await User.create({ mobileNumber: `98${suffix}`, name: "Inactive Agent", userType: "agent", isActive: true });
      owned.inactiveAgentUserId = inactiveAgentUser._id;
      const inactiveAgent = await DeliveryAgent.create({ vendorId: vendor._id, userId: inactiveAgentUser._id, name: "Inactive Agent", mobileNumber: `99${suffix}`, status: "inactive" });
      owned.inactiveAgentId = inactiveAgent._id;
      const customer = await Customer.create({
        vendorId: vendor._id,
        customerNumber: 900001,
        name: "Both Shift Customer",
        phone: "9876543210",
        ratePerLiter: 10,
        dailyQuantity: 1,
        shift: "Both",
        product: "Milk",
        products: ["Milk"],
        deliveryAgentId: agent._id,
        status: "active",
      });
      owned.customerId = customer._id;
      const otherCustomer = await Customer.create({
        vendorId: secondVendor._id,
        customerNumber: 900002,
        name: "Other Vendor Customer",
        phone: "9876543211",
        ratePerLiter: 10,
        shift: "Morning",
        product: "Milk",
        status: "active",
      });
      owned.otherCustomerId = otherCustomer._id;
      const unassignedCustomer = await Customer.create({
        vendorId: vendor._id,
        customerNumber: 900003,
        name: "Unassigned Customer",
        phone: "9876543212",
        ratePerLiter: 10,
        shift: "Morning",
        product: "Milk",
        status: "active",
        deliveryAgentId: null,
      });
      owned.createdCustomerIds.push(unassignedCustomer._id);

      const customerPhone = `9${suffix.replace(/\D/g, "").padStart(9, "0").slice(-9)}`;
      const createdCustomerResponse = await invoke(createCustomer, vendor._id, {
        name: "Validated Customer",
        phone: customerPhone,
        ratePerLiter: 36,
        dailyQuantity: 10,
        shift: "Morning",
        product: "Milk",
        billingCycleDays: 30,
        deliveryAgentId: agent._id.toString(),
      });
      assert.equal(createdCustomerResponse.statusCode, 201);
      assert.equal(createdCustomerResponse.body.customer.vendorId.toString(), vendor._id.toString());
      assert.equal(createdCustomerResponse.body.customer.deliveryAgentId.toString(), agent._id.toString());
      owned.createdCustomerIds.push(createdCustomerResponse.body.customer._id);

      const agentCustomerCreate = await invoke(createCustomer, agentUser._id, {
        name: "Should Not Create",
        phone: `8${customerPhone.slice(1)}`,
      });
      assert.equal(agentCustomerCreate.statusCode, 403);

      const foreignAgentCreate = await invoke(createCustomer, vendor._id, {
        name: "Foreign Assignment",
        phone: `8${customerPhone.slice(1)}`,
        deliveryAgentId: secondAgent._id.toString(),
      });
      assert.equal(foreignAgentCreate.statusCode, 404);

      const inactiveAgentCreate = await invoke(createCustomer, vendor._id, {
        name: "Inactive Assignment",
        phone: `7${customerPhone.slice(1)}`,
        deliveryAgentId: inactiveAgent._id.toString(),
      });
      assert.equal(inactiveAgentCreate.statusCode, 404);

      const malformedAgentCreate = await invoke(createCustomer, vendor._id, {
        name: "Malformed Assignment",
        phone: `6${customerPhone.slice(1)}`,
        deliveryAgentId: "not-an-object-id",
      });
      assert.equal(malformedAgentCreate.statusCode, 400);

      const foreignAgentUpdate = await invoke(updateCustomer, vendor._id, {
        deliveryAgentId: secondAgent._id.toString(),
      }, { id: customer._id.toString() });
      assert.equal(foreignAgentUpdate.statusCode, 404);
      const malformedAgentUpdate = await invoke(updateCustomer, vendor._id, {
        deliveryAgentId: "not-an-object-id",
      }, { id: customer._id.toString() });
      assert.equal(malformedAgentUpdate.statusCode, 400);

      const validAgentAssignment = await invoke(assignCustomerToAgent, vendor._id, {
        deliveryAgentId: agent._id.toString(),
      }, { customerId: customer._id.toString() });
      const foreignAgentAssignment = await invoke(assignCustomerToAgent, vendor._id, {
        deliveryAgentId: secondAgent._id.toString(),
      }, { customerId: customer._id.toString() });
      const agentAssignmentAttempt = await invoke(assignCustomerToAgent, agentUser._id, {
        deliveryAgentId: agent._id.toString(),
      }, { customerId: customer._id.toString() });
      assert.equal(validAgentAssignment.statusCode, 200);
      assert.equal(foreignAgentAssignment.statusCode, 404);
      assert.equal(agentAssignmentAttempt.statusCode, 403);

      const vendorCustomerRead = await invoke(getCustomerById, vendor._id, {}, { id: customer._id.toString() });
      const agentCustomerRead = await invoke(getCustomerById, agentUser._id, {}, { id: customer._id.toString() });
      const agentCustomerList = await invoke(getCustomers, agentUser._id);
      const agentAssignedList = await invoke(getAgentCustomers, agentUser._id);
      const agentTasks = await invoke(getAgentTasks, agentUser._id, {}, {}, { date: "2026-10-05" });
      const inaccessibleCustomerRead = await invoke(getCustomerById, agentUser._id, {}, { id: otherCustomer._id.toString() });
      assert.equal(vendorCustomerRead.statusCode, 200);
      assert.equal(agentCustomerRead.statusCode, 200);
      assert.equal(agentCustomerRead.body.customer._id.toString(), customer._id.toString());
      assert.deepEqual(agentCustomerList.body.customers.map((entry) => entry._id.toString()), [customer._id.toString(), createdCustomerResponse.body.customer._id.toString()]);
      assert.equal(agentAssignedList.body.customers[0]._id.toString(), customer._id.toString());
      assert.equal(agentTasks.body.tasks[0].customerId.toString(), customer._id.toString());
      assert.equal(inaccessibleCustomerRead.statusCode, 404);

      const morning = await invoke(createDelivery, agentUser._id, {
        customerId: customer._id.toString(), deliveryDate: "2026-10-05", quantityLiters: 1,
        shift: "Morning", product: "Milk", paymentChoice: "unpaid",
      });
      assert.equal(morning.statusCode, 201);
      assert.equal(morning.body.delivery.status, "completed");
      assert.equal(await Payment.countDocuments({ customerId: customer._id }), 0);

      const evening = await invoke(createDelivery, agentUser._id, {
        customerId: customer._id.toString(), deliveryDate: "2026-10-05", quantityLiters: 1,
        shift: "Evening", product: "Milk", paymentChoice: "unpaid",
      });
      assert.equal(evening.statusCode, 201);
      const refreshedAgentTasks = await invoke(getAgentTasks, agentUser._id, {}, {}, { date: "2026-10-05" });
      const morningTask = refreshedAgentTasks.body.tasks.find((task) => task.shift === "Morning" && task.product === "Milk");
      const eveningTask = refreshedAgentTasks.body.tasks.find((task) => task.shift === "Evening" && task.product === "Milk");
      assert.equal(morningTask.status, "completed");
      assert.equal(eveningTask.status, "completed");
      assert.equal(morningTask.deliveryId.toString(), morning.body.delivery._id.toString());
      assert.equal(eveningTask.deliveryId.toString(), evening.body.delivery._id.toString());

      const legacyDelivery = await Delivery.create({
        vendorId: vendor._id,
        customerId: customer._id,
        deliveryAgentId: agent._id,
        deliveryDate: new Date("2026-10-08T00:00:00+05:30"),
        quantityLiters: 1,
        rateAtTime: 10,
        amount: 10,
        shift: "Morning",
        product: "Milk",
        isNoDelivery: false,
      });
      assert.equal(legacyDelivery.deliveryDay, undefined);
      const legacyDeliveryList = await invoke(getDeliveries, vendor._id, {}, {}, { date: "2026-10-08" });
      const legacyAgentTasks = await invoke(getAgentTasks, agentUser._id, {}, {}, { date: "2026-10-08" });
      assert.equal(legacyDeliveryList.body.deliveries.length, 1);
      assert.equal(legacyAgentTasks.body.tasks.find((task) => task.customerId.toString() === customer._id.toString() && task.shift === "Morning" && task.product === "Milk").status, "completed");
      const legacyDuplicateUpdate = await invoke(updateDelivery, agentUser._id, {
        deliveryDate: "2026-10-08",
        shift: "Morning",
        product: "Milk",
      }, { id: evening.body.delivery._id.toString() });
      assert.equal(legacyDuplicateUpdate.statusCode, 409);
      const duplicate = await invoke(createDelivery, agentUser._id, {
        customerId: customer._id.toString(), deliveryDate: "2026-10-05", quantityLiters: 1,
        shift: "Morning", product: "Milk", paymentChoice: "unpaid",
      });
      assert.equal(duplicate.statusCode, 409);
      assert.equal(duplicate.body.duplicate, true);
      assert.equal(duplicate.body.delivery._id.toString(), morning.body.delivery._id.toString());

      const noDelivery = await invoke(createDelivery, agentUser._id, {
        customerId: customer._id.toString(), deliveryDate: "2026-10-02", isNoDelivery: true,
        shift: "Morning", product: "Milk", paymentChoice: "unpaid",
      });
      assert.equal(noDelivery.statusCode, 201);
      assert.equal(noDelivery.body.delivery.status, "no_delivery");
      assert.equal(noDelivery.body.delivery.quantityLiters, 0);
      assert.equal(noDelivery.body.delivery.amount, 0);

      const agentDeliveryUpdate = await invoke(updateDelivery, agentUser._id, {
        notes: "Updated by assigned agent",
      }, { id: evening.body.delivery._id.toString() });
      assert.equal(agentDeliveryUpdate.statusCode, 200);
      assert.equal(agentDeliveryUpdate.body.delivery.notes, "Updated by assigned agent");

      const vendorGeneratedBill = await invoke(generateBill, vendor._id, {
        customerId: unassignedCustomer._id.toString(),
        billingMonth: "2026-10",
      });
      assert.equal(vendorGeneratedBill.statusCode, 201);
      assert.equal(vendorGeneratedBill.body.bill.status, "paid");

      const generated = await invoke(generateBill, agentUser._id, { customerId: customer._id.toString(), billingMonth: "2026-10" });
      assert.equal(generated.statusCode, 201);
      const billId = generated.body.bill._id;
      assert.equal(generated.body.bill.currentPeriodAmount, 30);

      const vendorGenerateRetry = await invoke(generateBill, vendor._id, { customerId: customer._id.toString(), billingMonth: "2026-10" });
      const agentBillDetails = await invoke(getBillById, agentUser._id, {}, { id: billId.toString() });
      const unassignedBillAccess = await invoke(getBillById, agentUser._id, {}, { id: vendorGeneratedBill.body.bill._id.toString() });
      const unassignedCustomerBills = await invoke(getCustomerBills, agentUser._id, {}, { customerId: unassignedCustomer._id.toString() });
      const unassignedBillList = await invoke(getBills, agentUser._id, {}, {}, { customerId: unassignedCustomer._id.toString() });
      const unassignedBillGeneration = await invoke(generateBill, agentUser._id, { customerId: unassignedCustomer._id.toString(), billingMonth: "2026-10" });
      const crossVendorBillGeneration = await invoke(generateBill, agentUser._id, { customerId: otherCustomer._id.toString(), billingMonth: "2026-10" });
      const inactiveAgentBillGeneration = await invoke(generateBill, inactiveAgentUser._id, { customerId: customer._id.toString(), billingMonth: "2026-10" });
      const secondVendorBill = await invoke(generateBill, secondVendor._id, { customerId: otherCustomer._id.toString(), billingMonth: "2026-10" });
      const crossVendorBillAccess = await invoke(getBillById, agentUser._id, {}, { id: secondVendorBill.body.bill._id.toString() });
      const agentBillList = await invoke(getBills, agentUser._id, {}, {}, { month: "2026-10", customerId: customer._id.toString() });
      const agentCustomerBills = await invoke(getCustomerBills, agentUser._id, {}, { customerId: customer._id.toString() });
      assert.equal(vendorGenerateRetry.statusCode, 200);
      assert.equal(agentBillDetails.statusCode, 200);
      assert.equal(agentBillDetails.body.bill._id.toString(), billId.toString());
      assert.equal(unassignedBillAccess.statusCode, 403);
      assert.equal(unassignedCustomerBills.statusCode, 403);
      assert.equal(unassignedBillList.statusCode, 403);
      assert.equal(unassignedBillGeneration.statusCode, 403);
      assert.equal(crossVendorBillGeneration.statusCode, 404);
      assert.equal(inactiveAgentBillGeneration.statusCode, 403);
      assert.equal(secondVendorBill.statusCode, 201);
      assert.equal(crossVendorBillAccess.statusCode, 404);
      assert.equal(agentBillList.body.count, 1);
      assert.equal(agentCustomerBills.body.count, 1);

      const previousFetch = globalThis.fetch;
      const whatsappEnvironment = ["WHATSAPP_PROVIDER", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_API_VERSION"]
        .map((key) => [key, process.env[key]]);
      try {
        process.env.WHATSAPP_PROVIDER = "meta";
        process.env.WHATSAPP_ACCESS_TOKEN = "test-only-token";
        process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
        process.env.WHATSAPP_API_VERSION = "v23.0";
        globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.integration-test" }] }) });
        const vendorReceipt = await invoke(sendBillReceipt, vendor._id, {}, { billId: billId.toString() });
        const agentReceipt = await invoke(sendBillReceipt, agentUser._id, {}, { billId: billId.toString() });
        assert.equal(vendorReceipt.statusCode, 200);
        assert.equal(agentReceipt.statusCode, 200);
        assert.equal(agentReceipt.body.providerMessageId, "wamid.integration-test");
        const otherVendorReceipt = await invoke(sendBillReceipt, secondVendor._id, {}, { billId: billId.toString() });
        assert.equal(otherVendorReceipt.statusCode, 404);
      } finally {
        globalThis.fetch = previousFetch;
        for (const [key, value] of whatsappEnvironment) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }

      const paidDelivery = await invoke(createDelivery, agentUser._id, {
        customerId: customer._id.toString(), deliveryDate: "2026-10-06", quantityLiters: 1,
        shift: "Morning", product: "Milk", paymentChoice: "paid", paymentAmount: 5,
        paymentMethod: "cash", idempotencyKey: `delivery-${suffix}`,
      });
      assert.equal(paidDelivery.statusCode, 201);
      assert.equal(paidDelivery.body.payment.amount, 5);
      assert.equal((await Bill.findById(billId)).outstandingAmount, 35);
      const paidDeliveryRetry = await invoke(createDelivery, agentUser._id, {
        customerId: customer._id.toString(), deliveryDate: "2026-10-06", quantityLiters: 1,
        shift: "Morning", product: "Milk", paymentChoice: "paid", paymentAmount: 5,
        paymentMethod: "cash", idempotencyKey: `delivery-${suffix}`,
      });
      assert.equal(paidDeliveryRetry.statusCode, 409);
      assert.equal(paidDeliveryRetry.body.duplicate, true);
      assert.equal(await Payment.countDocuments({ customerId: customer._id }), 1);

      const originalPaymentCreate = Payment.create;
      try {
        Payment.create = async () => { throw new Error("Simulated payment insert failure"); };
        const failed = await invoke(createDelivery, agentUser._id, {
          customerId: customer._id.toString(), deliveryDate: "2026-10-07", quantityLiters: 1,
          shift: "Morning", product: "Milk", paymentChoice: "paid", paymentAmount: 5,
          paymentMethod: "cash", idempotencyKey: `rollback-${suffix}`,
        });
        assert.equal(failed.statusCode, 500);
      } finally {
        Payment.create = originalPaymentCreate;
      }
      assert.equal(await Delivery.countDocuments({ customerId: customer._id, deliveryDay: "2026-10-07" }), 0);
      assert.equal((await Bill.findById(billId)).outstandingAmount, 35);

      const paymentBody = {
        customerId: customer._id.toString(), billId: billId.toString(), amount: 7,
        paymentMethod: "upi", idempotencyKey: `retry-${suffix}`,
      };
      const firstPayment = await invoke(addPayment, vendor._id, paymentBody);
      const retryPayment = await invoke(addPayment, vendor._id, paymentBody);
      assert.equal(firstPayment.statusCode, 201);
      assert.equal(retryPayment.statusCode, 200);
      assert.equal(retryPayment.body.duplicate, true);

      const concurrentResults = await Promise.all([
        invoke(addPayment, vendor._id, { ...paymentBody, amount: 12, idempotencyKey: `race-a-${suffix}` }),
        invoke(addPayment, vendor._id, { ...paymentBody, amount: 12, idempotencyKey: `race-b-${suffix}` }),
      ]);
      assert.equal(concurrentResults.filter((result) => result.statusCode === 201).length, 1);
      assert.equal(concurrentResults.filter((result) => result.statusCode === 409).length, 1);

      const billRetry = await invoke(generateBill, vendor._id, { customerId: customer._id.toString(), billingMonth: "2026-10" });
      assert.equal(billRetry.statusCode, 200);
      assert.equal(await Bill.countDocuments({ customerId: customer._id, billingMonth: "2026-10" }), 1);

      const octoberBill = await Bill.findById(billId);
      const november = await invoke(generateBill, vendor._id, { customerId: customer._id.toString(), billingMonth: "2026-11" });
      assert.equal(november.statusCode, 201);
      assert.equal(november.body.bill.currentPeriodAmount, 0);
      assert.equal(november.body.bill.previousOutstandingAmount, octoberBill.outstandingAmount);
      assert.equal(november.body.bill.totalAmount, octoberBill.outstandingAmount);

      const deliveryId = morning.body.delivery._id.toString();
      const edited = await invoke(updateDelivery, vendor._id, { quantityLiters: 2 }, { id: deliveryId });
      assert.equal(edited.statusCode, 200);
      const paymentsBeforeDelete = await Payment.countDocuments({ customerId: customer._id });
      assert.equal((await Bill.findById(billId)).paidAmount, 24);
      const deleted = await invoke(deleteDelivery, vendor._id, {}, { id: evening.body.delivery._id.toString() });
      assert.equal(deleted.statusCode, 200);
      assert.equal(await Payment.countDocuments({ customerId: customer._id }), paymentsBeforeDelete);

      const crossVendor = await invoke(createDelivery, agentUser._id, {
        customerId: otherCustomer._id.toString(), deliveryDate: "2026-10-08", quantityLiters: 1,
        shift: "Morning", product: "Milk", paymentChoice: "unpaid",
      });
      assert.equal(crossVendor.statusCode, 404);
      const vendorCrossScope = await invoke(generateBill, vendor._id, {
        customerId: otherCustomer._id.toString(), billingMonth: "2026-10",
      });
      assert.equal(vendorCrossScope.statusCode, 404);
    } finally {
      const customerIds = [owned.customerId, owned.otherCustomerId, ...owned.createdCustomerIds].filter(Boolean);
      const userIds = [owned.vendorId, owned.secondVendorId, owned.agentUserId, owned.secondAgentUserId, owned.inactiveAgentUserId].filter(Boolean);
      await Payment.deleteMany({ customerId: { $in: customerIds } });
      await Delivery.deleteMany({ customerId: { $in: customerIds } });
      await Bill.deleteMany({ customerId: { $in: customerIds } });
      await Customer.deleteMany({ _id: { $in: customerIds } });
      await DeliveryAgent.deleteMany({ _id: { $in: [owned.agentId, owned.secondAgentId, owned.inactiveAgentId].filter(Boolean) } });
      await User.deleteMany({ _id: { $in: userIds } });
      await mongoose.disconnect();
    }
  });
}