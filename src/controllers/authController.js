
const User = require("../models/User");
const {
    generateAccessToken,
    generateRefreshToken,
} = require("../services/tokenService");
const {
    normalizeMobileNumber,
    issueOtp,
    consumeOtp,
} = require("../services/authService");

const getMobile = (body = {}) =>
    normalizeMobileNumber(body.mobileNumber ?? body.mobile);

const sendError = (res, error, fallback = "Something went wrong") => {
    const status = Number.isInteger(error.statusCode)
        ? error.statusCode
        : error.code === 11000
            ? 409
            : 500;

    if (status >= 500) {
        console.error("Authentication error:", error.message);
    }

    return res.status(status).json({
        success: false,
        message: status >= 500 ? fallback : error.message,
    });
};

const getTokens = (user) => ({
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(user),
});

const publicUser = (user) => ({
    id: user._id,
    mobileNumber: user.mobileNumber,
    name: user.name,
    userType: user.userType,
    isActive: user.isActive,
});

// Check whether a mobile number already has an account.
const checkVendor = async (req, res) => {
    try {
        const mobileNumber = getMobile(req.body);

        if (!mobileNumber) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid 10-digit Indian mobile number",
            });
        }

        const user = await User.findOne({ mobileNumber });

        return res.status(200).json({
            success: true,
            isRegistered: Boolean(
                user &&
                user.userType === "vendor" &&
                user.isActive &&
                !user.registrationPending
            ),
            role: user?.userType ?? null,
            userType: user?.userType ?? null,
        });
    } catch (error) {
        return sendError(res, error);
    }
};

// Start a new Vendor registration or resume a pending registration.
const startVendorRegistration = async (req, res) => {
    try {
        const mobileNumber = getMobile(req.body);
        const name = typeof req.body?.name === "string"
            ? req.body.name.trim()
            : "";
        const address = typeof req.body?.address === "string"
            ? req.body.address.trim()
            : "";

        if (!mobileNumber) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid 10-digit Indian mobile number",
            });
        }

        if (!name || name.length > 100) {
            return res.status(400).json({
                success: false,
                message: "Name is required and must be at most 100 characters",
            });
        }

        if (!address || address.length > 500) {
            return res.status(400).json({
                success: false,
                message: "Address is required and must be at most 500 characters",
            });
        }

        let user = await User.findOne({ mobileNumber });

        if (user && user.userType !== "vendor") {
            return res.status(409).json({
                success: false,
                message: "This mobile number belongs to an Agent account",
            });
        }

        if (user && user.isActive && !user.registrationPending) {
            return res.status(409).json({
                success: false,
                message: "Vendor account already exists. Please log in.",
            });
        }

        if (user && !user.registrationPending) {
            return res.status(403).json({
                success: false,
                message: "This Vendor account is inactive. Contact support.",
            });
        }

        if (!user) {
            user = await User.create({
                mobileNumber,
                name,
                address,
                userType: "vendor",
                isActive: false,
                registrationPending: true,
            });
        } else {
            user.name = name;
            user.address = address;
            user.isActive = false;
            user.registrationPending = true;
            await user.save();
        }

        const result = await issueOtp(
            mobileNumber,
            "vendor_registration"
        );

        return res.status(200).json({
            success: true,
            message: "Registration OTP requested",
            mobileNumber,
            expiresIn: result.expiresIn,
        });
    } catch (error) {
        return sendError(res, error, "Unable to start Vendor registration");
    }
};

// Resend OTP only for a pending Vendor registration.
const resendVendorRegistrationOtp = async (req, res) => {
    try {
        const mobileNumber = getMobile(req.body);

        if (!mobileNumber) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid 10-digit Indian mobile number",
            });
        }

        const user = await User.findOne({
            mobileNumber,
            userType: "vendor",
            isActive: false,
            registrationPending: true,
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "No pending Vendor registration was found",
            });
        }

        const result = await issueOtp(
            mobileNumber,
            "vendor_registration"
        );

        return res.status(200).json({
            success: true,
            message: "Registration OTP requested",
            mobileNumber,
            expiresIn: result.expiresIn,
        });
    } catch (error) {
        return sendError(res, error, "Unable to resend registration OTP");
    }
};

// Verify registration OTP, then activate the pending Vendor.
const verifyVendorRegistrationOtp = async (req, res) => {
    try {
        const mobileNumber = getMobile(req.body);
        const otp = String(req.body?.otp ?? "").trim();

        if (!mobileNumber || !/^\d{6}$/.test(otp)) {
            return res.status(400).json({
                success: false,
                message: "A valid mobile number and 6-digit OTP are required",
            });
        }

        const pendingUser = await User.findOne({
            mobileNumber,
            userType: "vendor",
            isActive: false,
            registrationPending: true,
        });

        if (!pendingUser) {
            return res.status(404).json({
                success: false,
                message: "No pending Vendor registration was found",
            });
        }

        await consumeOtp(mobileNumber, otp, "vendor_registration");

        // Conditional update prevents activation if the account state changed.
        const user = await User.findOneAndUpdate(
            {
                _id: pendingUser._id,
                userType: "vendor",
                isActive: false,
                registrationPending: true,
            },
            {
                $set: {
                    isActive: true,
                    registrationPending: false,
                    lastLoginAt: new Date(),
                },
            },
            { new: true, runValidators: true }
        );

        if (!user) {
            return res.status(409).json({
                success: false,
                message: "Registration state changed. Please check your account.",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Vendor registration completed successfully",
            user: publicUser(user),
            tokens: getTokens(user),
        });
    } catch (error) {
        return sendError(res, error, "Unable to verify registration OTP");
    }
};

// Vendor login: existing, active Vendor accounts only.
const sendOtp = async (req, res) => {
    try {
        const mobileNumber = getMobile(req.body);

        if (!mobileNumber) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid 10-digit Indian mobile number",
            });
        }

        const user = await User.findOne({ mobileNumber });

        if (!user || user.userType !== "vendor") {
            return res.status(404).json({
                success: false,
                message: "Vendor account not found. Please register first.",
            });
        }

        if (!user.isActive || user.registrationPending) {
            return res.status(403).json({
                success: false,
                message: "Vendor account is inactive or registration is incomplete",
            });
        }

        const result = await issueOtp(mobileNumber, "vendor_login");

        return res.status(200).json({
            success: true,
            message: "Login OTP requested",
            mobileNumber,
            expiresIn: result.expiresIn,
        });
    } catch (error) {
        return sendError(res, error, "Unable to request login OTP");
    }
};

const verifyOtp = async (req, res) => {
    try {
        const mobileNumber = getMobile(req.body);
        const otp = String(req.body?.otp ?? "").trim();

        if (!mobileNumber || !/^\d{6}$/.test(otp)) {
            return res.status(400).json({
                success: false,
                message: "A valid mobile number and 6-digit OTP are required",
            });
        }

        const user = await User.findOne({ mobileNumber });

        if (!user || user.userType !== "vendor") {
            return res.status(404).json({
                success: false,
                message: "Vendor account not found",
            });
        }

        if (!user.isActive || user.registrationPending) {
            return res.status(403).json({
                success: false,
                message: "Vendor account is inactive or registration is incomplete",
            });
        }

        await consumeOtp(mobileNumber, otp, "vendor_login");

        user.lastLoginAt = new Date();
        await user.save();

        return res.status(200).json({
            success: true,
            message: "OTP verified successfully",
            user: publicUser(user),
            tokens: getTokens(user),
        });
    } catch (error) {
        return sendError(res, error, "Unable to verify login OTP");
    }
};

// Agent login: existing, active Agent accounts only.
const sendAgentOtp = async (req, res) => {
    try {
        const mobileNumber = getMobile(req.body);

        if (!mobileNumber) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid 10-digit Indian mobile number",
            });
        }

        const user = await User.findOne({
            mobileNumber,
            userType: "agent",
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Delivery agent account not found",
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "Delivery agent account is inactive",
            });
        }

        const result = await issueOtp(mobileNumber, "agent_login");

        return res.status(200).json({
            success: true,
            message: "Agent login OTP requested",
            mobileNumber,
            expiresIn: result.expiresIn,
        });
    } catch (error) {
        return sendError(res, error, "Unable to request Agent OTP");
    }
};

const verifyAgentOtp = async (req, res) => {
    try {
        const mobileNumber = getMobile(req.body);
        const otp = String(req.body?.otp ?? "").trim();

        if (!mobileNumber || !/^\d{6}$/.test(otp)) {
            return res.status(400).json({
                success: false,
                message: "A valid mobile number and 6-digit OTP are required",
            });
        }

        const user = await User.findOne({
            mobileNumber,
            userType: "agent",
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Delivery agent account not found",
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "Delivery agent account is inactive",
            });
        }

        await consumeOtp(mobileNumber, otp, "agent_login");

        user.lastLoginAt = new Date();
        await user.save();

        return res.status(200).json({
            success: true,
            message: "Agent OTP verified successfully",
            user: publicUser(user),
            tokens: getTokens(user),
        });
    } catch (error) {
        return sendError(res, error, "Unable to verify Agent OTP");
    }
};

module.exports = {
    checkVendor,
    startVendorRegistration,
    resendVendorRegistrationOtp,
    verifyVendorRegistrationOtp,
    sendOtp,
    verifyOtp,
    sendAgentOtp,
    verifyAgentOtp,
};
