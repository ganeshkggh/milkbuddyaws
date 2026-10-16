const Otp = require("../models/Otp");

const MAX_OTP_ATTEMPTS = 5;
const MAX_OTP_SENDS_PER_HOUR = 5;
const OTP_EXPIRY_MS = 5 * 60 * 1000;

const normalizeMobileNumber = (value) => {
    if (typeof value !== "string") return null;
    const digits = value.replace(/\D/g, "");
    const nationalNumber = digits.length === 12 && digits.startsWith("91")
        ? digits.slice(2)
        : digits;
    return /^[6-9]\d{9}$/.test(nationalNumber) ? nationalNumber : null;
};

const isDevelopmentOtpEnabled = (env = process.env) =>
    env.OTP_DEV_MODE === "true" && env.NODE_ENV !== "production";

const getDevelopmentOtp = (env = process.env) => {
    if (!isDevelopmentOtpEnabled(env)) {
        throw Object.assign(new Error("OTP delivery is not configured"), { statusCode: 503 });
    }
    const otp = env.OTP_DEV_CODE || "123456";
    if (!/^\d{6}$/.test(otp)) {
        throw Object.assign(new Error("Development OTP configuration is invalid"), { statusCode: 503 });
    }
    return otp;
};

const issueOtp = async (mobileNumber, purpose) => {
    const otp = getDevelopmentOtp();
    const windowStart = new Date(Date.now() - 60 * 60 * 1000);
    const recentSends = await Otp.countDocuments({
        mobileNumber,
        purpose,
        createdAt: { $gte: windowStart },
    });
    if (recentSends >= MAX_OTP_SENDS_PER_HOUR) {
        throw Object.assign(new Error("Too many OTP requests. Try again later."), { statusCode: 429 });
    }

    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    await Otp.create({ mobileNumber, otp, purpose, expiresAt, verified: false, attempts: 0 });
    return { expiresAt, expiresIn: OTP_EXPIRY_MS / 1000 };
};

const invalidOtpError = () => Object.assign(new Error("Invalid or expired OTP"), { statusCode: 401 });

const consumeOtp = async (mobileNumber, submittedOtp, purpose) => {
    const otpRecord = await Otp.findOne({ mobileNumber, purpose, verified: false })
        .sort({ createdAt: -1 });
    if (!otpRecord) throw invalidOtpError();

    const now = new Date();
    if (otpRecord.expiresAt <= now) {
        await Otp.updateOne({ _id: otpRecord._id, verified: false }, { $set: { verified: true } });
        throw invalidOtpError();
    }
    if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) throw invalidOtpError();

    if (otpRecord.otp !== String(submittedOtp)) {
        const updated = await Otp.findOneAndUpdate(
            { _id: otpRecord._id, verified: false, attempts: { $lt: MAX_OTP_ATTEMPTS } },
            { $inc: { attempts: 1 } },
            { new: true },
        );
        if (updated?.attempts >= MAX_OTP_ATTEMPTS) {
            await Otp.updateOne({ _id: updated._id, verified: false }, { $set: { verified: true } });
        }
        throw invalidOtpError();
    }

    const consumed = await Otp.findOneAndUpdate(
        {
            _id: otpRecord._id,
            verified: false,
            expiresAt: { $gt: now },
            attempts: { $lt: MAX_OTP_ATTEMPTS },
        },
        { $set: { verified: true } },
        { new: true },
    );
    if (!consumed) throw invalidOtpError();
    return consumed;
};

module.exports = {
    MAX_OTP_ATTEMPTS,
    MAX_OTP_SENDS_PER_HOUR,
    normalizeMobileNumber,
    isDevelopmentOtpEnabled,
    getDevelopmentOtp,
    issueOtp,
    consumeOtp,
};
