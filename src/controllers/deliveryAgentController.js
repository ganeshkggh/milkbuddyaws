const User = require("../models/User");
const DeliveryAgent = require("../models/DeliveryAgent");
const Customer = require("../models/Customer");

// =====================================================
// CREATE DELIVERY AGENT
// =====================================================

const createDeliveryAgent = async (req, res) => {
    try {
        const vendorId = req.user.userId;

        const {
            name,
            mobileNumber,
            alternatePhone,
            address,
        } = req.body;

        if (!name || !mobileNumber) {
            return res.status(400).json({
                success: false,
                message: "Name and mobile number are required",
            });
        }

        if (!/^[0-9]{10}$/.test(mobileNumber)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid 10-digit mobile number",
            });
        }

        const existingAgent = await DeliveryAgent.findOne({
            vendorId,
            mobileNumber,
        });

        if (existingAgent) {
            return res.status(409).json({
                success: false,
                message: "Delivery agent already exists",
            });
        }

        let user = await User.findOne({
            mobileNumber,
        });

        if (user && user.userType !== "agent") {
            return res.status(409).json({
                success: false,
                message:
                    "This mobile number is already registered with another user",
            });
        }

        if (!user) {
            user = await User.create({
                mobileNumber,
                name,
                userType: "agent",
                isActive: true,
            });
        } else {
            user.name = name;
            user.isActive = true;
            await user.save();
        }

        const agent = await DeliveryAgent.create({
            vendorId,
            userId: user._id,
            name,
            mobileNumber,
            alternatePhone: alternatePhone || "",
            address: address || "",
            status: "active",
        });

        return res.status(201).json({
            success: true,
            message: "Delivery agent created successfully",
            agent,
        });
    } catch (error) {
        console.error("Create delivery agent error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

// =====================================================
// GET ALL DELIVERY AGENTS
// =====================================================

const getDeliveryAgents = async (req, res) => {
    try {
        const vendorId = req.user.userId;

        const agents = await DeliveryAgent.find({
            vendorId,
        }).sort({
            createdAt: -1,
        });

        return res.status(200).json({
            success: true,
            count: agents.length,
            agents,
        });
    } catch (error) {
        console.error("Get delivery agents error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

// =====================================================
// GET DELIVERY AGENT BY ID
// =====================================================

const getDeliveryAgentById = async (req, res) => {
    try {
        const vendorId = req.user.userId;
        const { id } = req.params;

        const agent = await DeliveryAgent.findOne({
            _id: id,
            vendorId,
        });

        if (!agent) {
            return res.status(404).json({
                success: false,
                message: "Delivery agent not found",
            });
        }

        return res.status(200).json({
            success: true,
            agent,
        });
    } catch (error) {
        console.error("Get delivery agent error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

// =====================================================
// UPDATE DELIVERY AGENT
// =====================================================

const updateDeliveryAgent = async (req, res) => {
    try {
        const vendorId = req.user.userId;
        const { id } = req.params;

        const {
            name,
            alternatePhone,
            address,
        } = req.body;

        const agent = await DeliveryAgent.findOne({
            _id: id,
            vendorId,
        });

        if (!agent) {
            return res.status(404).json({
                success: false,
                message: "Delivery agent not found",
            });
        }

        if (name !== undefined) {
            if (!name.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Name cannot be empty",
                });
            }

            agent.name = name.trim();
        }

        if (alternatePhone !== undefined) {
            agent.alternatePhone =
                alternatePhone.trim();
        }

        if (address !== undefined) {
            agent.address = address.trim();
        }

        await agent.save();

        // Keep User name in sync
        await User.findByIdAndUpdate(
            agent.userId,
            {
                name: agent.name,
            }
        );

        return res.status(200).json({
            success: true,
            message: "Delivery agent updated successfully",
            agent,
        });
    } catch (error) {
        console.error(
            "Update delivery agent error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

// =====================================================
// DEACTIVATE DELIVERY AGENT
// =====================================================

const deactivateDeliveryAgent = async (req, res) => {
    try {
        const vendorId = req.user.userId;
        const { id } = req.params;

        const agent = await DeliveryAgent.findOne({
            _id: id,
            vendorId,
        });

        if (!agent) {
            return res.status(404).json({
                success: false,
                message: "Delivery agent not found",
            });
        }

        agent.status = "inactive";
        await agent.save();

        await User.findByIdAndUpdate(
            agent.userId,
            {
                isActive: false,
            }
        );

        return res.status(200).json({
            success: true,
            message:
                "Delivery agent deactivated successfully",
        });
    } catch (error) {
        console.error(
            "Deactivate delivery agent error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

// =====================================================
// ACTIVATE DELIVERY AGENT
// =====================================================

const activateDeliveryAgent = async (req, res) => {
    try {
        const vendorId = req.user.userId;
        const { id } = req.params;

        const agent = await DeliveryAgent.findOne({
            _id: id,
            vendorId,
        });

        if (!agent) {
            return res.status(404).json({
                success: false,
                message: "Delivery agent not found",
            });
        }

        agent.status = "active";
        await agent.save();

        await User.findByIdAndUpdate(
            agent.userId,
            {
                isActive: true,
            }
        );

        return res.status(200).json({
            success: true,
            message:
                "Delivery agent activated successfully",
        });
    } catch (error) {
        console.error(
            "Activate delivery agent error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

// =====================================================
// ASSIGN CUSTOMER TO DELIVERY AGENT
// =====================================================

const assignCustomerToAgent = async (req, res) => {
    try {
        const vendorId = req.user.userId;

        const { customerId } = req.params;
        const { deliveryAgentId } = req.body;

        if (!deliveryAgentId) {
            return res.status(400).json({
                success: false,
                message:
                    "Delivery agent ID is required",
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

        const agent = await DeliveryAgent.findOne({
            _id: deliveryAgentId,
            vendorId,
            status: "active",
        });

        if (!agent) {
            return res.status(404).json({
                success: false,
                message:
                    "Active delivery agent not found",
            });
        }

        customer.deliveryAgentId = agent._id;

        await customer.save();

        return res.status(200).json({
            success: true,
            message:
                "Customer assigned to delivery agent successfully",
            customer,
        });
    } catch (error) {
        console.error(
            "Assign customer to agent error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

// =====================================================
// REMOVE CUSTOMER FROM DELIVERY AGENT
// =====================================================

const removeCustomerFromAgent = async (req, res) => {
    try {
        const vendorId = req.user.userId;
        const { customerId } = req.params;

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

        customer.deliveryAgentId = null;

        await customer.save();

        return res.status(200).json({
            success: true,
            message:
                "Customer removed from delivery agent",
        });
    } catch (error) {
        console.error(
            "Remove customer from agent error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
};

module.exports = {
    createDeliveryAgent,
    getDeliveryAgents,
    getDeliveryAgentById,
    updateDeliveryAgent,
    deactivateDeliveryAgent,
    activateDeliveryAgent,
    assignCustomerToAgent,
    removeCustomerFromAgent,
};