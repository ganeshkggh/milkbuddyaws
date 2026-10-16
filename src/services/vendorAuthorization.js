const mongoose = require("mongoose");
const User = require("../models/User");
const DeliveryAgent = require("../models/DeliveryAgent");

const getActiveVendor = async (userId) => {
    if (!mongoose.Types.ObjectId.isValid(userId || "")) return null;
    return User.findOne({ _id: userId, userType: "vendor", isActive: true });
};

const getAssignedActiveAgent = async (vendorId, deliveryAgentId) => {
    if (!mongoose.Types.ObjectId.isValid(deliveryAgentId || "")) {
        throw Object.assign(new Error("Invalid deliveryAgentId"), { statusCode: 400 });
    }
    const agent = await DeliveryAgent.findOne({
        _id: deliveryAgentId,
        vendorId,
        status: "active",
    });
    if (!agent) {
        throw Object.assign(new Error("Active delivery agent not found for this vendor"), { statusCode: 404 });
    }
    return agent;
};

module.exports = { getActiveVendor, getAssignedActiveAgent };