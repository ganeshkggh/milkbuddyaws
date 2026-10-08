const express = require("express");

const router = express.Router();

const {
  addPayment,
  getBillPayments,
  getCustomerPayments,
  getBillPaymentSummary,
} = require("../controllers/paymentController");

const authMiddleware = require("../middleware/authMiddleware");


// Add payment
router.post(
  "/",
  authMiddleware,
  addPayment
);


// Get payments for a bill
router.get(
  "/bill/:billId",
  authMiddleware,
  getBillPayments
);


// Get payment summary for a bill
router.get(
  "/bill/:billId/summary",
  authMiddleware,
  getBillPaymentSummary
);


// Get all payments of a customer
router.get(
  "/customer/:customerId",
  authMiddleware,
  getCustomerPayments
);


module.exports = router;