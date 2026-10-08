const Customer = require("../models/Customer");


// ============================================================
// CREATE CUSTOMER
// ============================================================

const createCustomer = async (req, res) => {
    try {
        const {
            name,
            phone,
            alternatePhone,
            address,
            ratePerLiter,
            dailyQuantity,
            shift,
            product,
            products,
            billingCycleDays,
            startDate,
        } = req.body;

        const vendorId = req.user.userId;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Customer name is required",
            });
        }

        if (!phone || !/^[0-9]{10}$/.test(phone)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid 10-digit customer phone number",
            });
        }

        const existingCustomer = await Customer.findOne({
            vendorId,
            phone,
            status: "active",
        });

        if (existingCustomer) {
            return res.status(409).json({
                success: false,
                message: "Customer with this phone number already exists",
            });
        }

        const lastCustomer = await Customer.findOne({
            vendorId,
        }).sort({
            customerNumber: -1,
        });

        const customerNumber = lastCustomer
            ? lastCustomer.customerNumber + 1
            : 1;

        const customer = await Customer.create({
            vendorId,
            customerNumber,
            name: name.trim(),
            phone,
            alternatePhone: alternatePhone || "",
            address: address || "",
            ratePerLiter: Number(ratePerLiter) || 0,
            dailyQuantity: Number(dailyQuantity) || 0,
            shift: shift || "",
            product: product || "",
            products: Array.isArray(products) ? products : [],
            billingCycleDays: Number(billingCycleDays) || 30,
            status: "active",
            startDate: startDate || new Date(),
        });

        return res.status(201).json({
            success: true,
            message: "Customer created successfully",
            customer,
        });

    } catch (error) {
        console.error("Create customer error:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong while creating customer",
        });
    }
};


// ============================================================
// GET ALL CUSTOMERS
// ============================================================

const getCustomers = async (req, res) => {
    try {
        const vendorId = req.user.userId;

        const {
            search,
            status,
        } = req.query;

        const filter = {
            vendorId,
        };

        // Active / inactive filter
        if (status) {
            if (!["active", "inactive"].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Status must be active or inactive",
                });
            }

            filter.status = status;
        }

        // Search by customer name, phone or customer number
        if (search) {
            const searchValue = search.trim();

            filter.$or = [
                {
                    name: {
                        $regex: searchValue,
                        $options: "i",
                    },
                },
                {
                    phone: {
                        $regex: searchValue,
                        $options: "i",
                    },
                },
            ];

            // If search is a number, also search customer number
            if (/^\d+$/.test(searchValue)) {
                filter.$or.push({
                    customerNumber: Number(searchValue),
                });
            }
        }

        const customers = await Customer.find(filter).sort({
            customerNumber: 1,
        });

        return res.status(200).json({
            success: true,
            message: "Customers fetched successfully",
            count: customers.length,
            customers,
        });

    } catch (error) {
        console.error("Get customers error:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong while fetching customers",
        });
    }
};


// ============================================================
// GET CUSTOMER BY ID
// ============================================================

const getCustomerById = async (req, res) => {
    try {
        const vendorId = req.user.userId;
        const customerId = req.params.id;

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

        return res.status(200).json({
            success: true,
            message: "Customer fetched successfully",
            customer,
        });

    } catch (error) {
        console.error("Get customer by ID error:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong while fetching customer",
        });
    }
};


// ============================================================
// UPDATE CUSTOMER
// ============================================================

const updateCustomer = async (req, res) => {
    try {
        const vendorId = req.user.userId;
        const customerId = req.params.id;

        const {
            name,
            phone,
            alternatePhone,
            address,
            ratePerLiter,
            dailyQuantity,
            shift,
            product,
            products,
            billingCycleDays,
            status,
            startDate,
        } = req.body;

        // Find customer belonging to logged-in vendor
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

        // Validate name if provided
        if (name !== undefined) {
            if (!name.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Customer name cannot be empty",
                });
            }

            customer.name = name.trim();
        }

        // Validate phone if provided
        if (phone !== undefined) {
            if (!/^[0-9]{10}$/.test(phone)) {
                return res.status(400).json({
                    success: false,
                    message: "Enter a valid 10-digit customer phone number",
                });
            }

            // Check whether another customer already uses this phone
            const existingCustomer = await Customer.findOne({
                vendorId,
                phone,
                _id: { $ne: customerId },
                status: "active",
            });

            if (existingCustomer) {
                return res.status(409).json({
                    success: false,
                    message: "Another customer with this phone number already exists",
                });
            }

            customer.phone = phone;
        }

        if (alternatePhone !== undefined) {
            customer.alternatePhone = alternatePhone;
        }

        if (address !== undefined) {
            customer.address = address;
        }

        if (ratePerLiter !== undefined) {
            customer.ratePerLiter = Number(ratePerLiter) || 0;
        }

        if (dailyQuantity !== undefined) {
            customer.dailyQuantity = Number(dailyQuantity) || 0;
        }

        if (shift !== undefined) {
            customer.shift = shift;
        }

        if (product !== undefined) {
            customer.product = product;
        }

        if (products !== undefined) {
            customer.products = Array.isArray(products) ? products : [];
        }

        if (billingCycleDays !== undefined) {
            customer.billingCycleDays =
                Number(billingCycleDays) || 30;
        }

        if (status !== undefined) {
            if (!["active", "inactive"].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Status must be active or inactive",
                });
            }

            customer.status = status;
        }

        if (startDate !== undefined) {
            customer.startDate = startDate;
        }

        await customer.save();

        return res.status(200).json({
            success: true,
            message: "Customer updated successfully",
            customer,
        });

    } catch (error) {
        console.error("Update customer error:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong while updating customer",
        });
    }
};


// ============================================================
// DEACTIVATE CUSTOMER
// ============================================================

const deactivateCustomer = async (req, res) => {
    try {
        const vendorId = req.user.userId;
        const customerId = req.params.id;

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

        if (customer.status === "inactive") {
            return res.status(400).json({
                success: false,
                message: "Customer is already inactive",
            });
        }

        customer.status = "inactive";

        await customer.save();

        return res.status(200).json({
            success: true,
            message: "Customer deactivated successfully",
            customer,
        });

    } catch (error) {
        console.error("Deactivate customer error:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong while deactivating customer",
        });
    }
};

const activateCustomer = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const customerId = req.params.id;

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

    if (customer.status === "active") {
      return res.status(400).json({
        success: false,
        message: "Customer is already active",
      });
    }

    customer.status = "active";

    await customer.save();

    res.json({
      success: true,
      message: "Customer activated successfully",
      customer,
    });
  } catch (error) {
    console.error("Activate customer error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to activate customer",
    });
  }
};

module.exports = {
    createCustomer,
    getCustomers,
    getCustomerById,
    updateCustomer,
    deactivateCustomer,
    activateCustomer,
};