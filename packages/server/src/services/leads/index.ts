/**
 * Лиды: приём контакта, статусы, вебхук, выгрузка.
 *
 *   import { LeadService } from '../services/leads/index.js'
 *
 * Наружу сервис попадает через плагин `plugins/leads.ts` как `app.leads` —
 * маршруты и движок диалога берут его оттуда.
 */

export { buildCsv, formatCsvDate, CSV_BOM, CSV_DELIMITER } from './csv.js'
export { exportFilename, exportLeadsCsv, LEAD_STATUS_LABELS } from './export.js'
export {
  LEAD_EXPORT_LIMIT,
  LEAD_LIST_LIMIT,
  LEAD_LIST_MAX_LIMIT,
  LeadService,
  LeadValidationError,
  buildPayload,
  describeApartment,
  toLeadRow,
  toLeadView,
  type LeadCaptureInput,
  type LeadListFilters,
  type LeadRow,
  type LeadServiceOptions,
  type LeadView,
  type LeadsLogger,
} from './leads.service.js'
export { formatPhone, normalizePhone, phoneSearchFragments, PHONE_ERROR, type PhoneResult } from './phone.js'
export {
  deliverLeadWebhook,
  WEBHOOK_RETRY_DELAY_MS,
  WEBHOOK_TIMEOUT_MS,
  type FetchLike,
  type LeadWebhookPayload,
  type LeadWebhookResult,
} from './webhook.js'
