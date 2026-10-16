const express = require("express");

const router = express.Router();

const {
    getAgentProfile,
    getAgentDashboard,
    getAgentCustomers,
    getAgentDeliveries,
    getAgentTasks,
} = require("../controllers/agentController");
const {
    createDelivery,
    updateDelivery,
    deleteDelivery,
} = require("../controllers/deliveryController");

const agentAuthMiddleware = require(
    "../middleware/agentAuthMiddleware"
);

// Agent profile
router.get(
    "/profile",
    agentAuthMiddleware,
    getAgentProfile
);

// Agent dashboard
router.get(
    "/dashboard",
    agentAuthMiddleware,
    getAgentDashboard
);

// Assigned customers
router.get(
    "/customers",
    agentAuthMiddleware,
    getAgentCustomers
);

// Delivery history
router.get(
    "/deliveries",
    agentAuthMiddleware,
    getAgentDeliveries
);

// Agent tasks for a date
router.get(
    "/tasks",
    agentAuthMiddleware,
    getAgentTasks
);

// Create delivery by agent
router.post(
    "/deliveries",
    agentAuthMiddleware,
    createDelivery
);

router.put(
    "/deliveries/:id",
    agentAuthMiddleware,
    updateDelivery
);

router.delete(
    "/deliveries/:id",
    agentAuthMiddleware,
    deleteDelivery
);

module.exports = router;