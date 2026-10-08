// Horário de atendimento do canal, no fuso da empresa (decide a mensagem automática de "fora do horário").
import type { HorarioCanal } from "../../infra/esquema.js";

const DIAS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function dentroDoHorario(horario: HorarioCanal, fuso: string, agora = new Date()): boolean {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: fuso, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  );
  const dia = DIAS[partes.weekday ?? ""] ?? 0;
  const hora = `${partes.hour}:${partes.minute}`;
  return horario.dias.includes(dia) && hora >= horario.inicio && hora < horario.fim;
}
