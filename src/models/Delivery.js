const mongoose = require("mongoose");

const deliverySchema = new mongoose.Schema(
    {
        // Vendor who owns this delivery
        vendorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // Customer receiving the delivery
        customerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
            required: true,
            index: true,
        },

        deliveryAgentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "DeliveryAgent",
            default: null,
            index: true,
        },
        // Bill that includes this delivery.
        // null means this delivery has not yet been billed.
        billId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Bill",
            default: null,
            index: true,
        },

        // Date on which milk was delivered
        deliveryDate: {
            type: Date,
            required: true,
            index: true,
        },

        deliveryDay: {
            type: String,
            match: /^\d{4}-\d{2}-\d{2}$/,
            index: true,
        },

        // Quantity delivered in litres
        quantityLiters: {
            type: Number,
            required: true,
            min: 0,
        },

        // Rate at the time of delivery
        // Important: keep historical rate even if customer's
        // current rate changes later.
        rateAtTime: {
            type: Number,
            required: true,
            min: 0,
        },

        // quantityLiters × rateAtTime
        amount: {
            type: Number,
            required: true,
            min: 0,
        },

        // Morning / Evening
        shift: {
            type: String,
            required: true,
            trim: true,
        },

        // Cow Milk / Buffalo Milk / etc.
        product: {
            type: String,
            required: true,
            trim: true,
        },

        // Optional delivery notes
        notes: {
            type: String,
            default: "",
            trim: true,
        },

        // Whether the customer did not receive milk
        isNoDelivery: {
            type: Boolean,
            default: false,
        },

        // Useful later when we implement offline sync
        synced: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);


// Prevent duplicate delivery records for the same:
// vendor + customer + date + shift + product
deliverySchema.index(
    {
        vendorId: 1,
        customerId: 1,
        deliveryDate: 1,
        shift: 1,
        product: 1,
    },
    {
        unique: true,
    }
);

deliverySchema.index(
    {
        vendorId: 1,
        customerId: 1,
        deliveryDay: 1,
        shift: 1,
        product: 1,
    },
    {
        unique: true,
        partialFilterExpression: {
            deliveryDay: { $type: "string" },
        },
    }
);


module.exports = mongoose.model("Delivery", deliverySchema);