const User = require("../models/User");
const Customer = require("../models/Customer");
const Delivery = require("../models/Delivery");
const Bill = require("../models/Bill");

const getDashboard = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    // Get vendor
    const vendor = await User.findById(vendorId).select(
      "name mobileNumber"
    );

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    // Start and end of today in India
    const now = new Date();

    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    );

    const tomorrowStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      0
    );

    // Active customers
    const activeCustomerCount = await Customer.countDocuments({
      vendorId,
      status: "active",
    });

    // Today's deliveries
    const todayDeliveries = await Delivery.find({
      vendorId,
      deliveryDate: {
        $gte: todayStart,
        $lt: tomorrowStart,
      },
    });

    let revenue = 0;
    let milkDeliveredLiters = 0;

    const deliveredCustomerIds = new Set();

    for (const delivery of todayDeliveries) {
      if (!delivery.isNoDelivery) {
        revenue += delivery.amount || 0;
        milkDeliveredLiters += delivery.quantityLiters || 0;

        deliveredCustomerIds.add(
          delivery.customerId.toString()
        );
      }
    }

    const deliveredCustomerCount = deliveredCustomerIds.size;

    const pendingDeliveryCount = Math.max(
      activeCustomerCount - deliveredCustomerCount,
      0
    );

    res.json({
      success: true,
      data: {
        vendor: {
          name: vendor.name || "",
          mobileNumber: vendor.mobileNumber || "",
        },

        today: {
          revenue,
          milkDeliveredLiters,
          activeCustomerCount,
          deliveredCustomerCount,
          pendingDeliveryCount,
        },
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load dashboard",
    });
  }
};

const getTodaySummary = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    const { shift = "all" } = req.query;

    // Validate shift
    const allowedShifts = ["all", "morning", "evening"];

    if (!allowedShifts.includes(shift.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid shift. Use all, morning or evening",
      });
    }

    const now = new Date();

    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    );

    const tomorrowStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      0
    );

    // Get active customers
    const activeCustomerCount = await Customer.countDocuments({
      vendorId,
      status: "active",
    });

    // Build delivery filter
    const deliveryFilter = {
      vendorId,
      deliveryDate: {
        $gte: todayStart,
        $lt: tomorrowStart,
      },
    };

    // Apply shift filter
    if (shift.toLowerCase() !== "all") {
      deliveryFilter.shift =
        shift.toLowerCase() === "morning"
          ? "Morning"
          : "Evening";
    }

    const deliveries = await Delivery.find(deliveryFilter);

    let revenue = 0;
    let milkDeliveredLiters = 0;

    const deliveredCustomerIds = new Set();

    for (const delivery of deliveries) {
      if (!delivery.isNoDelivery) {
        revenue += delivery.amount || 0;

        milkDeliveredLiters +=
          delivery.quantityLiters || 0;

        deliveredCustomerIds.add(
          delivery.customerId.toString()
        );
      }
    }

    const deliveredCustomerCount =
      deliveredCustomerIds.size;

    const pendingDeliveryCount = Math.max(
      activeCustomerCount - deliveredCustomerCount,
      0
    );

    return res.json({
      success: true,
      data: {
        shift: shift.toLowerCase(),

        revenue,
        milkDeliveredLiters,
        pendingDeliveryCount,
        deliveredCustomerCount,
      },
    });
  } catch (error) {
    console.error(
      "Today summary error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to load today's summary",
    });
  }
};

const getMonthlySummary = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    const { month } = req.query;

    let startDate;
    let endDate;
    let billingMonth;

    if (month) {
      const monthRegex = /^\d{4}-\d{2}$/;

      if (!monthRegex.test(month)) {
        return res.status(400).json({
          success: false,
          message: "Invalid month format. Use YYYY-MM",
        });
      }

      const [year, monthNumber] =
        month.split("-").map(Number);

      if (monthNumber < 1 || monthNumber > 12) {
        return res.status(400).json({
          success: false,
          message: "Invalid month",
        });
      }

      startDate = new Date(
        year,
        monthNumber - 1,
        1,
        0,
        0,
        0,
        0
      );

      endDate = new Date(
        year,
        monthNumber,
        1,
        0,
        0,
        0,
        0
      );

      billingMonth = month;
    } else {
      const now = new Date();

      startDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0
      );

      endDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        1,
        0,
        0,
        0,
        0
      );

      billingMonth =
        `${startDate.getFullYear()}-${String(
          startDate.getMonth() + 1
        ).padStart(2, "0")}`;
    }

    // Get deliveries
    const deliveries = await Delivery.find({
      vendorId,
      deliveryDate: {
        $gte: startDate,
        $lt: endDate,
      },
    });

    let revenue = 0;
    let milkDeliveredLiters = 0;

    const customerIds = new Set();
    const deliveryDates = new Set();

    for (const delivery of deliveries) {
      if (!delivery.isNoDelivery) {
        revenue += delivery.amount || 0;

        milkDeliveredLiters +=
          delivery.quantityLiters || 0;

        customerIds.add(
          delivery.customerId.toString()
        );

        deliveryDates.add(
          new Date(delivery.deliveryDate)
            .toISOString()
            .substring(0, 10)
        );
      }
    }

    const numberOfDays =
      deliveryDates.size;

    const averageMilkPerDay =
      numberOfDays > 0
        ? milkDeliveredLiters / numberOfDays
        : 0;

    const averageRevenuePerDay =
      numberOfDays > 0
        ? revenue / numberOfDays
        : 0;

    // Get bills for this month
    const monthlyBillCount =
      await Bill.countDocuments({
        vendorId,
        billingMonth,
      });

    return res.json({
      success: true,

      data: {
        month: billingMonth,

        monthlyBills: monthlyBillCount,

        revenue,

        milkDeliveredLiters,

        customerCount: customerIds.size,

        averageMilkPerDay: Number(
          averageMilkPerDay.toFixed(2)
        ),

        averageRevenuePerDay: Number(
          averageRevenuePerDay.toFixed(2)
        ),
      },
    });
  } catch (error) {
    console.error(
      "Monthly summary error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to load monthly summary",
    });
  }
};

const getLastMonthSummary = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    const now = new Date();

    // Current month start
    const currentMonthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0
    );

    // Previous month start
    const lastMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
      0,
      0,
      0,
      0
    );

    const lastMonthYear =
      lastMonthStart.getFullYear();

    const lastMonthNumber =
      lastMonthStart.getMonth() + 1;

    const billingMonth =
      `${lastMonthYear}-${String(
        lastMonthNumber
      ).padStart(2, "0")}`;

    // -----------------------------
    // DELIVERY DATA
    // -----------------------------

    const deliveries = await Delivery.find({
      vendorId,
      deliveryDate: {
        $gte: lastMonthStart,
        $lt: currentMonthStart,
      },
    });

    let revenue = 0;
    let milkDeliveredLiters = 0;

    for (const delivery of deliveries) {
      if (!delivery.isNoDelivery) {
        revenue += delivery.amount || 0;

        milkDeliveredLiters +=
          delivery.quantityLiters || 0;
      }
    }

    // -----------------------------
    // BILL DATA
    // -----------------------------

    const bills = await Bill.find({
      vendorId,
      billingMonth,
    });

    let collected = 0;
    let outstanding = 0;

    for (const bill of bills) {
      collected += bill.paidAmount || 0;

      outstanding +=
        bill.outstandingAmount || 0;
    }

    const monthName =
      lastMonthStart.toLocaleString(
        "en-US",
        {
          month: "long",
        }
      );

    return res.json({
      success: true,

      data: {
        month: billingMonth,

        monthName,

        year: lastMonthYear,

        milkDeliveredLiters,

        revenue,

        collected,

        outstanding,

        billCount: bills.length,
      },
    });
  } catch (error) {
    console.error(
      "Last month summary error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to load last month summary",
    });
  }
};


module.exports = {
  getDashboard,
  getTodaySummary,
  getMonthlySummary,
  getLastMonthSummary,
};