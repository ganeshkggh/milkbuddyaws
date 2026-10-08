const express = require("express");

const router = express.Router();

const {
    sendOtp,
    verifyOtp,
    sendAgentOtp,
    verifyAgentOtp,
} = require("../controllers/authController");

// =====================================================
// VENDOR AUTH
// =====================================================

router.post(
    "/send-otp",
    sendOtp
);

router.post(
    "/verify-otp",
    verifyOtp
);

// =====================================================
// DELIVERY AGENT AUTH
// =====================================================

router.post(
    "/agent/send-otp",
    sendAgentOtp
);

router.post(
    "/agent/verify-otp",
    verifyAgentOtp
);

module.exports = router;