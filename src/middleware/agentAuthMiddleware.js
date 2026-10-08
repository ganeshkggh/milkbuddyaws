const User = require("../models/User");
const authMiddleware = require("./authMiddleware");

const agentAuthMiddleware = async (req, res, next) => {
    try {
        authMiddleware(req, res, async () => {
            try {
                const user = await User.findById(
                    req.user.userId
                );

                if (!user) {
                    return res.status(401).json({
                        success: false,
                        message: "User not found",
                    });
                }

                if (user.userType !== "agent") {
                    return res.status(403).json({
                        success: false,
                        message:
                            "Access denied. Delivery agent account required.",
                    });
                }

                if (!user.isActive) {
                    return res.status(403).json({
                        success: false,
                        message:
                            "Delivery agent account is inactive",
                    });
                }

                next();
            } catch (error) {
                console.error(
                    "Agent authorization error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to verify agent account",
                });
            }
        });
    } catch (error) {
        console.error(
            "Agent authentication error:",
            error
        );

        return res.status(401).json({
            success: false,
            message:
                "Invalid agent authentication",
        });
    }
};

module.exports = agentAuthMiddleware;