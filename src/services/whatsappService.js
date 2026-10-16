const normalizeIndianPhone = (value) => {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  const nationalNumber = digits.length === 12 && digits.startsWith("91")
    ? digits.slice(2)
    : digits.length === 10
      ? digits
      : null;
  return nationalNumber && /^[6-9]\d{9}$/.test(nationalNumber)
    ? `91${nationalNumber}`
    : null;
};

const getWhatsAppConfig = (env = process.env) => {
  if (env.WHATSAPP_PROVIDER !== "meta") return null;
  const { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_API_VERSION } = env;
  if (
    !WHATSAPP_ACCESS_TOKEN ||
    !/^\d+$/.test(WHATSAPP_PHONE_NUMBER_ID || "") ||
    !/^v?\d+\.\d+$/.test(WHATSAPP_API_VERSION || "")
  ) return null;
  return {
    accessToken: WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: WHATSAPP_API_VERSION.replace(/^v/, ""),
  };
};

const sendWhatsAppText = async ({ phone, message, env = process.env, fetchImpl = globalThis.fetch }) => {
  const normalizedPhone = normalizeIndianPhone(phone);
  if (!normalizedPhone) {
    throw Object.assign(new Error("Customer phone number must be a valid Indian mobile number"), { statusCode: 400 });
  }
  if (typeof message !== "string" || !message.trim() || message.trim().length > 4096) {
    throw Object.assign(new Error("Receipt message must contain 1 to 4096 characters"), { statusCode: 400 });
  }

  const config = getWhatsAppConfig(env);
  if (!config) {
    throw Object.assign(new Error("WhatsApp Business provider is not configured"), { statusCode: 503, code: "WHATSAPP_NOT_CONFIGURED" });
  }
  if (typeof fetchImpl !== "function") {
    throw Object.assign(new Error("WhatsApp provider transport is unavailable"), { statusCode: 503 });
  }

  const response = await fetchImpl(`https://graph.facebook.com/v${config.apiVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedPhone,
      type: "text",
      text: { preview_url: false, body: message.trim() },
    }),
  });

  let result;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  const messageId = result?.messages?.[0]?.id;
  if (!response.ok || typeof messageId !== "string" || !messageId) {
    throw Object.assign(new Error("WhatsApp provider did not confirm message delivery request"), {
      statusCode: 502,
      providerStatus: response.status,
    });
  }
  return { messageId, phone: normalizedPhone };
};

module.exports = { normalizeIndianPhone, getWhatsAppConfig, sendWhatsAppText };