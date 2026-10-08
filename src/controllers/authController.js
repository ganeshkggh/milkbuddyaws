const User = require("../models/User");
const Otp = require("../models/Otp");

const {
    generateAccessToken,
    generateRefreshToken,
} = require("../services/tokenService");

// =====================================================
// SEND OTP
// =====================================================

const sendOtp = async (req, res) => {
    try {
        const { mobileNumber } = req.body;

        // Validate mobile number
        if (!mobileNumber) {
            return res.status(400).json({
                success: false,
                message: "Mobile number is required",
            });
        }

        if (!/^[0-9]{10}$/.test(mobileNumber)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid 10-digit mobile number",
            });
        }

        // Development OTP
        // Later we will replace this with a real SMS service.
        const otp = "123456";

        // OTP expires after 5 minutes
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        // Delete previous OTP for this mobile number
        await Otp.deleteMany({
            mobileNumber,
        });

        // Save new OTP
        await Otp.create({
            mobileNumber,
            otp,
            expiresAt,
            verified: false,
        });

        return res.status(200).json({
            success: true,
            message: "OTP sent successfully",
            mobileNumber,
            expiresIn: 300,
        });
    } catch (error) {
        console.error("Send OTP error:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong",
        });
    }
};

// =====================================================
// VERIFY OTP
// =====================================================

const verifyOtp = async (req, res) => {
    try {
        const { mobileNumber, otp } = req.body;

        // Validate request
        if (!mobileNumber || !otp) {
            return res.status(400).json({
                success: false,
                message: "Mobile number and OTP are required",
            });
        }

        // Validate mobile number
        if (!/^[0-9]{10}$/.test(mobileNumber)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid 10-digit mobile number",
            });
        }

        // Find latest OTP
        const otpRecord = await Otp.findOne({
            mobileNumber,
            otp,
            verified: false,
        }).sort({
            createdAt: -1,
        });

        // OTP not found
        if (!otpRecord) {
            return res.status(400).json({
                success: false,
                message: "Invalid OTP",
            });
        }

        // Check OTP expiration
        if (otpRecord.expiresAt < new Date()) {
            return res.status(400).json({
                success: false,
                message: "OTP has expired",
            });
        }

        // Mark OTP as verified
        otpRecord.verified = true;
        await otpRecord.save();

        // Find existing user
        let user = await User.findOne({
            mobileNumber,
        });

        // Create user if first login
        if (!user) {
            user = await User.create({
                mobileNumber,
                userType: "vendor",
                isActive: true,
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "Your account is inactive",
            });
        }

        // Update last login
        user.lastLoginAt = new Date();
        await user.save();

        // Generate JWT access token
        const accessToken = generateAccessToken(user);

        // Generate JWT refresh token
        const refreshToken = generateRefreshToken(user);

        // Return successful response
        return res.status(200).json({
            success: true,
            message: "OTP verified successfully",

            user: {
                id: user._id,
                mobileNumber: user.mobileNumber,
                name: user.name,
                userType: user.userType,
                isActive: user.isActive,
            },

            tokens: {
                accessToken,
                refreshToken,
            },
        });
    } catch (error) {
    console.error("=================================");
    console.error("VERIFY OTP ERROR");
    console.error("Name:", error.name);
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);
    console.error("=================================");

    return res.status(500).json({
        success: false,
        message: error.message || "Something went wrong",
    });
}
};

// =====================================================
// EXPORT
// =====================================================

// =====================================================
// SEND AGENT OTP
// =====================================================

const sendAgentOtp = async (req, res) => {
    try {
        const { mobileNumber } = req.body;

        // Validate mobile number
        if (!mobileNumber) {
            return res.status(400).json({
                success: false,
                message: "Mobile number is required",
            });
        }

        if (!/^[0-9]{10}$/.test(mobileNumber)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid 10-digit mobile number",
            });
        }

        // Find delivery agent user
        const user = await User.findOne({
            mobileNumber,
            userType: "agent",
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message:
                    "Delivery agent account not found",
            });
        }

        // Check account status
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message:
                    "Delivery agent account is inactive",
            });
        }

        // Development OTP
        const otp = "123456";

        // OTP expires after 5 minutes
        const expiresAt = new Date(
            Date.now() + 5 * 60 * 1000
        );

        // Remove previous OTP
        await Otp.deleteMany({
            mobileNumber,
        });

        // Save new OTP
        await Otp.create({
            mobileNumber,
            otp,
            expiresAt,
            verified: false,
        });

        return res.status(200).json({
            success: true,
            message: "Agent OTP sent successfully",
            mobileNumber,
            expiresIn: 300,
        });
    } catch (error) {
        console.error(
            "Send Agent OTP error:",
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
// VERIFY AGENT OTP
// =====================================================

const verifyAgentOtp = async (req, res) => {
    try {
        const {
            mobileNumber,
            otp,
        } = req.body;

        // Validate request
        if (!mobileNumber || !otp) {
            return res.status(400).json({
                success: false,
                message:
                    "Mobile number and OTP are required",
            });
        }

        // Validate mobile number
        if (!/^[0-9]{10}$/.test(mobileNumber)) {
            return res.status(400).json({
                success: false,
                message:
                    "Enter a valid 10-digit mobile number",
            });
        }

        // Find OTP
        const otpRecord = await Otp.findOne({
            mobileNumber,
            otp,
            verified: false,
        }).sort({
            createdAt: -1,
        });

        if (!otpRecord) {
            return res.status(400).json({
                success: false,
                message: "Invalid OTP",
            });
        }

        // Check expiration
        if (otpRecord.expiresAt < new Date()) {
            return res.status(400).json({
                success: false,
                message: "OTP has expired",
            });
        }

        // Find agent
        const user = await User.findOne({
            mobileNumber,
            userType: "agent",
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message:
                    "Delivery agent account not found",
            });
        }

        // Check account status
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message:
                    "Delivery agent account is inactive",
            });
        }

        // Mark OTP as verified
        otpRecord.verified = true;
        await otpRecord.save();

        // Update last login
        user.lastLoginAt = new Date();
        await user.save();

        // Generate tokens
        const accessToken =
            generateAccessToken(user);

        const refreshToken =
            generateRefreshToken(user);

        return res.status(200).json({
            success: true,
            message:
                "Agent OTP verified successfully",

            user: {
                id: user._id,
                mobileNumber:
                    user.mobileNumber,
                name: user.name,
                userType:
                    user.userType,
                isActive:
                    user.isActive,
            },

            tokens: {
                accessToken,
                refreshToken,
            },
        });
    } catch (error) {
        console.error(
            "Verify Agent OTP error:",
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

module.exports = {
    sendOtp,
    verifyOtp,
     sendAgentOtp,
    verifyAgentOtp,
};