const Customer = require("../models/Customer");
const mongoose = require("mongoose");
const User = require("../models/User");
const DeliveryAgent = require("../models/DeliveryAgent");
const { getActiveVendor, getAssignedActiveAgent } = require("../services/vendorAuthorization");

const validateCustomerFields = (body, partial = false) => {
    const fields = {};
    const invalid = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };

    if (!partial || body.name !== undefined) {
        if (typeof body.name !== "string" || !body.name.trim()) invalid("Customer name is required");
        fields.name = body.name.trim();
    }
    if (!partial || body.phone !== undefined) {
        if (typeof body.phone !== "string" || !/^[0-9]{10}$/.test(body.phone.trim())) invalid("Enter a valid 10-digit customer phone number");
        fields.phone = body.phone.trim();
    }
    for (const [key, minimum] of [["ratePerLiter", 0], ["dailyQuantity", 0]]) {
        if (body[key] !== undefined) {
            const value = Number(body[key]);
            if (!Number.isFinite(value) || value < minimum) invalid(`${key} must be a non-negative number`);
            fields[key] = value;
        }
    }
    if (body.billingCycleDays !== undefined) {
        const days = Number(body.billingCycleDays);
        if (!Number.isInteger(days) || days < 1) invalid("billingCycleDays must be a positive integer");
        fields.billingCycleDays = days;
    }
    if (body.shift !== undefined) {
        const shift = typeof body.shift === "string" ? body.shift.trim() : "";
        if (shift && !["morning", "evening", "both"].includes(shift.toLowerCase())) invalid("shift must be Morning, Evening, or Both");
        fields.shift = shift;
    }
    if (body.product !== undefined) {
        if (typeof body.product !== "string") invalid("product must be a string");
        fields.product = body.product.trim();
    }
    if (body.products !== undefined) {
        if (!Array.isArray(body.products) || body.products.some((product) => typeof product !== "string" || !product.trim())) invalid("products must be an array of non-empty strings");
        fields.products = body.products.map((product) => product.trim());
    }
    for (const key of ["alternatePhone", "address"]) {
        if (body[key] !== undefined) {
            if (typeof body[key] !== "string") invalid(`${key} must be a string`);
            fields[key] = body[key].trim();
        }
    }
    if (fields.alternatePhone && !/^[0-9]{10}$/.test(fields.alternatePhone)) invalid("Enter a valid 10-digit alternate phone number");
    if (body.startDate !== undefined) {
        const startDate = new Date(body.startDate);
        if (Number.isNaN(startDate.getTime())) invalid("startDate must be a valid date");
        fields.startDate = startDate;
    }
    return fields;
};

const getReadActor = async (req) => {
    const userId = req.user?.userId;
    if (!mongoose.Types.ObjectId.isValid(userId || "")) return null;
    const user = await User.findById(userId);
    if (!user?.isActive) return null;
    if (user.userType === "vendor") return { type: "vendor", vendorId: user._id };
    if (user.userType === "agent") {
        const agent = await DeliveryAgent.findOne({ userId: user._id, status: "active" });
        if (agent) return { type: "agent", vendorId: agent.vendorId, agentId: agent._id };
    }
    return null;
};


// ============================================================
// CREATE CUSTOMER
// ============================================================

const createCustomer = async (req, res) => {
    try {
        const vendor = await getActiveVendor(req.user?.userId);
        if (!vendor) return res.status(403).json({ success: false, message: "Active vendor account required" });
        const vendorId = vendor._id;
        const body = req.body || {};
        const fields = validateCustomerFields(body);
        const { deliveryAgentId } = body;
        let assignedAgentId = null;
        if (deliveryAgentId !== undefined && deliveryAgentId !== null && deliveryAgentId !== "") {
            const agent = await getAssignedActiveAgent(vendorId, deliveryAgentId);
            assignedAgentId = agent._id;
        }

        const existingCustomer = await Customer.findOne({
            vendorId,
            phone: fields.phone,
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
            ...fields,
            ratePerLiter: fields.ratePerLiter ?? 0,
            dailyQuantity: fields.dailyQuantity ?? 0,
            billingCycleDays: fields.billingCycleDays ?? 30,
            deliveryAgentId: assignedAgentId,
            status: "active",
            startDate: fields.startDate || new Date(),
        });

        return res.status(201).json({
            success: true,
            message: "Customer created successfully",
            customer,
        });

    } catch (error) {
        console.error("Create customer error:", error);

        if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
        if (error.code === 11000) return res.status(409).json({ success: false, message: "Customer with this number or phone already exists" });

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
        const actor = await getReadActor(req);
        if (!actor) return res.status(403).json({ success: false, message: "Authorized vendor or active delivery agent required" });
        const vendorId = actor.vendorId;

        const {
            search,
            status,
        } = req.query;

        const filter = {
            vendorId,
        };

        if (actor.type === "agent") {
            filter.deliveryAgentId = actor.agentId;
            filter.status = "active";
        }

        // Active / inactive filter
        if (status) {
            if (!["active", "inactive"].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Status must be active or inactive",
                });
            }

            if (actor.type === "vendor") filter.status = status;
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

        const customers = await Customer.find(filter)
            .populate("deliveryAgentId", "name mobileNumber")
            .sort({
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
        const actor = await getReadActor(req);
        if (!actor) return res.status(403).json({ success: false, message: "Authorized vendor or active delivery agent required" });
        const customerId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(customerId || "")) {
            return res.status(400).json({ success: false, message: "Invalid customerId" });
        }

        const filter = {
            _id: customerId,
            vendorId: actor.vendorId,
        };
        if (actor.type === "agent") {
            filter.deliveryAgentId = actor.agentId;
            filter.status = "active";
        }
        const customer = await Customer.findOne(filter).populate("deliveryAgentId", "name mobileNumber");

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
        const vendor = await getActiveVendor(req.user?.userId);
        if (!vendor) return res.status(403).json({ success: false, message: "Active vendor account required" });
        const vendorId = vendor._id;
        const customerId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(customerId || "")) return res.status(400).json({ success: false, message: "Invalid customerId" });
        const body = req.body || {};
        const fields = validateCustomerFields(body, true);
        const { deliveryAgentId, status } = body;
        if (status !== undefined && !["active", "inactive"].includes(status)) return res.status(400).json({ success: false, message: "Status must be active or inactive" });
        let assignedAgentId;
        if (deliveryAgentId !== undefined) {
            assignedAgentId = deliveryAgentId === null || deliveryAgentId === ""
                ? null
                : (await getAssignedActiveAgent(vendorId, deliveryAgentId))._id;
        }

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

        // Validate phone if provided
        if (fields.phone !== undefined) {
            // Check whether another customer already uses this phone
            const existingCustomer = await Customer.findOne({
                vendorId,
                phone: fields.phone,
                _id: { $ne: customerId },
                status: "active",
            });

            if (existingCustomer) {
                return res.status(409).json({
                    success: false,
                    message: "Another customer with this phone number already exists",
                });
            }

        }
        Object.assign(customer, fields);
        if (deliveryAgentId !== undefined) customer.deliveryAgentId = assignedAgentId;
        if (status !== undefined) customer.status = status;

        await customer.save();

        return res.status(200).json({
            success: true,
            message: "Customer updated successfully",
            customer,
        });

    } catch (error) {
        console.error("Update customer error:", error);

        if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
        if (error.code === 11000) return res.status(409).json({ success: false, message: "Another customer with this phone number already exists" });

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
    validateCustomerFields,
};