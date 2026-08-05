// src/config/db.js
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  log: [{ emit: "event", level: "query" }],
});

prisma.$on("query", (e) => {
  console.log(`[PRISMA] ${e.duration}ms :: ${e.query}`);
});

module.exports = prisma;
