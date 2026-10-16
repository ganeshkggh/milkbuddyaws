
const express = require("express");
const router = express.Router();

const {
    checkVendor,
    startVendorRegistration,
    resendVendorRegistrationOtp,
    verifyVendorRegistrationOtp,
    sendOtp,
    verifyOtp,
    sendAgentOtp,
    verifyAgentOtp,
} = require("../controllers/authController");

// Vendor registration
router.post("/check-vendor", checkVendor);
router.post("/vendor-registration/start", startVendorRegistration);
router.post(
    "/vendor-registration/resend-otp",
    resendVendorRegistrationOtp
);
router.post(
    "/vendor-registration/verify-otp",
    verifyVendorRegistrationOtp
);

// Vendor login
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);

// Agent login
router.post("/agent/send-otp", sendAgentOtp);
router.post("/agent/verify-otp", verifyAgentOtp);

module.exports = router;
