import type { CatalogLocation } from './apartments.js'
import { millions, plural, roomsLabel } from './wording.js'

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
 *   локации каталога     — без списка модель достаёт географию из общих знаний
 *                          и зовёт клиента в Мытищи, которых у агентства нет;
 *   ход разговора        — правило «не проси контакт раньше времени» работает
 *                          только тогда, когда модель знает, где она сейчас.
 *
 * Перечень локаций — именно перечень, а не намёк: запрет «не выдумывай города»
 * без него нечем исполнить, модели просто не с чем сверяться. Поэтому у каждой
 * локации сразу стоит и то, что в ней есть, — комнатности и вилка цен: тогда
 * альтернатива предлагается по факту, а не наугад.
 */

export interface PromptContext {
  /** Настройка `system_prompt` — характер и правила ассистента. */
  basePrompt: string
  /** Дата, от которой модель считает сроки. */
  today: Date
  /** Сколько активных ЖК в каталоге. */
  projectCount: number
  /** Весь географический охват каталога — см. `listCatalogLocations`. */
  locations: CatalogLocation[]
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
      : 'База знаний пуста: search_knowledge вернёт пустоту по любому запросу. Значит по ипотеке, рассрочке, субсидиям, акциям и отделке у тебя нет ни одной цифры — ни по ЖК, ни «по рынку в целом». Ставки, взносы, лимиты, сроки программ, названия банков и расчёт платежа не называй даже примерно и даже если человек просит приблизительно. Объясни, почему не называешь, скажи что уточнит менеджер, и предложи оставить контакт.',
    context.visitorMessages === 0
      ? 'Это первое сообщение посетителя.'
      : `Посетитель написал ${context.visitorMessages} ${plural(context.visitorMessages, 'сообщение', 'сообщения', 'сообщений')}.`,
    contactLine(context),
  ]

  const now = `# Сейчас\n\n${lines.map((line) => `- ${line}`).join('\n')}`
  const places = locationsBlock(context.locations)

  return [context.basePrompt.trim(), now, places].filter((part) => part !== '').join('\n\n')
}

/**
 * Сколько локаций расписывать подробно, а сколько — назвать по имени.
 *
 * Пять локаций на боевых данных, но каталог растёт: сотня районов, расписанных
 * построчно, съест контекст и утопит в себе всё остальное. Подробно идут самые
 * крупные, остальные — просто именами, и этого уже достаточно, чтобы не
 * выдумывать: сверять название есть с чем.
 */
const LOCATIONS_IN_DETAIL = 12
const LOCATIONS_NAMED = 60

function locationsBlock(locations: CatalogLocation[]): string {
  if (locations.length === 0) return ''

  const detailed = locations.slice(0, LOCATIONS_IN_DETAIL)
  const rest = locations.slice(LOCATIONS_IN_DETAIL)

  const lines = detailed.map(
    (place) =>
      `- ${place.name} — ${place.apartmentCount} ${plural(place.apartmentCount, 'квартира', 'квартиры', 'квартир')}: ` +
      place.rooms
        .map((item) => `${roomsLabel(item.rooms)} ${item.count} шт. от ${millions(item.priceMin)}`)
        .join('; '),
  )

  if (rest.length > 0 && rest.length <= LOCATIONS_NAMED) {
    lines.push(`- и ещё: ${rest.map((place) => place.name).join(', ')}`)
  } else if (rest.length > LOCATIONS_NAMED) {
    const named = rest.slice(0, LOCATIONS_NAMED).map((place) => place.name).join(', ')
    lines.push(
      `- и ещё ${rest.length} ${plural(rest.length, 'локация', 'локации', 'локаций')}: ${named} и другие — ` +
        'полный список смотри через list_projects, наизусть не додумывай.',
    )
  }

  const floor = Math.min(...locations.map((place) => place.priceMin))

  return [
    '# Локации каталога',
    '',
    'Это весь географический охват агентства, собранный из базы прямо сейчас. Другой локации у нас нет:',
    '',
    lines.join('\n'),
    '',
    'Города и районы, которых нет в этом перечне, не называй, не предлагай и не упоминай как «варианты рядом».',
    'Здесь только места — города и районы, а не названия ЖК. Про конкретный жилой комплекс этот перечень ' +
      'не говорит ничего: спросили про ЖК — проверь через list_projects, а не по этим строкам.',
    'Цены здесь — «от», по каждой комнатности отдельно. Сравнивая локации, сверяйся именно с ними и по той же ' +
      'комнатности: там, где дешевле студии, однокомнатные могут быть дороже. Не пиши «там дешевле», не сравнив числа.',
    `Самая дешёвая квартира во всём каталоге стоит ${millions(floor)}: дешевле нет ничего и нигде, ` +
      'не обещай поискать в другой локации то, что дешевле этой цены.',
    'Перечень отвечает на вопрос «где мы работаем и что там вообще есть». Поиск он не заменяет никогда: ' +
      'на запрос про квартиры всё равно вызови search_apartments — даже когда по перечню уже видно, что ' +
      'под условия ничего не подходит. Человек должен увидеть карточки ближайшей альтернативы, а не только текст.',
  ].join('\n')
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
