import type { LeadStatus } from '@prisma/client'

import { buildCsv, formatCsvDate } from './csv.js'
import { describeApartment, type LeadRow } from './leads.service.js'
import { formatPhone } from './phone.js'

/**
 * Выгрузка лидов в CSV для отдела продаж.
 *
 *   reply.header('content-type', 'text/csv; charset=utf-8').send(exportLeadsCsv(rows))
 *
 * Колонки — то, с чем работает менеджер: кому звонить, когда оставили, что
 * человек смотрел, откуда пришёл. Служебных идентификаторов в файле нет, кроме
 * ссылки на переписку: остальное в Excel всё равно никто не читает.
 */

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  reached: 'Дозвонился',
  rejected: 'Отказ',
}

const WEBHOOK_LABELS: Record<LeadRow['webhookStatus'], string> = {
  skipped: '',
  sent: 'Отправлен',
  failed: 'Ошибка',
}

const HEADERS = [
  'Дата',
  'Имя',
  'Телефон',
  'Статус',
  'Комментарий',
  // Выбранное стоит раньше просмотренного намеренно: в Excel читают левые
  // колонки, а звонить менеджер будет про выбранную квартиру.
  'Выбрал квартиры',
  'Смотрел квартиры',
  'Страница',
  'Источник',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'Вебхук',
]

export function exportLeadsCsv(leads: LeadRow[]): string {
  const rows = leads.map((lead) => {
    const utm = lead.conversation?.utm ?? {}
    return [
      formatCsvDate(lead.createdAt),
      lead.name,
      // Со скобками и пробелами Excel не пытается счесть номер числом.
      formatPhone(lead.phone),
      LEAD_STATUS_LABELS[lead.status],
      lead.comment ?? '',
      lead.selectedApartments.map(describeApartment).join('\n'),
      lead.apartments.map(describeApartment).join('\n'),
      lead.conversation?.page ?? '',
      lead.conversation?.referrer ?? '',
      utm['utm_source'] ?? '',
      utm['utm_medium'] ?? '',
      utm['utm_campaign'] ?? '',
      lead.webhookStatus === 'failed'
        ? `${WEBHOOK_LABELS.failed}: ${lead.webhookError ?? ''}`.trim()
        : WEBHOOK_LABELS[lead.webhookStatus],
    ]
  })

  return buildCsv(HEADERS, rows)
}

/** Имя файла с датой выгрузки: `leads-2026-07-27.csv`. */
export function exportFilename(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `leads-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`
}
