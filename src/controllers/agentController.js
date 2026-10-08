const DeliveryAgent = require("../models/DeliveryAgent");
const Customer = require("../models/Customer");
const Delivery = require("../models/Delivery");

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
            const customerId =
                delivery.customerId?.toString();

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

            totalMilkLiters +=
                Number(delivery.quantityLiters) || 0;
        });

        const totalCustomers = customers.length;

        const pendingDeliveries =
            Math.max(
                totalCustomers -
                    deliveredCustomerIds.size -
                    noDeliveryCount,
                0
            );

        // =================================================
        // RETURN DASHBOARD
        // =================================================

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
        console.error(
            "Get agent dashboard error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Something went wrong",
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
        console.error(
            "Get agent customers error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Something went wrong",
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

        const {
            date,
            fromDate,
            toDate,
        } = req.query;

        // Base filter
        const filter = {
            deliveryAgentId: agent._id,
        };

        // =================================================
        // SINGLE DATE FILTER
        // =================================================

        if (date) {
            const start = new Date(date);
            start.setHours(0, 0, 0, 0);

            const end = new Date(date);
            end.setHours(23, 59, 59, 999);

            filter.deliveryDate = {
                $gte: start,
                $lte: end,
            };
        }

        // =================================================
        // DATE RANGE FILTER
        // =================================================

        else if (fromDate || toDate) {
            filter.deliveryDate = {};

            if (fromDate) {
                const start = new Date(fromDate);
                start.setHours(0, 0, 0, 0);

                filter.deliveryDate.$gte = start;
            }

            if (toDate) {
                const end = new Date(toDate);
                end.setHours(23, 59, 59, 999);

                filter.deliveryDate.$lte = end;
            }
        }

        // =================================================
        // GET DELIVERIES
        // =================================================

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
        console.error(
            "Get agent deliveries error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Something went wrong",
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
};