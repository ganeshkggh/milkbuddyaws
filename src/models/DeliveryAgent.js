const mongoose = require("mongoose");

const deliveryAgentSchema = new mongoose.Schema(
    {
        vendorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },

        name: {
            type: String,
            required: true,
            trim: true,
        },

        mobileNumber: {
            type: String,
            required: true,
            trim: true,
        },

        alternatePhone: {
            type: String,
            default: "",
            trim: true,
        },

        address: {
            type: String,
            default: "",
            trim: true,
        },

        status: {
            type: String,
            enum: ["active", "inactive"],
            default: "active",
        },

        joiningDate: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
);

deliveryAgentSchema.index(
    { vendorId: 1, mobileNumber: 1 },
    { unique: true }
);

module.exports = mongoose.model(
    "DeliveryAgent",
    deliveryAgentSchema
);