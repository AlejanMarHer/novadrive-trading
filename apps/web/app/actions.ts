'use server';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function obtenerUltimoRegimen() {
  try {
    // Busca el registro más reciente ordenado por fecha
    const registro = await prisma.marketRegimeRecord.findFirst({
      orderBy: { timestamp: 'desc' }
    });
    return registro;
  } catch (error) {
    console.error('❌ Error consultando Supabase:', error);
    return null;
  }
}