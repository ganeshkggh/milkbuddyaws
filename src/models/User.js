const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        mobileNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },

        name: {
            type: String,
            default: "",
            trim: true,
        },

        userType: {
            type: String,
            enum: ["vendor", "agent"],
            default: "vendor",
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        lastLoginAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("User", userSchema);