const mongoose = require("mongoose");
const Delivery = require("../models/Delivery");
const Customer = require("../models/Customer");
const Bill = require("../models/Bill");
const Payment = require("../models/Payment");
const DeliveryAgent = require("../models/DeliveryAgent");
const User = require("../models/User");
const {
    getBillingMonthKeyFromDate,
    syncExistingBillForMonth,
} = require("./billController");

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

const withDeliveryStatus = (delivery) => ({
    ...(typeof delivery.toObject === "function" ? delivery.toObject() : delivery),
    status: delivery.isNoDelivery ? "no_delivery" : "completed",
});

const parseDeliveryDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00+05:30`);
    const dateKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
    return Number.isNaN(date.getTime()) || dateKey !== value ? null : date;
};

const normalizeDeliveryShift = (shiftValue, customerShift) => {
    const configuredShift = String(customerShift || "").trim().toLowerCase();
    const requestedShift = String(shiftValue || "").trim().toLowerCase();
    const actualShift = requestedShift || (configuredShift === "both" ? "" : configuredShift || "morning");

    if (!["morning", "evening"].includes(actualShift)) return null;
    if (configuredShift && configuredShift !== "both" && actualShift !== configuredShift) return null;
    return actualShift === "morning" ? "Morning" : "Evening";
};

const getActor = async (req) => {
    const userId = req.user?.userId;
    if (!mongoose.Types.ObjectId.isValid(userId || "")) return null;
    const user = await User.findById(userId);
    if (!user?.isActive) return null;

    if (user.userType === "vendor") {
        return { type: "vendor", userId: user._id, vendorId: user._id, agentId: null, name: user.name || "Vendor" };
    }
    if (user.userType === "agent") {
        const agent = await DeliveryAgent.findOne({ userId: user._id, status: "active" });
        if (!agent) return null;
        return { type: "delivery_agent", userId: user._id, vendorId: agent.vendorId, agentId: agent._id, name: agent.name };
    }
    return null;
};

const getCustomerForActor = async (actor, customerId, requireActive = true) => {
    if (!mongoose.Types.ObjectId.isValid(customerId || "")) {
        throw Object.assign(new Error("Invalid customerId"), { statusCode: 400 });
    }
    const customer = await Customer.findOne({ _id: customerId, vendorId: actor.vendorId });
    if (!customer) throw Object.assign(new Error("Customer not found"), { statusCode: 404 });
    if (actor.type === "delivery_agent" && customer.deliveryAgentId?.toString() !== actor.agentId.toString()) {
        throw Object.assign(new Error("This customer is not assigned to you"), { statusCode: 403 });
    }
    if (actor.type === "vendor" && customer.deliveryAgentId) {
        const assignedAgent = await DeliveryAgent.findOne({
            _id: customer.deliveryAgentId,
            vendorId: actor.vendorId,
            status: "active",
        });
        if (!assignedAgent) throw Object.assign(new Error("Customer has an invalid or inactive delivery-agent assignment"), { statusCode: 400 });
    }
    if (requireActive && customer.status !== "active") throw Object.assign(new Error("Cannot record delivery for an inactive customer"), { statusCode: 400 });
    return customer;
};

const getPaymentInput = (body) => {
    const nested = body.payment && typeof body.payment === "object" ? body.payment : {};
    const choice = body.paymentChoice ?? nested.choice;
    const amount = body.paymentAmount ?? nested.amount;
    const method = body.paymentMethod ?? nested.paymentMethod;
    const idempotencyKey = body.idempotencyKey ?? nested.idempotencyKey;
    if (!["unpaid", "paid"].includes(choice)) {
        throw Object.assign(new Error("paymentChoice is required and must be unpaid or paid"), { statusCode: 400 });
    }
    if (choice === "unpaid") return { choice, amount: null, method: null, idempotencyKey: null };
    const paymentAmount = Number(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        throw Object.assign(new Error("A payment amount greater than zero is required"), { statusCode: 400 });
    }
    if (!["cash", "upi", "bank_transfer", "other"].includes(String(method || "").toLowerCase())) {
        throw Object.assign(new Error("paymentMethod must be cash, upi, bank_transfer, or other"), { statusCode: 400 });
    }
    if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 128) {
        throw Object.assign(new Error("A unique idempotencyKey is required for payment collection"), { statusCode: 400 });
    }
    return { choice, amount: roundMoney(paymentAmount), method: method.toLowerCase(), idempotencyKey: idempotencyKey.trim() };
};

const getDeliveryValues = (body, customer, currentDelivery) => {
    const deliveryDate = body.deliveryDate === undefined && currentDelivery
        ? currentDelivery.deliveryDate
        : parseDeliveryDate(body.deliveryDate);
    if (!deliveryDate) throw Object.assign(new Error("deliveryDate must be a valid YYYY-MM-DD date"), { statusCode: 400 });

    const shift = normalizeDeliveryShift(body.shift === undefined && currentDelivery ? currentDelivery.shift : body.shift, customer.shift);
    if (!shift) throw Object.assign(new Error("Shift must be Morning or Evening and match the customer's configured shift"), { statusCode: 400 });

    const configuredProducts = Array.isArray(customer.products) && customer.products.length
        ? customer.products.map((item) => String(item).trim().toLowerCase())
        : (customer.product ? [String(customer.product).trim().toLowerCase()] : []);
    const rawProduct = body.product === undefined && currentDelivery
        ? currentDelivery.product
        : body.product || customer.product || customer.products?.[0];
    const product = typeof rawProduct === "string" ? rawProduct.trim() : "";
    if (!product || (configuredProducts.length && !configuredProducts.includes(product.toLowerCase()))) {
        throw Object.assign(new Error("A valid configured product is required"), { statusCode: 400 });
    }

    const noDelivery = body.isNoDelivery === undefined && currentDelivery
        ? currentDelivery.isNoDelivery
        : body.isNoDelivery === true || body.isNoDelivery === "true";
    const rawQuantity = body.quantityLiters === undefined && currentDelivery
        ? currentDelivery.quantityLiters
        : body.quantityLiters;
    const quantity = noDelivery ? 0 : Number(rawQuantity);
    if (!noDelivery && (!Number.isFinite(quantity) || quantity <= 0)) {
        throw Object.assign(new Error("quantityLiters must be greater than zero"), { statusCode: 400 });
    }
    const rateAtTime = currentDelivery ? Number(currentDelivery.rateAtTime) : Number(customer.ratePerLiter || 0);
    return {
        deliveryDate,
        deliveryDay: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(deliveryDate),
        shift,
        product,
        noDelivery,
        quantityLiters: quantity,
        rateAtTime,
        amount: noDelivery ? 0 : roundMoney(quantity * rateAtTime),
        notes: body.notes === undefined && currentDelivery ? currentDelivery.notes : String(body.notes || ""),
    };
};

const getDuplicateDeliveryFilter = ({ vendorId, customerId, values }) => {
    const dayStart = new Date(`${values.deliveryDay}T00:00:00+05:30`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    return {
        vendorId,
        customerId,
        shift: values.shift,
        product: values.product,
        $or: [
            { deliveryDay: values.deliveryDay },
            {
                deliveryDay: { $exists: false },
                deliveryDate: { $gte: dayStart, $lt: dayEnd },
            },
        ],
    };
};

const refreshBillsFromMonth = async (vendorId, customerId, billingMonth, session) => {
    let query = Bill.find({ vendorId, customerId, billingMonth: { $gte: billingMonth } }).sort({ billingMonth: 1 });
    if (session) query = query.session(session);
    const bills = await query;
    for (const bill of bills) {
        await syncExistingBillForMonth({ vendorId, customerId, billingMonth: bill.billingMonth, session });
    }
};

const recordPayment = async (actor, customerId, bill, paymentInput, session) => {
    const priorPayment = await Payment.findOne({ vendorId: actor.vendorId, idempotencyKey: paymentInput.idempotencyKey }).session(session);
    if (priorPayment) {
        if (priorPayment.billId.toString() !== bill._id.toString() || priorPayment.customerId.toString() !== customerId.toString() || roundMoney(priorPayment.amount) !== paymentInput.amount) {
            throw Object.assign(new Error("Idempotency key was already used for another payment"), { statusCode: 409 });
        }
        return priorPayment;
    }

    const updatedBill = await Bill.findOneAndUpdate(
        { _id: bill._id, vendorId: actor.vendorId, customerId, outstandingAmount: { $gte: paymentInput.amount } },
        [
            { $set: {
                paidAmount: { $round: [{ $add: ["$paidAmount", paymentInput.amount] }, 2] },
                outstandingAmount: { $round: [{ $subtract: ["$outstandingAmount", paymentInput.amount] }, 2] },
            } },
            { $set: { status: { $cond: [{ $lte: ["$outstandingAmount", 0] }, "paid", "partially_paid"] } } },
        ],
        { new: true, session }
    );
    if (!updatedBill) throw Object.assign(new Error("Payment exceeds the bill's outstanding amount"), { statusCode: 409 });

    const [payment] = await Payment.create([{
        vendorId: actor.vendorId,
        customerId,
        billId: bill._id,
        amount: paymentInput.amount,
        paymentDate: new Date(),
        paymentMethod: paymentInput.method,
        collectorType: actor.type,
        deliveryAgentId: actor.agentId,
        collectorName: actor.name,
        collectedByUserId: actor.userId,
        receiptNumber: `MB-${Date.now()}-${new mongoose.Types.ObjectId().toString().slice(-6).toUpperCase()}`,
        idempotencyKey: paymentInput.idempotencyKey,
        whatsappStatus: "not_configured",
    }], { session });
    return payment;
};

const createDelivery = async (req, res) => {
    let session;
    let duplicateFilter;
    try {
        const actor = await getActor(req);
        if (!actor) return res.status(403).json({ success: false, message: "Authorized vendor or active delivery agent required" });
        const customer = await getCustomerForActor(actor, req.body.customerId);
        const values = getDeliveryValues(req.body, customer);
        const paymentInput = getPaymentInput(req.body);
        const deliveryAgentId = actor.type === "delivery_agent" ? actor.agentId : customer.deliveryAgentId || null;
        duplicateFilter = getDuplicateDeliveryFilter({ vendorId: actor.vendorId, customerId: customer._id, values });
        session = await mongoose.startSession();
        let delivery;
        let payment = null;

        await session.withTransaction(async () => {
            const existing = await Delivery.findOne(duplicateFilter).session(session);
            if (existing) throw Object.assign(new Error("Delivery already exists for this customer, date, shift and product"), { statusCode: 409, existingDelivery: existing });

            [delivery] = await Delivery.create([{
                vendorId: actor.vendorId,
                customerId: customer._id,
                deliveryAgentId,
                ...values,
                synced: true,
            }], { session });

            const billingMonth = getBillingMonthKeyFromDate(values.deliveryDate);
            await refreshBillsFromMonth(actor.vendorId, customer._id, billingMonth, session);
            if (paymentInput.choice === "paid") {
                const bill = await Bill.findOne({ vendorId: actor.vendorId, customerId: customer._id, billingMonth }).session(session);
                if (!bill) throw Object.assign(new Error("Generate this month's bill before collecting payment"), { statusCode: 404 });
                payment = await recordPayment(actor, customer._id, bill, paymentInput, session);
                await syncExistingBillForMonth({ vendorId: actor.vendorId, customerId: customer._id, billingMonth, session });
            }
        });

        return res.status(201).json({
            success: true,
            message: "Delivery created successfully",
            delivery: withDeliveryStatus(delivery),
            payment,
        });
    } catch (error) {
        if (error.code === 11000) {
            const existing = duplicateFilter ? await Delivery.findOne(duplicateFilter) : null;
            if (existing) {
                return res.status(409).json({
                    success: false,
                    duplicate: true,
                    message: "Delivery already exists for this customer, date, shift and product",
                    delivery: existing,
                });
            }
            return res.status(409).json({ success: false, message: "Delivery or payment already exists" });
        }
        if (error.statusCode) return res.status(error.statusCode).json({
            success: false,
            message: error.message,
            ...(error.outstandingAmount === undefined ? {} : { outstandingAmount: error.outstandingAmount }),
            ...(error.existingDelivery ? { duplicate: true, delivery: error.existingDelivery } : {}),
        });
        console.error("Create delivery error:", error);
        return res.status(500).json({ success: false, message: "Something went wrong while creating delivery" });
    } finally {
        if (session) await session.endSession();
    }
};

const getDeliveries = async (req, res) => {
    try {
        const actor = await getActor(req);
        if (!actor) return res.status(403).json({ success: false, message: "Authorized vendor or active delivery agent required" });
        const filter = { vendorId: actor.vendorId };
        if (actor.type === "delivery_agent") {
            const assignedCustomers = await Customer.find({ vendorId: actor.vendorId, deliveryAgentId: actor.agentId }).select("_id").lean();
            filter.customerId = { $in: assignedCustomers.map((customer) => customer._id) };
        }
        if (req.query.date) {
            const date = parseDeliveryDate(req.query.date);
            if (!date) return res.status(400).json({ success: false, message: "Invalid date. Use YYYY-MM-DD" });
            const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
            const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
            filter.$or = [
                { deliveryDay: day },
                {
                    deliveryDay: { $exists: false },
                    deliveryDate: { $gte: date, $lt: nextDate },
                },
            ];
        }
        if (req.query.shift) {
            const normalized = String(req.query.shift).toLowerCase();
            if (!(["morning", "evening"].includes(normalized))) return res.status(400).json({ success: false, message: "Invalid shift. Use Morning or Evening" });
            filter.shift = normalized === "morning" ? "Morning" : "Evening";
        }
        if (req.query.customerId) {
            if (!mongoose.Types.ObjectId.isValid(req.query.customerId)) return res.status(400).json({ success: false, message: "Invalid customerId" });
            const customer = await getCustomerForActor(actor, req.query.customerId, false);
            filter.customerId = customer._id;
        }
        const deliveries = await Delivery.find(filter).populate("customerId", "customerNumber name phone ratePerLiter").sort({ deliveryDate: -1, createdAt: -1 });
        return res.json({ success: true, count: deliveries.length, deliveries });
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
        console.error("Get deliveries error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch deliveries" });
    }
};

const updateDelivery = async (req, res) => {
    let session;
    try {
        const actor = await getActor(req);
        if (!actor) return res.status(403).json({ success: false, message: "Authorized vendor or active delivery agent required" });
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid delivery id" });
        const deliveryFilter = { _id: id, vendorId: actor.vendorId };
        const current = await Delivery.findOne(deliveryFilter);
        if (!current) return res.status(404).json({ success: false, message: "Delivery not found" });
        const customer = await getCustomerForActor(actor, current.customerId, false);
        const values = getDeliveryValues(req.body, customer, current);
        session = await mongoose.startSession();
        let updated;
        await session.withTransaction(async () => {
            const duplicateFilter = getDuplicateDeliveryFilter({
                vendorId: actor.vendorId,
                customerId: current.customerId,
                values,
            });
            duplicateFilter._id = { $ne: current._id };
            const duplicate = await Delivery.findOne(duplicateFilter).session(session);
            if (duplicate) throw Object.assign(new Error("A delivery already exists for this customer, date, shift and product"), { statusCode: 409 });
            Object.assign(current, values);
            updated = await current.save({ session });
            const months = [getBillingMonthKeyFromDate(current.deliveryDate), getBillingMonthKeyFromDate(values.deliveryDate)].sort();
            await refreshBillsFromMonth(actor.vendorId, customer._id, months[0], session);
        });
        return res.json({ success: true, message: "Delivery updated successfully", delivery: withDeliveryStatus(updated) });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, message: "A delivery already exists for this customer, date, shift and product" });
        if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
        console.error("Update delivery error:", error);
        return res.status(500).json({ success: false, message: "Failed to update delivery" });
    } finally {
        if (session) await session.endSession();
    }
};

const deleteDelivery = async (req, res) => {
    let session;
    try {
        const actor = await getActor(req);
        if (!actor) return res.status(403).json({ success: false, message: "Authorized vendor or active delivery agent required" });
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid delivery id" });
        const filter = { _id: id, vendorId: actor.vendorId };
        session = await mongoose.startSession();
        let deleted;
        await session.withTransaction(async () => {
            deleted = await Delivery.findOne(filter).session(session);
            if (!deleted) throw Object.assign(new Error("Delivery not found"), { statusCode: 404 });
            await getCustomerForActor(actor, deleted.customerId, false);
            await Delivery.deleteOne({ _id: deleted._id }, { session });
            await refreshBillsFromMonth(actor.vendorId, deleted.customerId, getBillingMonthKeyFromDate(deleted.deliveryDate), session);
        });
        return res.json({ success: true, message: "Delivery deleted successfully" });
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
        console.error("Delete delivery error:", error);
        return res.status(500).json({ success: false, message: "Failed to delete delivery" });
    } finally {
        if (session) await session.endSession();
    }
};

module.exports = {
    createDelivery,
    getDeliveries,
    updateDelivery,
    deleteDelivery,
    normalizeDeliveryShift,
    parseDeliveryDate,
    getPaymentInput,
    withDeliveryStatus,
};