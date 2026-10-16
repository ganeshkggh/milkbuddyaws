const mongoose = require("mongoose");
const DeliveryAgent = require("../models/DeliveryAgent");
const Customer = require("../models/Customer");
const Delivery = require("../models/Delivery");
const Bill = require("../models/Bill");
const Payment = require("../models/Payment");
const { getIndiaDayRange, buildAgentTasks } = require("../services/agentTaskService");
const {
    syncExistingBillForMonth,
    getBillingMonthKeyFromDate,
} = require("./billController");

const normalizeDeliveryShift = (shiftValue, customerShift) => {
    const rawShift = (shiftValue || customerShift || "Morning").toString().trim();
    const normalized = rawShift.toLowerCase();

    if (normalized === "morning") return "Morning";
    if (normalized === "evening") return "Evening";
    if (normalized === "both") {
        if (customerShift && customerShift.toLowerCase() === "both") {
            return null;
        }
        return "Morning";
    }

    return null;
};

const getDeliveryPaymentInput = (body) => {
    const paymentPayload = body?.payment && typeof body.payment === "object" ? body.payment : {};
    const amountValue = body.paymentAmount ?? paymentPayload.amount ?? null;
    const methodValue = body.paymentMethod ?? paymentPayload.paymentMethod ?? "cash";
    const idempotencyValue = body.idempotencyKey ?? paymentPayload.idempotencyKey ?? null;
    const collectValue = body.collectPayment ?? paymentPayload.collectPayment ?? body.isPaid ?? false;

    return {
        amount: amountValue,
        paymentMethod: methodValue,
        idempotencyKey: idempotencyValue,
        collectPayment: collectValue === true || collectValue === "true",
    };
};

const finalizeDeliveryPayment = async ({
    vendorId,
    customerId,
    bill,
    paymentAmount,
    paymentMethod,
    idempotencyKey,
    collectorType,
    deliveryAgentId,
    collectorName,
    collectedByUserId,
    session,
}) => {
    const amountToPay = Number(paymentAmount);
    const currentOutstanding = Number(bill.outstandingAmount || 0);

    if (!Number.isFinite(amountToPay) || amountToPay <= 0) {
        throw Object.assign(new Error("Payment amount must be greater than zero"), { statusCode: 400 });
    }

    if (amountToPay > currentOutstanding) {
        throw Object.assign(new Error("Payment exceeds the bill's outstanding amount"), {
            statusCode: 400,
            outstandingAmount: currentOutstanding,
        });
    }

    const existingPayment = await Payment.findOne({
        vendorId,
        idempotencyKey: idempotencyKey.trim(),
    }).session(session);

    if (existingPayment) {
        if (
            existingPayment.billId.toString() !== bill._id.toString() ||
            existingPayment.customerId.toString() !== customerId.toString() ||
            Number(existingPayment.amount) !== Number(amountToPay)
        ) {
            throw Object.assign(new Error("Idempotency key was already used for another payment"), { statusCode: 409 });
        }

        return existingPayment;
    }

    const receiptNumber = `MB-${Date.now()}-${new mongoose.Types.ObjectId().toString().slice(-6).toUpperCase()}`;

    const updatedBill = await Bill.findOne({
        _id: bill._id,
        vendorId,
        customerId,
        outstandingAmount: { $gte: amountToPay },
    }).session(session);

    if (!updatedBill) {
        throw Object.assign(new Error("Bill balance changed. Refresh and try again."), { statusCode: 409 });
    }

    updatedBill.paidAmount = Number(updatedBill.paidAmount || 0) + amountToPay;
    updatedBill.outstandingAmount = Math.max(Number(updatedBill.outstandingAmount || 0) - amountToPay, 0);
    updatedBill.status = updatedBill.outstandingAmount <= 0 ? "paid" : (updatedBill.paidAmount > 0 ? "partially_paid" : "unpaid");
    await updatedBill.save({ session });

    const payment = await Payment.create([{
        vendorId,
        customerId,
        billId: bill._id,
        amount: amountToPay,
        paymentDate: new Date(),
        paymentMethod: paymentMethod,
        referenceNumber: "",
        notes: "",
        collectorType,
        deliveryAgentId,
        collectorName,
        collectedByUserId: collectedByUserId,
        receiptNumber,
        idempotencyKey: idempotencyKey.trim(),
        whatsappStatus: "not_configured",
    }], { session });

    return payment[0];
};

// =====================================================
// GET AGENT PROFILE
// =====================================================

const getAgentProfile = async (req, res) => {
    try {
        const userId = req.user.userId;

        const agent = await DeliveryAgent.findOne({
            userId,
            status: "active",
        }).lean();

        if (!agent) {
            return res.status(404).json({
                success: false,
                message: "Delivery agent profile not found",
            });
        }

        return res.status(200).json({
            success: true,
            agent: {
                id: agent._id,
                userId: agent.userId,
                vendorId: agent.vendorId,
                name: agent.name,
                mobileNumber: agent.mobileNumber,
                alternatePhone: agent.alternatePhone,
                address: agent.address,
                status: agent.status,
                joiningDate: agent.joiningDate,
            },
        });
    } catch (error) {
        console.error("Get agent profile error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

// =====================================================
// GET AGENT DASHBOARD
// =====================================================

const getAgentDashboard = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Find logged-in agent
        const agent = await DeliveryAgent.findOne({
            userId,
            status: "active",
        });

        if (!agent) {
            return res.status(404).json({
                success: false,
                message: "Delivery agent profile not found",
            });
        }

        // =================================================
        // TODAY DATE RANGE
        // =================================================

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // =================================================
        // GET ASSIGNED CUSTOMERS
        // =================================================

        const customers = await Customer.find({
            vendorId: agent.vendorId,
            deliveryAgentId: agent._id,
            status: "active",
        }).lean();

        // =================================================
        // GET TODAY'S DELIVERIES
        // =================================================

        const deliveries = await Delivery.find({
            deliveryAgentId: agent._id,
            deliveryDate: {
                $gte: startOfDay,
                $lte: endOfDay,
            },
        }).lean();

        // =================================================
        // CALCULATE SUMMARY
        // =================================================

        let totalMilkLiters = 0;
        let completedDeliveries = 0;
        let noDeliveryCount = 0;

        const deliveredCustomerIds = new Set();

        deliveries.forEach((delivery) => {
            const customerId = delivery.customerId?.toString();

            // No delivery
            if (delivery.isNoDelivery === true) {
                noDeliveryCount++;
                return;
            }

            // Normal delivery
            completedDeliveries++;

            if (customerId) {
                deliveredCustomerIds.add(customerId);
            }

            totalMilkLiters += Number(delivery.quantityLiters) || 0;
        });

        const totalCustomers = customers.length;

        const pendingDeliveries = Math.max(
            totalCustomers - deliveredCustomerIds.size - noDeliveryCount,
            0
        );

        return res.status(200).json({
            success: true,

            agent: {
                id: agent._id,
                name: agent.name,
                mobileNumber: agent.mobileNumber,
                status: agent.status,
            },

            summary: {
                totalCustomers,
                completedDeliveries,
                pendingDeliveries,
                noDeliveryCount,
                totalMilkLiters,
            },

            date: startOfDay,
        });
    } catch (error) {
        console.error("Get agent dashboard error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

// =====================================================
// GET AGENT CUSTOMERS
// =====================================================

const getAgentCustomers = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Find logged-in agent
        const agent = await DeliveryAgent.findOne({
            userId,
            status: "active",
        });

        if (!agent) {
            return res.status(404).json({
                success: false,
                message: "Delivery agent not found",
            });
        }

        // Get only customers assigned to this agent
        const customers = await Customer.find({
            vendorId: agent.vendorId,
            deliveryAgentId: agent._id,
            status: "active",
        })
            .sort({
                name: 1,
            })
            .lean();

        return res.status(200).json({
            success: true,
            count: customers.length,
            customers,
        });
    } catch (error) {
        console.error("Get agent customers error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

// =====================================================
// GET AGENT DELIVERIES
// =====================================================

const getAgentDeliveries = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Find logged-in agent
        const agent = await DeliveryAgent.findOne({
            userId,
            status: "active",
        });

        if (!agent) {
            return res.status(404).json({
                success: false,
                message: "Delivery agent not found",
            });
        }

        const { date, fromDate, toDate } = req.query;

        // Base filter
        const filter = {
            vendorId: agent.vendorId,
            deliveryAgentId: agent._id,
        };

        if (date) {
            try {
                const dayRange = getIndiaDayRange(date);
                filter.deliveryDate = { $gte: dayRange.fromDate, $lt: dayRange.toDate };
            } catch (error) {
                return res.status(error.statusCode || 400).json({ success: false, message: error.message });
            }
        } else if (fromDate || toDate) {
            filter.deliveryDate = {};

            if (fromDate) {
                try {
                    filter.deliveryDate.$gte = getIndiaDayRange(fromDate).fromDate;
                } catch (error) {
                    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
                }
            }

            if (toDate) {
                try {
                    filter.deliveryDate.$lt = getIndiaDayRange(toDate).toDate;
                } catch (error) {
                    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
                }
            }
        }

        const deliveries = await Delivery.find(filter)
            .populate(
                "customerId",
                "customerNumber name phone address ratePerLiter dailyQuantity shift product"
            )
            .sort({
                deliveryDate: -1,
            })
            .lean();

        return res.status(200).json({
            success: true,
            count: deliveries.length,
            deliveries,
        });
    } catch (error) {
        console.error("Get agent deliveries error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

// =====================================================
// GET AGENT TASKS
// =====================================================

const getAgentTasks = async (req, res) => {
    try {
        const userId = req.user.userId;

        const agent = await DeliveryAgent.findOne({
            userId,
            status: "active",
        });

        if (!agent) {
            return res.status(404).json({
                success: false,
                message: "Delivery agent not found",
            });
        }

        const { date } = req.query;
        let dayRange;
        try {
            dayRange = getIndiaDayRange(date || new Date());
        } catch (error) {
            return res.status(error.statusCode || 400).json({ success: false, message: error.message });
        }

        // Get assigned active customers
        const customers = await Customer.find({
            vendorId: agent.vendorId,
            deliveryAgentId: agent._id,
            status: "active",
        })
            .sort({ name: 1 })
            .lean();

        // Get deliveries recorded for date
        const deliveries = await Delivery.find({
            vendorId: agent.vendorId,
            deliveryAgentId: agent._id,
            deliveryDate: {
                $gte: dayRange.fromDate,
                $lt: dayRange.toDate,
            },
        }).lean();
        const result = buildAgentTasks(customers, deliveries, dayRange.fromDate);

        return res.status(200).json({
            success: true,
            date: dayRange.fromDate,
            ...result,
        });
    } catch (error) {
        console.error("Get agent tasks error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

// =====================================================
// CREATE AGENT DELIVERY
// =====================================================

const createAgentDelivery = async (req, res) => {
    try {
        const userId = req.user.userId;

        const agent = await DeliveryAgent.findOne({
            userId,
            status: "active",
        });

        if (!agent) {
            return res.status(404).json({
                success: false,
                message: "Delivery agent not found",
            });
        }

        const {
            customerId,
            deliveryDate,
            quantityLiters,
            shift,
            product,
            notes,
            isNoDelivery,
        } = req.body;
        const paymentInput = getDeliveryPaymentInput(req.body);

        if (!customerId) {
            return res.status(400).json({
                success: false,
                message: "Customer ID is required",
            });
        }

        // Customer must belong to agent's vendor AND be assigned to this agent
        const customer = await Customer.findOne({
            _id: customerId,
            vendorId: agent.vendorId,
            deliveryAgentId: agent._id,
        });

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: "Assigned customer not found",
            });
        }

        if (customer.status !== "active") {
            return res.status(400).json({
                success: false,
                message: "Cannot create delivery for an inactive customer",
            });
        }

        if (!deliveryDate) {
            return res.status(400).json({
                success: false,
                message: "Delivery date is required",
            });
        }

        const parsedDeliveryDate = new Date(`${deliveryDate}T00:00:00+05:30`);
        if (Number.isNaN(parsedDeliveryDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: "Invalid delivery date",
            });
        }

        const normalizedShift = normalizeDeliveryShift(shift, customer.shift);

        if (!normalizedShift) {
            return res.status(400).json({
                success: false,
                message: "Shift must be Morning or Evening",
            });
        }

        const normalizedProduct = (product || customer.product || "Cow Milk").toString().trim();

        const noDelivery = isNoDelivery === true || isNoDelivery === "true";

        let finalQuantity = Number(quantityLiters);

        if (noDelivery) {
            finalQuantity = 0;
        } else {
            if (quantityLiters === undefined || quantityLiters === null || quantityLiters === "") {
                finalQuantity = Number(customer.dailyQuantity) || 0;
            }

            if (!Number.isFinite(finalQuantity) || finalQuantity <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Quantity must be greater than 0",
                });
            }
        }

        const rateAtTime = Number(customer.ratePerLiter) || 0;
        const amount = noDelivery ? 0 : Number((finalQuantity * rateAtTime).toFixed(2));

        const startOfDay = new Date(`${deliveryDate}T00:00:00+05:30`);
        const endOfDay = new Date(`${deliveryDate}T23:59:59.999+05:30`);

        // Check duplicate delivery
        const existingDelivery = await Delivery.findOne({
            vendorId: agent.vendorId,
            customerId,
            deliveryDate: {
                $gte: startOfDay,
                $lte: endOfDay,
            },
            shift: normalizedShift,
            product: normalizedProduct,
        });

        if (existingDelivery) {
            return res.status(409).json({
                success: false,
                message: "Delivery already recorded for this shift and product",
                delivery: existingDelivery,
            });
        }

        const session = await mongoose.startSession();
        let createdDelivery = null;
        let createdPayment = null;

        try {
            await session.withTransaction(async () => {
                const deliveryRecords = await Delivery.create([{
                    vendorId: agent.vendorId,
                    customerId,
                    deliveryAgentId: agent._id,
                    deliveryDate: parsedDeliveryDate,
                    quantityLiters: finalQuantity,
                    rateAtTime,
                    amount,
                    shift: normalizedShift,
                    product: normalizedProduct,
                    notes: notes || "",
                    isNoDelivery: noDelivery,
                    synced: true,
                }], { session });

                createdDelivery = deliveryRecords[0];

                const billingMonth = getBillingMonthKeyFromDate(parsedDeliveryDate);
                const existingBill = await Bill.findOne({
                    vendorId: agent.vendorId,
                    customerId,
                    billingMonth,
                }).session(session);

                if (paymentInput.collectPayment) {
                    if (!paymentInput.idempotencyKey || !paymentInput.idempotencyKey.trim()) {
                        throw Object.assign(new Error("A unique idempotencyKey is required for payment collection"), { statusCode: 400 });
                    }

                    if (!existingBill) {
                        throw Object.assign(new Error("Bill not found for this customer and billing month"), { statusCode: 404 });
                    }

                    if (!Number.isFinite(Number(paymentInput.amount)) || Number(paymentInput.amount) <= 0) {
                        throw Object.assign(new Error("Payment amount must be greater than zero"), { statusCode: 400 });
                    }

                    const normalizedPaymentMethod = (paymentInput.paymentMethod || "cash").toLowerCase();
                    if (!["cash", "upi", "bank_transfer", "other"].includes(normalizedPaymentMethod)) {
                        throw Object.assign(new Error("Invalid payment method. Supported methods: cash, upi, bank_transfer, other"), { statusCode: 400 });
                    }

                    if (Number(paymentInput.amount) > Number(existingBill.outstandingAmount || 0)) {
                        throw Object.assign(new Error("Payment exceeds the bill's outstanding amount"), {
                            statusCode: 400,
                            outstandingAmount: Number(existingBill.outstandingAmount || 0),
                        });
                    }

                    const payment = await finalizeDeliveryPayment({
                        vendorId: agent.vendorId,
                        customerId,
                        bill: existingBill,
                        paymentAmount: paymentInput.amount,
                        paymentMethod: normalizedPaymentMethod,
                        idempotencyKey: paymentInput.idempotencyKey,
                        collectorType: "delivery_agent",
                        deliveryAgentId: agent._id,
                        collectorName: agent.name,
                        collectedByUserId: req.user.userId,
                        session,
                    });

                    createdPayment = payment;
                }

                await syncExistingBillForMonth({
                    vendorId: agent.vendorId,
                    customerId,
                    billingMonth,
                });
            });
        } catch (error) {
            if (error.statusCode === 409) {
                return res.status(409).json({
                    success: false,
                    message: error.message,
                });
            }

            if (error.statusCode === 400 || error.statusCode === 404) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message,
                });
            }

            throw error;
        } finally {
            session.endSession();
        }

        return res.status(201).json({
            success: true,
            message: noDelivery ? "No delivery recorded" : "Delivery created successfully",
            delivery: createdDelivery,
            payment: createdPayment,
        });
    } catch (error) {
        console.error("Create agent delivery error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create delivery",
        });
    }
};

// =====================================================
// EXPORT
// =====================================================

module.exports = {
    getAgentProfile,
    getAgentDashboard,
    getAgentCustomers,
    getAgentDeliveries,
    getAgentTasks,
    createAgentDelivery,
};
