const express = require("express");

const router = express.Router();

const {
  generateBill,
  getBills,
  getBillById,
  getCustomerBills,
} = require("../controllers/billController");

const authMiddleware = require("../middleware/authMiddleware");

router.post(
  "/generate",
  authMiddleware,
  generateBill
);

router.get(
  "/",
  authMiddleware,
  getBills
);

router.get(
  "/customer/:customerId",
  authMiddleware,
  getCustomerBills
);

router.get(
  "/:id",
  authMiddleware,
  getBillById
);

module.exports = router;