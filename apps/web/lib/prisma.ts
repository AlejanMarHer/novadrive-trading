import { PrismaClient } from '@prisma/client';

/**
 * Singleton de PrismaClient. En desarrollo, el hot-reload de Next.js re-ejecuta los módulos
 * y crearía una conexión nueva en cada recarga hasta agotar el pool de Supabase.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
