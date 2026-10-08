const express = require("express");

const {
    createCustomer,
    getCustomers,
    getCustomerById,
    updateCustomer,
    deactivateCustomer,
    activateCustomer,
} = require("../controllers/customerController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


// Create customer
router.post(
    "/",
    authMiddleware,
    createCustomer
);


// Get all customers
router.get(
    "/",
    authMiddleware,
    getCustomers
);


// Get customer by ID
router.get(
    "/:id",
    authMiddleware,
    getCustomerById
);


// Update customer
router.put(
    "/:id",
    authMiddleware,
    updateCustomer
);


// Deactivate customer
router.patch(
    "/:id/deactivate",
    authMiddleware,
    deactivateCustomer
);
router.patch(
  "/:id/activate",
  authMiddleware,
  activateCustomer
);

module.exports = router;