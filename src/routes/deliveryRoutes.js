const express = require("express");

const router = express.Router();

const {
  createDelivery,
  getDeliveries,
  addExtraMilk,
  updateDelivery,
  deleteDelivery,
} = require("../controllers/deliveryController");

const authMiddleware = require("../middleware/authMiddleware");

router.post(
  "/",
  authMiddleware,
  createDelivery
);

router.get(
  "/",
  authMiddleware,
  getDeliveries
);
router.patch(
  "/:id/extra-milk",
  authMiddleware,
  addExtraMilk
);
router.put(
  "/:id",
  authMiddleware,
  updateDelivery
);
router.delete(
  "/:id",
  authMiddleware,
  deleteDelivery
);

module.exports = router;