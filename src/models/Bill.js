const mongoose = require("mongoose");

const billSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    billingMonth: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}$/,
    },

    fromDate: {
      type: Date,
      required: true,
    },

    toDate: {
      type: Date,
      required: true,
    },

    totalMilkLiters: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    currentPeriodAmount: {
      type: Number,
      min: 0,
      default: 0,
    },

    previousOutstandingAmount: {
      type: Number,
      min: 0,
      default: 0,
    },

    paidAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    outstandingAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    creditAmount: {
      type: Number,
      min: 0,
      default: 0,
    },

    status: {
      type: String,
      enum: [
        "unpaid",
        "partially_paid",
        "paid",
      ],
      default: "unpaid",
    },

    generatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);


module.exports = mongoose.model(
  "Bill",
  billSchema
);

billSchema.index(
  { vendorId: 1, customerId: 1, billingMonth: 1 },
  { unique: true }
);