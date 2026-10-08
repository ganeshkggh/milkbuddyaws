const jwt = require("jsonwebtoken");

console.log("JWT_SECRET exists:", !!process.env.JWT_SECRET);
console.log("JWT_REFRESH_SECRET exists:", !!process.env.JWT_REFRESH_SECRET);

// Generate access token — valid for 30 days
const generateAccessToken = (user) => {
    return jwt.sign(
        {
            userId: user._id.toString(),
            mobileNumber: user.mobileNumber,
            userType: user.userType,
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "30d",
        }
    );
};

// Generate refresh token — valid for 30 days
const generateRefreshToken = (user) => {
    return jwt.sign(
        {
            userId: user._id.toString(),
        },
        process.env.JWT_REFRESH_SECRET,
        {
            expiresIn: "30d",
        }
    );
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
};