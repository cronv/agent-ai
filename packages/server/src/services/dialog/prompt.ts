/**
 * Сборка системного промпта.
 *
 *   const system = buildSystemPrompt({ basePrompt, projectCount, ... })
 *
 * Постоянная часть — настройка `system_prompt`: её правит администратор
 * в админке, кодом мы её не трогаем. Сюда добавляется только то, чего
 * в настройке быть не может, потому что оно меняется от сообщения к сообщению:
 *
 *   сегодняшняя дата     — иначе «сдача в этом году» модель считает от даты
 *                          обучения и уверенно ошибается на пару лет;
 *   размер каталога      — пустая база знаний должна менять поведение, а не
 *                          порождать выдуманные условия ипотеки;
 *   ход разговора        — правило «не проси контакт раньше времени» работает
 *                          только тогда, когда модель знает, где она сейчас.
 */

export interface PromptContext {
  /** Настройка `system_prompt` — характер и правила ассистента. */
  basePrompt: string
  /** Дата, от которой модель считает сроки. */
  today: Date
  /** Сколько активных ЖК в каталоге. */
  projectCount: number
  /** Есть ли что-нибудь в базе знаний. */
  hasKnowledge: boolean
  /** Сколько сообщений написал посетитель за всю переписку. */
  visitorMessages: number
  apartmentsShown: boolean
  /** Сообщений посетителя после последней подборки. */
  messagesSinceApartments: number
  /** Настройка `contact_request_threshold`. */
  contactThreshold: number
  leadCaptured: boolean
}

export function buildSystemPrompt(context: PromptContext): string {
  const lines: string[] = [
    `Сегодня ${formatDate(context.today)}. Сроки сдачи считай от этой даты.`,
    context.projectCount > 0
      ? `В каталоге ${context.projectCount} ${plural(context.projectCount, 'активный ЖК', 'активных ЖК', 'активных ЖК')} — это всё, что ты можешь предлагать.`
      : 'Каталог квартир сейчас пуст: подобрать нечего. Скажи об этом прямо и предложи оставить контакт, чтобы менеджер связался, когда объекты появятся.',
    context.hasKnowledge
      ? 'База знаний загружена: ищи в ней всё про ипотеку, рассрочку, отделку и инфраструктуру.'
      : 'База знаний пуста. На вопросы про ипотеку, рассрочку, отделку и условия отвечай честно: «этих данных у меня нет, уточню у менеджера». Не пересказывай общерыночные знания.',
    context.visitorMessages === 0
      ? 'Это первое сообщение посетителя.'
      : `Посетитель написал ${context.visitorMessages} ${plural(context.visitorMessages, 'сообщение', 'сообщения', 'сообщений')}.`,
    contactLine(context),
  ]

  return `${context.basePrompt.trim()}\n\n# Сейчас\n\n${lines.map((line) => `- ${line}`).join('\n')}`
}

function contactLine(context: PromptContext): string {
  if (context.leadCaptured) {
    return 'Контакт уже оставлен и передан менеджеру. Больше телефон не проси — просто продолжай помогать с подбором.'
  }
  if (!context.apartmentsShown) {
    return 'Подборку ты ещё не показывал, поэтому просить имя и телефон рано — сначала принеси пользу.'
  }
  const left = Math.max(context.contactThreshold - context.messagesSinceApartments, 0)
  if (left > 0) {
    return `Подборка показана, но человек обсуждал её всего ${context.messagesSinceApartments} ${plural(context.messagesSinceApartments, 'раз', 'раза', 'раз')}. Подожди ещё ${left} ${plural(left, 'его сообщение', 'его сообщения', 'его сообщений')}, прежде чем предлагать звонок менеджера.`
  }
  return 'Подборка показана, человек её обсуждает — сейчас уместно предложить звонок менеджера и попросить имя и телефон. Один раз: если откажется, продолжай помогать.'
}

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

function formatDate(date: Date): string {
  const month = MONTHS[date.getMonth()] ?? ''
  return `${date.getDate()} ${month} ${date.getFullYear()} года`
}

/** Русские окончания: 1 квартира, 2 квартиры, 5 квартир. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}
