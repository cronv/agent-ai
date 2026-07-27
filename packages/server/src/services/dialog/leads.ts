import type { Db } from '../../db/prisma.js'

/**
 * Контакт, оставленный в диалоге.
 *
 * ── Точка расширения ───────────────────────────────────────────────────────
 *
 * Движок диалога никогда не пишет лид сам: он вызывает `LeadHandler`, который
 * получен в опциях. По умолчанию подставляется `saveLeadToDatabase` — она
 * умеет ровно то, что нужно движку: проверить данные и создать строку.
 *
 * Всё остальное — нормализация телефона к +7XXXXXXXXXX, поиск дубля по
 * телефону, статусы и вызов вебхука — это тикет 07. Он заменяет обработчик:
 *
 *   new DialogEngine({ db, settings, saveLead: leadService.captureFromDialog })
 *
 * Ни движок, ни определение инструмента при этом не меняются.
 */

export interface LeadInput {
  name: string
  phone: string
  comment?: string | null
}

export interface SavedLead {
  id: string
  name: string
  phone: string
  comment: string | null
}

export interface LeadContext {
  db: Db
  conversationId: string
}

export type LeadHandler = (input: LeadInput, context: LeadContext) => Promise<SavedLead>

export type LeadValidation = { ok: true; value: LeadInput } | { ok: false; error: string }

/** Минимум цифр в телефоне: 10 — это номер без кода страны. */
const MIN_PHONE_DIGITS = 10
const MAX_PHONE_DIGITS = 15
const MAX_NAME_LENGTH = 100
const MAX_COMMENT_LENGTH = 1000

/**
 * Проверка того, что прислала модель.
 *
 * Текст ошибки уходит модели как результат инструмента — поэтому он написан
 * как указание, что сделать дальше, а не как код ошибки.
 */
export function validateLead(raw: { name?: unknown; phone?: unknown; comment?: unknown }): LeadValidation {
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME_LENGTH) : ''
  const phone = typeof raw.phone === 'string' ? raw.phone.trim() : ''
  const commentRaw = typeof raw.comment === 'string' ? raw.comment.trim().slice(0, MAX_COMMENT_LENGTH) : ''

  if (name.length < 2) {
    return { ok: false, error: 'Имя не заполнено. Спроси, как обращаться, и вызови инструмент ещё раз.' }
  }

  const digits = phone.replace(/\D/g, '')
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return {
      ok: false,
      error: 'Телефон не похож на номер. Попроси человека продиктовать номер целиком и вызови инструмент ещё раз.',
    }
  }

  const value: LeadInput = { name, phone }
  if (commentRaw !== '') value.comment = commentRaw
  return { ok: true, value }
}

/**
 * Базовое сохранение лида: строка в таблице и согласие текущим временем.
 * Согласие проставляется здесь потому, что инструмент вызывается только после
 * явного «да» в диалоге — момент этого «да» и есть момент вызова.
 */
export const saveLeadToDatabase: LeadHandler = async (input, context) => {
  const lead = await context.db.lead.create({
    data: {
      conversationId: context.conversationId,
      name: input.name,
      phone: input.phone,
      comment: input.comment ?? null,
      consentAt: new Date(),
    },
  })
  return { id: lead.id, name: lead.name, phone: lead.phone, comment: lead.comment }
}
