const formatIndiaDate = (date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
};

const getIndiaDayRange = (dateValue = new Date()) => {
    let dayKey;
    if (typeof dateValue === "string") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
            throw Object.assign(new Error("Invalid date format. Use YYYY-MM-DD"), { statusCode: 400 });
        }
        const parsedDate = new Date(`${dateValue}T00:00:00+05:30`);
        dayKey = formatIndiaDate(parsedDate);
        if (Number.isNaN(parsedDate.getTime()) || dayKey !== dateValue) {
            throw Object.assign(new Error("Invalid date format. Use YYYY-MM-DD"), { statusCode: 400 });
        }
    } else {
        dayKey = formatIndiaDate(new Date(dateValue));
    }

    const fromDate = new Date(`${dayKey}T00:00:00+05:30`);
    const toDate = new Date(fromDate.getTime() + 24 * 60 * 60 * 1000);
    return { dayKey, fromDate, toDate };
};

const taskKey = (customerId, shift, product) =>
    `${customerId.toString()}_${String(shift).trim().toLowerCase()}_${String(product).trim().toLowerCase()}`;

const buildAgentTasks = (customers, deliveries, dayStart) => {
    const deliveryMap = new Map();
    for (const delivery of deliveries) {
        deliveryMap.set(taskKey(delivery.customerId, delivery.shift, delivery.product), delivery);
    }

    let completedTasks = 0;
    let pendingTasks = 0;
    let noDeliveryCount = 0;
    let totalMilkLiters = 0;

    const tasks = customers.flatMap((customer) => {
        const configuredShift = String(customer.shift || "").trim().toLowerCase();
        const shifts = configuredShift === "both"
            ? ["Morning", "Evening"]
            : [configuredShift === "evening" ? "Evening" : "Morning"];
        const products = Array.isArray(customer.products) && customer.products.length
            ? [...new Set(customer.products.map((product) => String(product).trim()).filter(Boolean))]
            : [String(customer.product || "Milk").trim()];

        return shifts.flatMap((shift) => products.map((product) => {
            const delivery = deliveryMap.get(taskKey(customer._id, shift, product));
            const isNoDelivery = delivery?.isNoDelivery === true;
            const status = delivery ? (isNoDelivery ? "no_delivery" : "completed") : "pending";
            const quantity = delivery && !isNoDelivery ? Number(delivery.quantityLiters || 0) : 0;
            const amount = delivery && !isNoDelivery ? Number(delivery.amount || 0) : 0;

            if (!delivery) pendingTasks++;
            else if (isNoDelivery) noDeliveryCount++;
            else {
                completedTasks++;
                totalMilkLiters += quantity;
            }

            return {
                id: delivery?._id || customer._id,
                deliveryId: delivery?._id || null,
                customerId: customer._id,
                customerName: customer.name,
                customerPhone: customer.phone || "",
                customerAddress: customer.address || "",
                customerNumber: customer.customerNumber || "N/A",
                product,
                shift,
                assignedQuantity: customer.dailyQuantity || 0,
                deliveredQuantity: delivery ? quantity : customer.dailyQuantity || 0,
                rateAtTime: delivery ? delivery.rateAtTime : customer.ratePerLiter || 0,
                amount: delivery
                    ? amount
                    : Number(((customer.dailyQuantity || 0) * (customer.ratePerLiter || 0)).toFixed(2)),
                status,
                isNoDelivery,
                notes: delivery?.notes || "",
                deliveryDate: dayStart,
            };
        }));
    });

    return {
        count: tasks.length,
        tasks,
        summary: {
            totalTasks: tasks.length,
            completedTasks,
            pendingTasks,
            noDeliveryCount,
            totalMilkLiters: Number(totalMilkLiters.toFixed(2)),
        },
    };
};

module.exports = { getIndiaDayRange, buildAgentTasks };