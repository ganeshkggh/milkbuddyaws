const express = require("express");

const router = express.Router();

const {
    getAgentProfile,
    getAgentDashboard,
    getAgentCustomers,
    getAgentDeliveries,
} = require("../controllers/agentController");

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

module.exports = router;