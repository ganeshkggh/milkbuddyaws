const mongoose = require("mongoose");

const Payment = require("../models/Payment");
const Bill = require("../models/Bill");
const Customer = require("../models/Customer");


// =====================================================
// ADD PAYMENT
// =====================================================

const addPayment = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    const {
      customerId,
      billId,
      amount,
      paymentDate,
      paymentMethod,
      referenceNumber,
      notes,
    } = req.body;

    // ---------------------------------------------
    // Validate required fields
    // ---------------------------------------------

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "customerId is required",
      });
    }

    if (!billId) {
      return res.status(400).json({
        success: false,
        message: "billId is required",
      });
    }

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid payment amount is required",
      });
    }

    if (!paymentMethod) {
      return res.status(400).json({
        success: false,
        message: "paymentMethod is required",
      });
    }

    // ---------------------------------------------
    // Validate ObjectIds
    // ---------------------------------------------

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customerId",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(billId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid billId",
      });
    }

    // ---------------------------------------------
    // Validate payment method
    // ---------------------------------------------

    const allowedPaymentMethods = [
      "cash",
      "upi",
      "bank_transfer",
      "other",
    ];

    if (!allowedPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid paymentMethod. Use cash, upi, bank_transfer or other",
      });
    }

    // ---------------------------------------------
    // Check customer
    // ---------------------------------------------

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

    // ---------------------------------------------
    // Check bill
    // ---------------------------------------------

    const bill = await Bill.findOne({
      _id: billId,
      vendorId,
      customerId,
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message:
          "Bill not found or does not belong to this customer",
      });
    }

    // ---------------------------------------------
    // Validate amount
    // ---------------------------------------------

    const paymentAmount = Number(
      Number(amount).toFixed(2)
    );

    // Don't allow payment greater than outstanding
    if (paymentAmount > bill.outstandingAmount) {
      return res.status(400).json({
        success: false,
        message: "Payment amount cannot exceed outstanding amount",
        outstandingAmount: bill.outstandingAmount,
      });
    }

    // ---------------------------------------------
    // Create payment
    // ---------------------------------------------

    const payment = await Payment.create({
      vendorId,
      customerId,
      billId,
      amount: paymentAmount,
      paymentDate: paymentDate || new Date(),
      paymentMethod,
      referenceNumber: referenceNumber || "",
      notes: notes || "",
    });

    // ---------------------------------------------
    // Update bill
    // ---------------------------------------------

    bill.paidAmount = Number(
      (
        bill.paidAmount + paymentAmount
      ).toFixed(2)
    );

    bill.outstandingAmount = Math.max(
      Number(
        (
          bill.totalAmount - bill.paidAmount
        ).toFixed(2)
      ),
      0
    );

    // ---------------------------------------------
    // Update bill status
    // ---------------------------------------------

    if (bill.paidAmount >= bill.totalAmount) {
      bill.status = "paid";
    } else if (bill.paidAmount > 0) {
      bill.status = "partially_paid";
    } else {
      bill.status = "unpaid";
    }

    await bill.save();

    return res.status(201).json({
      success: true,
      message: "Payment added successfully",

      payment,

      bill: {
        id: bill._id,
        totalAmount: bill.totalAmount,
        paidAmount: bill.paidAmount,
        outstandingAmount: bill.outstandingAmount,
        status: bill.status,
      },
    });

  } catch (error) {
    console.error(
      "Add payment error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to add payment",
    });
  }
};


// =====================================================
// GET PAYMENTS FOR BILL
// =====================================================

const getBillPayments = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { billId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(billId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid billId",
      });
    }

    const bill = await Bill.findOne({
      _id: billId,
      vendorId,
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: "Bill not found",
      });
    }

    const payments = await Payment.find({
      vendorId,
      billId,
    }).sort({
      paymentDate: -1,
      createdAt: -1,
    });

    return res.json({
      success: true,
      count: payments.length,
      payments,
    });

  } catch (error) {
    console.error(
      "Get bill payments error:",
      error
    );

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
    const vendorId = req.user.userId;
    const { customerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customerId",
      });
    }

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

    const payments = await Payment.find({
      vendorId,
      customerId,
    })
      .populate(
        "billId",
        "billingMonth totalAmount paidAmount outstandingAmount status"
      )
      .sort({
        paymentDate: -1,
        createdAt: -1,
      });

    return res.json({
      success: true,
      count: payments.length,
      payments,
    });

  } catch (error) {
    console.error(
      "Get customer payments error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer payments",
    });
  }
};


// =====================================================
// GET BILL PAYMENT SUMMARY
// =====================================================

const getBillPaymentSummary = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { billId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(billId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid billId",
      });
    }

    const bill = await Bill.findOne({
      _id: billId,
      vendorId,
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: "Bill not found",
      });
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
          totalPaid: {
            $sum: "$amount",
          },
        },
      },
    ]);

    const totalPaid =
      result.length > 0
        ? Number(result[0].totalPaid.toFixed(2))
        : 0;

    return res.json({
      success: true,
      data: {
        billId: bill._id,
        totalAmount: bill.totalAmount,
        totalPaid,
        paidAmount: bill.paidAmount,
        outstandingAmount:
          bill.outstandingAmount,
        status: bill.status,
      },
    });

  } catch (error) {
    console.error(
      "Get bill payment summary error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch payment summary",
    });
  }
};


module.exports = {
  addPayment,
  getBillPayments,
  getCustomerPayments,
  getBillPaymentSummary,
};