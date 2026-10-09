
const mongoose = require("mongoose");

const Payment = require("../models/Payment");
const Bill = require("../models/Bill");
const Customer = require("../models/Customer");
const DeliveryAgent = require("../models/DeliveryAgent");
const User = require("../models/User");

// =====================================================
// HELPERS
// =====================================================

const getActor = async (req) => {
  const userId = req.user?.userId;

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return null;
  }

  const user = await User.findById(userId);

  if (!user || !user.isActive) {
    return null;
  }

  if (user.userType === "agent") {
    const agent = await DeliveryAgent.findOne({
      userId: user._id,
      status: "active",
    });

    if (!agent) return null;

    return {
      type: "delivery_agent",
      userId: user._id,
      agentId: agent._id,
      vendorId: agent.vendorId,
      name: agent.name,
    };
  }

  // Adapt this check if your User model uses another vendor role.
  if (user.userType === "vendor") {
    return {
      type: "vendor",
      userId: user._id,
      vendorId: user._id,
      agentId: null,
      name: user.name || "",
    };
  }

  return null;
};

const roundMoney = (value) =>
  Number(Number(value).toFixed(2));

const getBillStatus = (paid, total) => {
  if (paid >= total) return "paid";
  if (paid > 0) return "partially_paid";
  return "unpaid";
};

// =====================================================
// ADD PAYMENT
// =====================================================

const addPayment = async (req, res) => {
  try {
    const actor = await getActor(req);

    if (!actor) {
      return res.status(403).json({
        success: false,
        message: "Authorized vendor or active delivery agent required",
      });
    }

    const {
      customerId,
      billId,
      amount,
      paymentDate,
      paymentMethod,
      referenceNumber,
      notes,
      idempotencyKey,
    } = req.body;

    if (!customerId || !billId || amount === undefined) {
      return res.status(400).json({
        success: false,
        message: "customerId, billId and amount are required",
      });
    }

    if (
      !mongoose.Types.ObjectId.isValid(customerId) ||
      !mongoose.Types.ObjectId.isValid(billId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid customerId or billId",
      });
    }

    const paymentAmount = Number(amount);

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Payment amount must be greater than zero",
      });
    }

    if (paymentMethod !== "cash") {
      return res.status(400).json({
        success: false,
        message: "Currently only cash payments are enabled",
      });
    }

    if (
      paymentDate &&
      Number.isNaN(new Date(paymentDate).getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid paymentDate",
      });
    }

    if (
      typeof idempotencyKey !== "string" ||
      !idempotencyKey.trim() ||
      idempotencyKey.length > 128
    ) {
      return res.status(400).json({
        success: false,
        message: "A unique idempotencyKey is required",
      });
    }

    // Customer must belong to the actor's vendor.
    const customer = await Customer.findOne({
      _id: customerId,
      vendorId: actor.vendorId,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found for this vendor",
      });
    }

    // An agent can collect payments only for assigned customers.
    if (actor.type === "delivery_agent") {
      if (
        !customer.deliveryAgentId ||
        customer.deliveryAgentId.toString() !==
          actor.agentId.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: "This customer is not assigned to you",
        });
      }
    }

    // Check bill ownership.
    const bill = await Bill.findOne({
      _id: billId,
      vendorId: actor.vendorId,
      customerId,
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: "Bill not found for this customer",
      });
    }

    // Idempotency: return the existing payment for a retry.
    const existingPayment = await Payment.findOne({
      vendorId: actor.vendorId,
      idempotencyKey: idempotencyKey.trim(),
    });

    if (existingPayment) {
      if (
        existingPayment.billId.toString() !== billId ||
        existingPayment.customerId.toString() !== customerId ||
        roundMoney(existingPayment.amount) !== roundMoney(paymentAmount)
      ) {
        return res.status(409).json({
          success: false,
          message: "Idempotency key was already used for another payment",
        });
      }

      return res.status(200).json({
        success: true,
        duplicate: true,
        message: "Payment was already recorded",
        payment: existingPayment,
      });
    }

    const amountToPay = roundMoney(paymentAmount);
    const currentOutstanding = roundMoney(bill.outstandingAmount);

    if (amountToPay > currentOutstanding) {
      return res.status(400).json({
        success: false,
        message: "Payment exceeds the bill's outstanding amount",
        outstandingAmount: currentOutstanding,
      });
    }

    const receiptNumber =
      `MB-${Date.now()}-${new mongoose.Types.ObjectId()
        .toString()
        .slice(-6)
        .toUpperCase()}`;

    // Conditional update prevents two concurrent requests from
    // successfully collecting more than the outstanding amount.
    const updatedBill = await Bill.findOneAndUpdate(
      {
        _id: bill._id,
        vendorId: actor.vendorId,
        customerId,
        outstandingAmount: { $gte: amountToPay },
      },
      [
        {
          $set: {
            paidAmount: {
              $round: [
                { $add: ["$paidAmount", amountToPay] },
                2,
              ],
            },
            outstandingAmount: {
              $round: [
                {
                  $max: [
                    { $subtract: ["$outstandingAmount", amountToPay] },
                    0,
                  ],
                },
                2,
              ],
            },
          },
        },
        {
          $set: {
            status: {
              $cond: [
                { $eq: ["$outstandingAmount", 0] },
                "paid",
                {
                  $cond: [
                    { $gt: ["$paidAmount", 0] },
                    "partially_paid",
                    "unpaid",
                  ],
                },
              ],
            },
          },
        },
      ],
      { new: true }
    );

    if (!updatedBill) {
      return res.status(409).json({
        success: false,
        message: "Bill balance changed. Refresh and try again.",
      });
    }

    let payment;

    try {
      payment = await Payment.create({
        vendorId: actor.vendorId,
        customerId,
        billId,
        amount: amountToPay,
        paymentDate: paymentDate || new Date(),
        paymentMethod: "cash",
        referenceNumber: referenceNumber || "",
        notes: notes || "",
        collectorType: actor.type,
        deliveryAgentId: actor.agentId,
        collectorName: actor.name,
        collectedByUserId: actor.userId,
        receiptNumber,
        idempotencyKey: idempotencyKey.trim(),
        whatsappStatus: "not_configured",
      });
    } catch (error) {
      // Restore the bill balance if payment insertion fails.
      await Bill.updateOne(
        {
          _id: updatedBill._id,
          vendorId: actor.vendorId,
        },
        {
          $inc: {
            paidAmount: -amountToPay,
            outstandingAmount: amountToPay,
          },
          $set: {
            status: getBillStatus(
              roundMoney(updatedBill.paidAmount - amountToPay),
              updatedBill.totalAmount
            ),
          },
        }
      );

      if (error.code === 11000) {
        const duplicate = await Payment.findOne({
          vendorId: actor.vendorId,
          idempotencyKey: idempotencyKey.trim(),
        });

        if (duplicate) {
          return res.status(200).json({
            success: true,
            duplicate: true,
            message: "Payment was already recorded",
            payment: duplicate,
          });
        }
      }

      throw error;
    }

    return res.status(201).json({
      success: true,
      message: "Payment recorded successfully",
      payment,
      receipt: {
        receiptNumber: payment.receiptNumber,
        customerName: customer.name,
        customerPhone: customer.phone,
        billAmount: bill.totalAmount,
        paymentAmount: payment.amount,
        paymentMethod: payment.paymentMethod,
        paymentDate: payment.paymentDate,
        collectorType: payment.collectorType,
        collectorName: payment.collectorName,
        remainingAmount: updatedBill.outstandingAmount,
        billStatus: updatedBill.status,
      },
      bill: {
        id: updatedBill._id,
        totalAmount: updatedBill.totalAmount,
        paidAmount: updatedBill.paidAmount,
        outstandingAmount: updatedBill.outstandingAmount,
        status: updatedBill.status,
      },
    });
  } catch (error) {
    console.error("Add payment error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to record payment",
    });
  }
};

// =====================================================
// GET PAYMENTS FOR BILL
// =====================================================

const getBillPayments = async (req, res) => {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return res.status(403).json({
        success: false,
        message: "Authorized user required",
      });
    }

    const { billId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(billId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid billId",
      });
    }

    const bill = await Bill.findOne({
      _id: billId,
      vendorId: actor.vendorId,
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: "Bill not found",
      });
    }

    if (actor.type === "delivery_agent") {
      const customer = await Customer.findOne({
        _id: bill.customerId,
        vendorId: actor.vendorId,
        deliveryAgentId: actor.agentId,
      });

      if (!customer) {
        return res.status(403).json({
          success: false,
          message: "This customer is not assigned to you",
        });
      }
    }

    const payments = await Payment.find({
      vendorId: actor.vendorId,
      billId,
    }).sort({ paymentDate: -1, createdAt: -1 });

    return res.json({
      success: true,
      count: payments.length,
      payments,
    });
  } catch (error) {
    console.error("Get bill payments error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch bill payments",
    });
  }
};

// =====================================================
// GET CUSTOMER PAYMENT HISTORY
// =====================================================

const getCustomerPayments = async (req, res) => {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return res.status(403).json({
        success: false,
        message: "Authorized user required",
      });
    }

    const { customerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customerId",
      });
    }

    const customer = await Customer.findOne({
      _id: customerId,
      vendorId: actor.vendorId,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (
      actor.type === "delivery_agent" &&
      customer.deliveryAgentId?.toString() !== actor.agentId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "This customer is not assigned to you",
      });
    }

    const payments = await Payment.find({
      vendorId: actor.vendorId,
      customerId,
    })
      .populate(
        "billId",
        "billingMonth fromDate toDate totalAmount paidAmount outstandingAmount status"
      )
      .populate("deliveryAgentId", "name mobileNumber")
      .sort({ paymentDate: -1, createdAt: -1 });

    return res.json({
      success: true,
      count: payments.length,
      payments,
    });
  } catch (error) {
    console.error("Get customer payments error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer payment history",
    });
  }
};

// =====================================================
// GET BILL PAYMENT SUMMARY
// =====================================================

const getBillPaymentSummary = async (req, res) => {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return res.status(403).json({
        success: false,
        message: "Authorized user required",
      });
    }

    const { billId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(billId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid billId",
      });
    }

    const bill = await Bill.findOne({
      _id: billId,
      vendorId: actor.vendorId,
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: "Bill not found",
      });
    }

    if (actor.type === "delivery_agent") {
      const customer = await Customer.findOne({
        _id: bill.customerId,
        vendorId: actor.vendorId,
        deliveryAgentId: actor.agentId,
      });

      if (!customer) {
        return res.status(403).json({
          success: false,
          message: "This customer is not assigned to you",
        });
      }
    }

    const result = await Payment.aggregate([
      {
        $match: {
          vendorId: bill.vendorId,
          customerId: bill.customerId,
          billId: bill._id,
        },
      },
      {
        $group: {
          _id: null,
          totalPaid: { $sum: "$amount" },
        },
      },
    ]);

    const totalPaid =
      result.length > 0
        ? roundMoney(result[0].totalPaid)
        : 0;

    return res.json({
      success: true,
      data: {
        billId: bill._id,
        totalAmount: bill.totalAmount,
        totalPaid,
        paidAmount: bill.paidAmount,
        outstandingAmount: bill.outstandingAmount,
        status: bill.status,
      },
    });
  } catch (error) {
    console.error("Get bill payment summary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment summary",
    });
  }
};

module.exports = {
  addPayment,
  getBillPayments,
  getCustomerPayments,
  getBillPaymentSummary,
};
