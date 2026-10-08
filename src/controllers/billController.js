const Bill = require("../models/Bill");
const Customer = require("../models/Customer");
const Delivery = require("../models/Delivery");

const generateBill = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    const {
      customerId,
      billingMonth,
    } = req.body;

    // Validate required fields
    if (!customerId || !billingMonth) {
      return res.status(400).json({
        success: false,
        message:
          "customerId and billingMonth are required",
      });
    }

    // Validate month format
    const monthRegex = /^\d{4}-\d{2}$/;

    if (!monthRegex.test(billingMonth)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid billingMonth. Use YYYY-MM",
      });
    }

    const [year, month] =
      billingMonth.split("-").map(Number);

    if (month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        message: "Invalid billing month",
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

    // First day of billing month
    const fromDate = new Date(
      year,
      month - 1,
      1,
      0,
      0,
      0,
      0
    );

    // First day of next month
    const toDate = new Date(
      year,
      month,
      1,
      0,
      0,
      0,
      0
    );

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

    let totalMilkLiters = 0;
    let totalAmount = 0;

    for (const delivery of deliveries) {
      // No Delivery should not be included
      if (delivery.isNoDelivery) {
        continue;
      }

      totalMilkLiters +=
        delivery.quantityLiters || 0;

      totalAmount +=
        delivery.amount || 0;
    }

    totalMilkLiters = Number(
      totalMilkLiters.toFixed(2)
    );

    totalAmount = Number(
      totalAmount.toFixed(2)
    );

    // Check whether bill already exists
    let bill = await Bill.findOne({
      vendorId,
      customerId,
      billingMonth,
    });

    if (bill) {
      // Recalculate existing bill
      bill.totalMilkLiters = totalMilkLiters;
      bill.totalAmount = totalAmount;

      bill.outstandingAmount = Math.max(
        totalAmount - bill.paidAmount,
        0
      );

      if (bill.paidAmount >= totalAmount) {
        bill.status = "paid";
      } else if (bill.paidAmount > 0) {
        bill.status = "partially_paid";
      } else {
        bill.status = "unpaid";
      }

      await bill.save();

      return res.json({
        success: true,
        message: "Bill recalculated successfully",
        bill,
      });
    }

    // Create new bill
    bill = await Bill.create({
      vendorId,
      customerId,
      billingMonth,
      fromDate,
      toDate,

      totalMilkLiters,
      totalAmount,

      paidAmount: 0,
      outstandingAmount: totalAmount,

      status:
        totalAmount > 0
          ? "unpaid"
          : "paid",
    });

    return res.status(201).json({
      success: true,
      message: "Bill generated successfully",
      bill,
    });
  } catch (error) {
    console.error(
      "Generate bill error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to generate bill",
    });
  }
};

const getBills = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    const {
      month,
      customerId,
      status,
    } = req.query;

    const filter = {
      vendorId,
    };

    // Filter by billing month
    if (month) {
      const monthRegex = /^\d{4}-\d{2}$/;

      if (!monthRegex.test(month)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid month format. Use YYYY-MM",
        });
      }

      filter.billingMonth = month;
    }

    // Filter by customer
    if (customerId) {
      filter.customerId = customerId;
    }

    // Filter by payment status
    if (status) {
      const allowedStatuses = [
        "unpaid",
        "partially_paid",
        "paid",
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid status. Use unpaid, partially_paid or paid",
        });
      }

      filter.status = status;
    }

    const bills = await Bill.find(filter)
      .populate(
        "customerId",
        "customerNumber name phone"
      )
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
    console.error(
      "Get bills error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch bills",
    });
  }
};

const getBillById = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { id } = req.params;

    const bill = await Bill.findOne({
      _id: id,
      vendorId,
    }).populate(
      "customerId",
      "customerNumber name phone ratePerLiter"
    );

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: "Bill not found",
      });
    }

    return res.json({
      success: true,
      bill,
    });
  } catch (error) {
    console.error(
      "Get bill by ID error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch bill",
    });
  }
};

const getCustomerBills = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { customerId } = req.params;

    const {
      fromMonth,
      toMonth,
    } = req.query;

    const filter = {
      vendorId,
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
            message:
              "Invalid fromMonth. Use YYYY-MM",
          });
        }

        filter.billingMonth.$gte = fromMonth;
      }

      if (toMonth) {
        const toRegex = /^\d{4}-\d{2}$/;

        if (!toRegex.test(toMonth)) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid toMonth. Use YYYY-MM",
          });
        }

        filter.billingMonth.$lte = toMonth;
      }
    }

    const bills = await Bill.find(filter)
      .sort({
        billingMonth: -1,
      });

    return res.json({
      success: true,
      count: bills.length,
      bills,
    });
  } catch (error) {
    console.error(
      "Get customer bills error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer bills",
    });
  }
};

module.exports = {
  generateBill,
  getBills,
  getBillById,
  getCustomerBills,
};