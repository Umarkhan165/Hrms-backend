const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");

const routes = require("./routes");
const { errorHandler, notFound } = require("./middleware/errorHandler");

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// Whitelisted origins
const allowedOrigins = [
  "https://hrms-frontend-tau-gold.vercel.app",
  "https://hrms-ashy-eight.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

// Append any additional comma-separated origins from environment variables
if (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== "*") {
  const envOrigins = process.env.CORS_ORIGIN.split(",").map((o) => o.trim());
  allowedOrigins.push(...envOrigins);
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server or non-browser requests (like Postman)
    if (!origin) return callback(null, true);

    if (process.env.CORS_ORIGIN === "*" || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS Policy: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Handle preflight requests

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan("dev"));

app.get("/", (req, res) => {
  res.json({ success: true, message: "HRMS API Serverless Root" });
});
app.get("/hrms", (req, res) =>
  res.json({ success: true, message: "HRMS API is running" }),
);

app.use("/api/v1", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
