const express = require("express");

const router = express.Router();

const {
    createDeliveryAgent,
    getDeliveryAgents,
    getDeliveryAgentById,
    updateDeliveryAgent,
    deactivateDeliveryAgent,
    activateDeliveryAgent,
    assignCustomerToAgent,
    removeCustomerFromAgent,
} = require("../controllers/deliveryAgentController");

const authMiddleware = require("../middleware/authMiddleware");

// =====================================================
// DELIVERY AGENT MANAGEMENT
// =====================================================

// Create delivery agent
router.post(
    "/",
    authMiddleware,
    createDeliveryAgent
);

// Get all delivery agents of logged-in vendor
router.get(
    "/",
    authMiddleware,
    getDeliveryAgents
);

// Get single delivery agent
router.get(
    "/:id",
    authMiddleware,
    getDeliveryAgentById
);

// Update delivery agent
router.put(
    "/:id",
    authMiddleware,
    updateDeliveryAgent
);

// Activate delivery agent
router.patch(
    "/:id/activate",
    authMiddleware,
    activateDeliveryAgent
);

// Deactivate delivery agent
router.patch(
    "/:id/deactivate",
    authMiddleware,
    deactivateDeliveryAgent
);

// =====================================================
// CUSTOMER ASSIGNMENT
// =====================================================

// Assign customer to delivery agent
router.patch(
    "/customer/:customerId/assign",
    authMiddleware,
    assignCustomerToAgent
);

// Remove customer from delivery agent
router.patch(
    "/customer/:customerId/remove",
    authMiddleware,
    removeCustomerFromAgent
);

// =====================================================
// EXPORT ROUTER
// =====================================================

module.exports = router;