require("dotenv").config();

const app = require("./src/app");
const connectDatabase = require("./src/config/database");

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";

const startServer = async () => {
    try {
        await connectDatabase();

        app.listen(PORT, HOST, () => {
            console.log(`MilkBuddy API running on port ${PORT}`);
            console.log(`Server listening on ${HOST}:${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

startServer();