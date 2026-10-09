
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    // Vendor who owns this payment
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Customer who made the payment
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    // Bill against which payment was received
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bill",
      required: true,
      index: true,
    },

    // Who collected the payment
    collectorType: {
      type: String,
      enum: ["vendor", "delivery_agent"],
      required: true,
      default: "vendor",
    },

    // DeliveryAgent document ID, if collected by an agent
    deliveryAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryAgent",
      default: null,
      index: true,
    },

    // Collector name saved for historical receipts
    collectorName: {
      type: String,
      default: "",
      trim: true,
    },

    // User account that submitted the payment
    collectedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Unique receipt number
    receiptNumber: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },

    // Prevent duplicate submissions when the same key is reused
    idempotencyKey: {
      type: String,
      trim: true,
      default: undefined,
    },

    // Amount received
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },

    // Date and time payment was received
    paymentDate: {
      type: Date,
      required: true,
      default: Date.now,
    },

    // Cash works now; UPI can be integrated later
    paymentMethod: {
      type: String,
      enum: ["cash", "upi", "bank_transfer", "other"],
      required: true,
    },

    // Optional transaction reference
    referenceNumber: {
      type: String,
      default: "",
      trim: true,
    },

    // Optional payment notes
    notes: {
      type: String,
      default: "",
      trim: true,
    },

    // WhatsApp receipt delivery status
    whatsappStatus: {
      type: String,
      enum: [
        "pending",
        "sent",
        "failed",
        "not_configured",
      ],
      default: "not_configured",
    },

    // Message ID returned by the WhatsApp provider
    whatsappMessageId: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Date-wise payment history for a customer
paymentSchema.index({
  vendorId: 1,
  customerId: 1,
  paymentDate: -1,
});

// Prevent reuse of an idempotency key for the same vendor
paymentSchema.index(
  {
    vendorId: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $type: "string" },
    },
  }
);

module.exports = mongoose.model("Payment", paymentSchema);
