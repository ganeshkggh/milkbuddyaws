const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getWhatsAppConfig,
  normalizeIndianPhone,
  sendWhatsAppText,
} = require("../src/services/whatsappService");
const billRoutes = require("../src/routes/billRoutes");

test("receipt route is registered as an authenticated POST endpoint", () => {
  const receiptRoute = billRoutes.stack
    .map((layer) => layer.route)
    .find((route) => route?.path === "/:billId/send-receipt");

  assert.ok(receiptRoute);
  assert.equal(receiptRoute.methods.post, true);
  assert.equal(receiptRoute.stack.length, 2);
});

test("WhatsApp phone validation accepts Indian national and country-code formats", () => {
  assert.equal(normalizeIndianPhone("98765 43210"), "919876543210");
  assert.equal(normalizeIndianPhone("+91 98765-43210"), "919876543210");
  assert.equal(normalizeIndianPhone("1234567890"), null);
  assert.equal(normalizeIndianPhone("987654321"), null);
});

test("WhatsApp receipt fails clearly when provider is not configured", async () => {
  assert.equal(getWhatsAppConfig({}), null);
  await assert.rejects(
    sendWhatsAppText({ phone: "9876543210", message: "Receipt", env: {}, fetchImpl: () => { throw new Error("must not send"); } }),
    (error) => error.statusCode === 503 && error.code === "WHATSAPP_NOT_CONFIGURED"
  );
});

test("WhatsApp receipt only succeeds with a provider-confirmed message id", async () => {
  const env = {
    WHATSAPP_PROVIDER: "meta",
    WHATSAPP_ACCESS_TOKEN: "test-only-token",
    WHATSAPP_PHONE_NUMBER_ID: "123456789",
    WHATSAPP_API_VERSION: "v23.0",
  };
  let capturedRequest;
  const response = await sendWhatsAppText({
    phone: "9876543210",
    message: "Bill receipt",
    env,
    fetchImpl: async (url, options) => {
      capturedRequest = { url, options };
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.test-confirmed" }] }) };
    },
  });
  assert.equal(response.messageId, "wamid.test-confirmed");
  assert.equal(response.phone, "919876543210");
  assert.equal(capturedRequest.options.method, "POST");
  assert.equal(JSON.parse(capturedRequest.options.body).text.body, "Bill receipt");

  await assert.rejects(sendWhatsAppText({
    phone: "9876543210",
    message: "Bill receipt",
    env,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ messages: [] }) }),
  }), (error) => error.statusCode === 502);
});