import { PrismaClient } from "@prisma/client";

declare global {
  var telencePrisma: PrismaClient | undefined;
}

const db = global.telencePrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.telencePrisma = db;
}

export default db;
