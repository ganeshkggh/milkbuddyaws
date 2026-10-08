const Delivery = require("../models/Delivery");
const Customer = require("../models/Customer");


// ============================================================
// CREATE DELIVERY
// ============================================================

const createDelivery = async (req, res) => {
    try {
        const vendorId = req.user.userId;

        const {
            customerId,
            deliveryDate,
            quantityLiters,
            shift,
            product,
            notes,
            isNoDelivery,
        } = req.body;


        // ----------------------------------------------------
        // Validate customer ID
        // ----------------------------------------------------

        if (!customerId) {
            return res.status(400).json({
                success: false,
                message: "Customer ID is required",
            });
        }


        // ----------------------------------------------------
        // Find customer belonging to logged-in vendor
        // ----------------------------------------------------

        const customer = await Customer.findOne({
            _id: customerId,
            vendorId,
        });

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: "Customer not found",
            });
        }


        // ----------------------------------------------------
        // Customer must be active
        // ----------------------------------------------------

        if (customer.status !== "active") {
            return res.status(400).json({
                success: false,
                message: "Cannot create delivery for an inactive customer",
            });
        }


        // ----------------------------------------------------
        // Validate delivery date
        // ----------------------------------------------------

        if (!deliveryDate) {
            return res.status(400).json({
                success: false,
                message: "Delivery date is required",
            });
        }


        const parsedDeliveryDate = new Date(deliveryDate);

        if (Number.isNaN(parsedDeliveryDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: "Invalid delivery date",
            });
        }


        // ----------------------------------------------------
        // Validate shift
        // ----------------------------------------------------

        if (!shift || !shift.trim()) {
            return res.status(400).json({
                success: false,
                message: "Shift is required",
            });
        }


        // ----------------------------------------------------
        // Validate product
        // ----------------------------------------------------

        if (!product || !product.trim()) {
            return res.status(400).json({
                success: false,
                message: "Product is required",
            });
        }


        // ----------------------------------------------------
        // No delivery
        // ----------------------------------------------------

        const noDelivery = Boolean(isNoDelivery);


        // ----------------------------------------------------
        // Quantity validation
        // ----------------------------------------------------

        let finalQuantity = Number(quantityLiters);

        if (noDelivery) {
            finalQuantity = 0;
        } else {

            if (
                quantityLiters === undefined ||
                quantityLiters === null ||
                quantityLiters === ""
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Quantity is required",
                });
            }

            if (Number.isNaN(finalQuantity) || finalQuantity <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Quantity must be greater than 0",
                });
            }
        }


        // ----------------------------------------------------
        // Use customer's current rate
        // ----------------------------------------------------

        const rateAtTime = Number(customer.ratePerLiter) || 0;


        // ----------------------------------------------------
        // Calculate amount
        // ----------------------------------------------------

        const amount = noDelivery
            ? 0
            : Number((finalQuantity * rateAtTime).toFixed(2));


        // ----------------------------------------------------
        // Check duplicate delivery
        // ----------------------------------------------------

        const startOfDay = new Date(parsedDeliveryDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(parsedDeliveryDate);
        endOfDay.setHours(23, 59, 59, 999);


        const existingDelivery = await Delivery.findOne({
            vendorId,
            customerId,
            deliveryDate: {
                $gte: startOfDay,
                $lte: endOfDay,
            },
            shift,
            product,
        });


        if (existingDelivery) {
            return res.status(409).json({
                success: false,
                message: "Delivery already exists for this customer, date, shift and product",
            });
        }


        // ----------------------------------------------------
        // Create delivery
        // ----------------------------------------------------

        const delivery = await Delivery.create({
            vendorId,
            customerId,
            deliveryDate: parsedDeliveryDate,
            quantityLiters: finalQuantity,
            rateAtTime,
            amount,
            shift: shift.trim(),
            product: product.trim(),
            notes: notes || "",
            isNoDelivery: noDelivery,
            synced: true,
        });


        // ----------------------------------------------------
        // Return response
        // ----------------------------------------------------

        return res.status(201).json({
            success: true,
            message: "Delivery created successfully",
            delivery,
        });

    } catch (error) {

        console.error("Create delivery error:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong while creating delivery",
        });
    }
};

const getDeliveries = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    const {
      date,
      shift,
      customerId,
    } = req.query;

    const filter = {
      vendorId,
    };

    // Filter by date
    if (date) {
      const selectedDate = new Date(`${date}T00:00:00`);

      if (isNaN(selectedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date. Use YYYY-MM-DD",
        });
      }

      const nextDate = new Date(selectedDate);
      nextDate.setDate(nextDate.getDate() + 1);

      filter.deliveryDate = {
        $gte: selectedDate,
        $lt: nextDate,
      };
    }

    // Filter by shift
    if (shift) {
      const normalizedShift = shift.toLowerCase();

      if (!["morning", "evening"].includes(normalizedShift)) {
        return res.status(400).json({
          success: false,
          message: "Invalid shift. Use morning or evening",
        });
      }

      filter.shift =
        normalizedShift === "morning"
          ? "Morning"
          : "Evening";
    }

    // Filter by customer
    if (customerId) {
      filter.customerId = customerId;
    }

    const deliveries = await Delivery.find(filter)
      .populate(
        "customerId",
        "customerNumber name phone ratePerLiter"
      )
      .sort({
        deliveryDate: -1,
        createdAt: -1,
      });

    return res.json({
      success: true,
      count: deliveries.length,
      deliveries,
    });
  } catch (error) {
    console.error(
      "Get deliveries error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch deliveries",
    });
  }
};

const updateDelivery = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { id } = req.params;

    const {
      deliveryDate,
      quantityLiters,
      shift,
      product,
      notes,
      isNoDelivery,
    } = req.body;

    const delivery = await Delivery.findOne({
      _id: id,
      vendorId,
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // Check duplicate delivery when date/shift/product changes
const newDeliveryDate = deliveryDate
  ? new Date(`${deliveryDate}T00:00:00`)
  : delivery.deliveryDate;

const newShift = shift || delivery.shift;
const newProduct = product || delivery.product;

const duplicateDelivery = await Delivery.findOne({
  _id: { $ne: id },
  vendorId,
  customerId: delivery.customerId,
  deliveryDate: newDeliveryDate,
  shift: newShift,
  product: newProduct,
});

if (duplicateDelivery) {
  return res.status(409).json({
    success: false,
    message:
      "A delivery already exists for this customer, date, shift and product",
  });
}

    // Validate shift
    if (
      shift &&
      !["Morning", "Evening"].includes(shift)
    ) {
      return res.status(400).json({
        success: false,
        message: "Shift must be Morning or Evening",
      });
    }

    // No Delivery
    if (isNoDelivery === true) {
      delivery.quantityLiters = 0;
      delivery.amount = 0;
      delivery.isNoDelivery = true;
    } else {
      delivery.isNoDelivery = false;

      if (quantityLiters !== undefined) {
        if (Number(quantityLiters) < 0) {
          return res.status(400).json({
            success: false,
            message: "Quantity cannot be negative",
          });
        }

        delivery.quantityLiters =
          Number(quantityLiters);
      }

      delivery.amount =
        delivery.quantityLiters *
        delivery.rateAtTime;
    }

    if (deliveryDate !== undefined) {
      const parsedDate = new Date(
        `${deliveryDate}T00:00:00`
      );

      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid delivery date",
        });
      }

      delivery.deliveryDate = parsedDate;
    }

    if (shift !== undefined) {
      delivery.shift = shift;
    }

    if (product !== undefined) {
      delivery.product = product;
    }

    if (notes !== undefined) {
      delivery.notes = notes;
    }

    await delivery.save();

    return res.json({
      success: true,
      message: "Delivery updated successfully",
      delivery,
    });
  } catch (error) {
    console.error(
      "Update delivery error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to update delivery",
    });
  }
};

const deleteDelivery = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { id } = req.params;

    const delivery = await Delivery.findOne({
      _id: id,
      vendorId,
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    await Delivery.deleteOne({
      _id: id,
      vendorId,
    });

    return res.json({
      success: true,
      message: "Delivery deleted successfully",
    });
  } catch (error) {
    console.error(
      "Delete delivery error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to delete delivery",
    });
  }
};

module.exports = {
    createDelivery,
    getDeliveries,
    updateDelivery,
    deleteDelivery,
};