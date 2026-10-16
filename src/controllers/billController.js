const mongoose = require("mongoose");
const Bill = require("../models/Bill");
const Customer = require("../models/Customer");
const Delivery = require("../models/Delivery");
const DeliveryAgent = require("../models/DeliveryAgent");
const User = require("../models/User");
const Payment = require("../models/Payment");
const { sendWhatsAppText } = require("../services/whatsappService");

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

const normalizeBillingMonth = (billingMonth) => {
  if (!billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
    throw new Error("Invalid billingMonth. Use YYYY-MM");
  }

  const [year, month] = billingMonth.split("-").map(Number);

  if (month < 1 || month > 12) {
    throw new Error("Invalid billing month");
  }

  return `${year}-${String(month).padStart(2, "0")}`;
};

const getBillingMonthRange = (billingMonth) => {
  const normalizedMonth = normalizeBillingMonth(billingMonth);
  const [year, month] = normalizedMonth.split("-").map(Number);

  const fromDate = new Date(`${normalizedMonth}-01T00:00:00+05:30`);

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const toDate = new Date(
    `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+05:30`
  );

  return {
    billingMonth: normalizedMonth,
    fromDate,
    toDate,
  };
};

const getBillStatus = (paidAmount, totalAmount) => {
  const safePaidAmount = roundMoney(paidAmount || 0);
  const safeTotalAmount = roundMoney(totalAmount || 0);
  const outstandingAmount = Math.max(safeTotalAmount - safePaidAmount, 0);

  if (outstandingAmount <= 0) {
    return "paid";
  }

  if (safePaidAmount > 0) {
    return "partially_paid";
  }

  return "unpaid";
};

const calculateBillSummary = (deliveries = [], paidAmount = 0, previousOutstandingAmount = 0) => {
  let totalMilkLiters = 0;
  let totalAmount = 0;

  for (const delivery of deliveries) {
    if (delivery?.isNoDelivery === true) {
      continue;
    }

    totalMilkLiters += Number(delivery?.quantityLiters || 0);
    totalAmount += Number(delivery?.amount || 0);
  }

  const safePaidAmount = roundMoney(paidAmount || 0);
  const safePreviousOutstanding = roundMoney(previousOutstandingAmount || 0);
  const roundedMilkLiters = roundMoney(totalMilkLiters);
  const currentPeriodAmount = roundMoney(totalAmount);
  const roundedAmount = roundMoney(safePreviousOutstanding + currentPeriodAmount);

  // Preserve the payment history on any bill revision. If a revised bill total
  // falls below the amount already paid, keep the earlier payments intact and
  // clamp the outstanding balance to zero instead of deleting records.
  const outstandingAmount = Math.max(roundedAmount - safePaidAmount, 0);

  return {
    totalMilkLiters: roundedMilkLiters,
    totalAmount: roundedAmount,
    currentPeriodAmount,
    previousOutstandingAmount: safePreviousOutstanding,
    paidAmount: safePaidAmount,
    outstandingAmount: roundMoney(outstandingAmount),
    creditAmount: roundMoney(Math.max(safePaidAmount - roundedAmount, 0)),
    status: getBillStatus(safePaidAmount, roundedAmount),
  };
};

const getBillingMonthKeyFromDate = (dateValue) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  });

  const parts = formatter.formatToParts(new Date(dateValue));
  const yearPart = parts.find((part) => part.type === "year")?.value;
  const monthPart = parts.find((part) => part.type === "month")?.value;

  if (!yearPart || !monthPart) {
    const normalizedDate = new Date(dateValue);
    return `${normalizedDate.getFullYear()}-${String(normalizedDate.getMonth() + 1).padStart(2, "0")}`;
  }

  return `${yearPart}-${monthPart}`;
};

const syncExistingBillForMonth = async ({
  vendorId,
  customerId,
  billingMonth,
  session,
}) => {
  const normalizedMonth = normalizeBillingMonth(billingMonth);
  let billQuery = Bill.findOne({
    vendorId,
    customerId,
    billingMonth: normalizedMonth,
  });
  if (session) billQuery = billQuery.session(session);
  const existingBill = await billQuery;

  if (!existingBill) {
    return null;
  }

  let previousBillQuery = Bill.findOne({
    vendorId,
    customerId,
    billingMonth: { $lt: normalizedMonth },
  }).sort({ billingMonth: -1 });
  if (session) previousBillQuery = previousBillQuery.session(session);
  const previousBill = await previousBillQuery;

  const { fromDate, toDate } = getBillingMonthRange(normalizedMonth);
  let deliveriesQuery = Delivery.find({
    vendorId,
    customerId,
    deliveryDate: {
      $gte: fromDate,
      $lt: toDate,
    },
  }).sort({
    deliveryDate: 1,
  });
  if (session) deliveriesQuery = deliveriesQuery.session(session);
  const deliveries = await deliveriesQuery;

  let paymentQuery = Payment.aggregate([
    { $match: { vendorId: existingBill.vendorId, customerId: existingBill.customerId, billId: existingBill._id } },
    { $group: { _id: null, totalPaid: { $sum: "$amount" } } },
  ]);
  if (session) paymentQuery = paymentQuery.session(session);
  const paymentTotals = await paymentQuery;
  const recordedPayments = paymentTotals[0]?.totalPaid || 0;
  const paidAmount = Math.max(roundMoney(existingBill.paidAmount), roundMoney(recordedPayments));

  const summary = calculateBillSummary(
    deliveries,
    paidAmount,
    previousBill?.outstandingAmount || 0
  );

  existingBill.totalMilkLiters = summary.totalMilkLiters;
  existingBill.currentPeriodAmount = summary.currentPeriodAmount;
  existingBill.previousOutstandingAmount = summary.previousOutstandingAmount;
  existingBill.totalAmount = summary.totalAmount;
  existingBill.paidAmount = summary.paidAmount;
  existingBill.outstandingAmount = summary.outstandingAmount;
  existingBill.creditAmount = summary.creditAmount;
  existingBill.status = summary.status;

  await existingBill.save(session ? { session } : undefined);

  return existingBill;
};

// =====================================================
// HELPER: GET ACTOR FROM REQUEST
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

// =====================================================
// GENERATE BILL
// =====================================================

const generateBill = async (req, res) => {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return res.status(403).json({ success: false, message: "Authorized vendor or active delivery agent required" });
    }
    const vendorId = actor.vendorId;

    const { customerId, billingMonth } = req.body;

    // Validate required fields
    if (!customerId || !billingMonth) {
      return res.status(400).json({
        success: false,
        message: "customerId and billingMonth are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ success: false, message: "Invalid customerId" });
    }

    // Validate month format
    const monthRegex = /^\d{4}-\d{2}$/;

    if (!monthRegex.test(billingMonth)) {
      return res.status(400).json({
        success: false,
        message: "Invalid billingMonth. Use YYYY-MM",
      });
    }

    let normalizedBillingMonth;

    try {
      normalizedBillingMonth = normalizeBillingMonth(billingMonth);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    // Check customer
    const customer = await Customer.findOne({
      _id: customerId,
      vendorId,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (customer.status !== "active") {
      return res.status(400).json({ success: false, message: "Cannot generate a bill for an inactive customer" });
    }

    if (actor.type === "delivery_agent" && customer.deliveryAgentId?.toString() !== actor.agentId.toString()) {
      return res.status(403).json({ success: false, message: "Access denied. Customer is not assigned to you." });
    }

    const { fromDate, toDate } = getBillingMonthRange(normalizedBillingMonth);

    // Find customer's deliveries
    const deliveries = await Delivery.find({
      vendorId,
      customerId,
      deliveryDate: {
        $gte: fromDate,
        $lt: toDate,
      },
    }).sort({
      deliveryDate: 1,
    });

    let bill = await Bill.findOne({
      vendorId,
      customerId,
      billingMonth: normalizedBillingMonth,
    });

    const earlierBills = await Bill.find({
      vendorId,
      customerId,
      billingMonth: { $lt: normalizedBillingMonth },
    }).sort({ billingMonth: 1 });
    for (const earlierBill of earlierBills) {
      await syncExistingBillForMonth({ vendorId, customerId, billingMonth: earlierBill.billingMonth });
    }
    const previousBill = await Bill.findOne({
      vendorId,
      customerId,
      billingMonth: { $lt: normalizedBillingMonth },
    }).sort({ billingMonth: -1 });
    const recordedPaymentTotals = bill
      ? await Payment.aggregate([
          { $match: { vendorId, customerId: customer._id, billId: bill._id } },
          { $group: { _id: null, totalPaid: { $sum: "$amount" } } },
        ])
      : [];
    const paidAmount = bill
      ? Math.max(roundMoney(bill.paidAmount), roundMoney(recordedPaymentTotals[0]?.totalPaid || 0))
      : 0;
    const summary = calculateBillSummary(deliveries, paidAmount, previousBill?.outstandingAmount || 0);

    const billValues = {
      vendorId,
      customerId,
      billingMonth: normalizedBillingMonth,
      fromDate,
      toDate,
      totalMilkLiters: summary.totalMilkLiters,
      currentPeriodAmount: summary.currentPeriodAmount,
      previousOutstandingAmount: summary.previousOutstandingAmount,
      totalAmount: summary.totalAmount,
      paidAmount: summary.paidAmount,
      outstandingAmount: summary.outstandingAmount,
      creditAmount: summary.creditAmount,
      status: summary.status,
    };

    let created = false;
    if (bill) {
      Object.assign(bill, billValues);
      await bill.save();
    } else {
      try {
        bill = await Bill.create(billValues);
        created = true;
      } catch (error) {
        if (error.code !== 11000) throw error;
        bill = await Bill.findOne({ vendorId, customerId, billingMonth: normalizedBillingMonth });
        if (!bill) throw error;
        Object.assign(bill, billValues);
        await bill.save();
      }
    }

    const laterBills = await Bill.find({
      vendorId,
      customerId,
      billingMonth: { $gt: normalizedBillingMonth },
    }).sort({ billingMonth: 1 });
    for (const laterBill of laterBills) {
      await syncExistingBillForMonth({ vendorId, customerId, billingMonth: laterBill.billingMonth });
    }

    return res.status(created ? 201 : 200).json({
      success: true,
      message: "Bill generated or recalculated successfully",
      bill,
    });
  } catch (error) {
    console.error("Generate bill error:", error);

    if (error.message?.startsWith("Invalid billingMonth") || error.message === "Invalid billing month") {
      return res.status(400).json({ success: false, message: error.message });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to generate bill",
    });
  }
};

// =====================================================
// GET BILLS (Vendor & Delivery Agent with Scope Control)
// =====================================================

const getBills = async (req, res) => {
  try {
    const actor = await getActor(req);

    if (!actor) {
      return res.status(403).json({
        success: false,
        message: "Authorized user required",
      });
    }

    const { month, customerId, status } = req.query;

    const filter = {
      vendorId: actor.vendorId,
    };

    if (actor.type === "delivery_agent") {
      const assignedCustomers = await Customer.find({
        vendorId: actor.vendorId,
        deliveryAgentId: actor.agentId,
        status: "active",
      }).select("_id").lean();

      const assignedCustomerIds = assignedCustomers.map((c) => c._id);

      if (customerId) {
        if (!mongoose.Types.ObjectId.isValid(customerId)) {
          return res.status(400).json({ success: false, message: "Invalid customerId" });
        }
        const requestedCustomer = await Customer.findOne({ _id: customerId, vendorId: actor.vendorId });
        if (!requestedCustomer) return res.status(404).json({ success: false, message: "Customer not found" });
        if (!assignedCustomerIds.some((id) => id.toString() === customerId.toString())) {
          return res.status(403).json({
            success: false,
            message: "Access denied. Customer is not assigned to you.",
          });
        }
        filter.customerId = customerId;
      } else {
        filter.customerId = { $in: assignedCustomerIds };
      }
    } else if (customerId) {
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res.status(400).json({ success: false, message: "Invalid customerId" });
      }
      const customer = await Customer.findOne({ _id: customerId, vendorId: actor.vendorId });
      if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });
      filter.customerId = customer._id;
    }

    // Filter by billing month
    if (month) {
      const monthRegex = /^\d{4}-\d{2}$/;

      if (!monthRegex.test(month)) {
        return res.status(400).json({
          success: false,
          message: "Invalid month format. Use YYYY-MM",
        });
      }

      filter.billingMonth = month;
    }

    // Filter by payment status
    if (status) {
      const allowedStatuses = ["unpaid", "partially_paid", "paid"];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status. Use unpaid, partially_paid or paid",
        });
      }

      filter.status = status;
    }

    const bills = await Bill.find(filter)
      .populate("customerId", "customerNumber name phone")
      .sort({
        billingMonth: -1,
        createdAt: -1,
      });

    return res.json({
      success: true,
      count: bills.length,
      bills,
    });
  } catch (error) {
    console.error("Get bills error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch bills",
    });
  }
};

// =====================================================
// GET BILL BY ID
// =====================================================

const getBillById = async (req, res) => {
  try {
    const actor = await getActor(req);

    if (!actor) {
      return res.status(403).json({
        success: false,
        message: "Authorized user required",
      });
    }

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id || "")) {
      return res.status(400).json({ success: false, message: "Invalid billId" });
    }

    const bill = await Bill.findOne({
      _id: id,
      vendorId: actor.vendorId,
    }).populate("customerId", "customerNumber name phone ratePerLiter");

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
          message: "Access denied. Customer is not assigned to you.",
        });
      }
    }

    return res.json({
      success: true,
      bill,
    });
  } catch (error) {
    console.error("Get bill by ID error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch bill",
    });
  }
};

// =====================================================
// GET CUSTOMER BILLS
// =====================================================

const getCustomerBills = async (req, res) => {
  try {
    const actor = await getActor(req);

    if (!actor) {
      return res.status(403).json({
        success: false,
        message: "Authorized user required",
      });
    }

    const { customerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(customerId || "")) {
      return res.status(400).json({ success: false, message: "Invalid customerId" });
    }

    const ownedCustomer = await Customer.findOne({ _id: customerId, vendorId: actor.vendorId });
    if (!ownedCustomer) return res.status(404).json({ success: false, message: "Customer not found" });

    if (actor.type === "delivery_agent") {
      if (ownedCustomer.deliveryAgentId?.toString() !== actor.agentId.toString()) {
        return res.status(403).json({
          success: false,
          message: "Access denied. Customer is not assigned to you.",
        });
      }
    }

    const { fromMonth, toMonth } = req.query;

    const filter = {
      vendorId: actor.vendorId,
      customerId,
    };

    // Optional month range
    if (fromMonth || toMonth) {
      filter.billingMonth = {};

      if (fromMonth) {
        const fromRegex = /^\d{4}-\d{2}$/;

        if (!fromRegex.test(fromMonth)) {
          return res.status(400).json({
            success: false,
            message: "Invalid fromMonth. Use YYYY-MM",
          });
        }

        filter.billingMonth.$gte = fromMonth;
      }

      if (toMonth) {
        const toRegex = /^\d{4}-\d{2}$/;

        if (!toRegex.test(toMonth)) {
          return res.status(400).json({
            success: false,
            message: "Invalid toMonth. Use YYYY-MM",
          });
        }

        filter.billingMonth.$lte = toMonth;
      }
    }

    const bills = await Bill.find(filter)
      .populate("customerId", "customerNumber name phone")
      .sort({
        billingMonth: -1,
      });

    return res.json({
      success: true,
      count: bills.length,
      bills,
    });
  } catch (error) {
    console.error("Get customer bills error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer bills",
    });
  }
};

const sendBillReceipt = async (req, res) => {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return res.status(403).json({ success: false, message: "Authorized vendor or active delivery agent required" });
    }

    const { billId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(billId || "")) {
      return res.status(400).json({ success: false, message: "Invalid billId" });
    }
    const bill = await Bill.findOne({ _id: billId, vendorId: actor.vendorId });
    if (!bill) return res.status(404).json({ success: false, message: "Bill not found" });

    const customer = await Customer.findOne({ _id: bill.customerId, vendorId: actor.vendorId });
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found for this bill" });
    if (actor.type === "delivery_agent" && customer.deliveryAgentId?.toString() !== actor.agentId.toString()) {
      return res.status(403).json({ success: false, message: "Access denied. Customer is not assigned to you." });
    }

    const suppliedMessage = req.body?.message;
    if (suppliedMessage !== undefined && (typeof suppliedMessage !== "string" || !suppliedMessage.trim() || suppliedMessage.trim().length > 4096)) {
      return res.status(400).json({ success: false, message: "Receipt message must contain 1 to 4096 characters" });
    }
    const receiptMessage = suppliedMessage === undefined
      ? [
          "MilkBook bill receipt",
          `Customer: ${customer.name}`,
          `Billing month: ${bill.billingMonth}`,
          `Total payable: INR ${roundMoney(bill.totalAmount).toFixed(2)}`,
          `Amount paid: INR ${roundMoney(bill.paidAmount).toFixed(2)}`,
          `Outstanding: INR ${roundMoney(bill.outstandingAmount).toFixed(2)}`,
          `Status: ${bill.status}`,
        ].join("\n")
      : suppliedMessage.trim();

    const result = await sendWhatsAppText({ phone: customer.phone, message: receiptMessage });
    return res.status(200).json({
      success: true,
      message: "Receipt submitted to WhatsApp",
      billId: bill._id,
      customerId: customer._id,
      recipient: result.phone,
      providerMessageId: result.messageId,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    console.error("Send bill receipt error");
    return res.status(502).json({ success: false, message: "WhatsApp provider request failed" });
  }
};

module.exports = {
  normalizeBillingMonth,
  getBillingMonthRange,
  getBillingMonthKeyFromDate,
  getBillStatus,
  calculateBillSummary,
  syncExistingBillForMonth,
  generateBill,
  getBills,
  getBillById,
  getCustomerBills,
  sendBillReceipt,
};
