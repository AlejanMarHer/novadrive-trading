import { PrismaClient } from '@prisma/client';

// Una sola instancia de PrismaClient: en desarrollo, el recargado en caliente de
// Next.js crearía una conexión nueva en cada cambio y agotaría el pool de Supabase.
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalParaPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalParaPrisma.prisma = prisma;
