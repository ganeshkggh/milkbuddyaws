const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
    {
        mobileNumber: {
            type: String,
            required: true,
            index: true,
        },

        otp: {
            type: String,
            required: true,
        },

        expiresAt: {
            type: Date,
            required: true,
        },

        verified: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Otp", otpSchema);