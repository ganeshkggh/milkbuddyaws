const express = require("express");

const router = express.Router();

const {
  getDashboard,
  getTodaySummary,
  getMonthlySummary,
  getLastMonthSummary,
} = require("../controllers/dashboardController");

const authMiddleware = require("../middleware/authMiddleware");

router.get(
  "/",
  authMiddleware,
  getDashboard
);

router.get(
  "/today-summary",
  authMiddleware,
  getTodaySummary
);

router.get(
  "/monthly",
  authMiddleware,
  getMonthlySummary
);

router.get(
  "/last-month",
  authMiddleware,
  getLastMonthSummary
);

module.exports = router;