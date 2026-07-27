/**
 * Список настроек приложения.
 *
 * Это единственное место, где заводятся новые настройки. Добавили ключ сюда —
 * он сразу типизирован в `SettingsService`, засеивается при старте, появляется
 * в списке для админки и проверяется на тип при записи.
 */

export type SettingType = 'string' | 'text' | 'number' | 'boolean' | 'string[]'

export interface SettingDefinition<T> {
  /** Как значение хранится и проверяется. `text` — та же строка, но в админке многострочное поле. */
  type: SettingType
  /** Значение, которое действует, пока настройку не поменяли. */
  default: T
  /** Подпись поля в админке. */
  label: string
  /** Пояснение под полем в админке. */
  description?: string
  /** Раздел админки, в который попадает поле. */
  group: 'assistant' | 'widget' | 'integrations' | 'feeds'
  /** Секрет: маскируется в админке и никогда не уходит в публичный конфиг виджета. */
  secret?: boolean
  /** Отдаётся виджету через GET /api/widget/config без авторизации. */
  public?: boolean
  /** Имя переменной окружения, которая используется, если значение в базе пустое. */
  envFallback?: string
}

function define<T>(definition: SettingDefinition<T>): SettingDefinition<T> {
  return definition
}

const DEFAULT_SYSTEM_PROMPT = `Ты — консультант агентства новостроек. Помогаешь подобрать квартиру и отвечаешь на вопросы по жилым комплексам.

Правила:
1. Все факты — цены, площади, этажи, сроки сдачи, отделку, условия ипотеки — бери только из результатов инструментов. Никогда не придумывай и не округляй «по памяти».
2. Если данных нет — так и скажи и предложи уточнить у менеджера. Лучше честное «не знаю», чем правдоподобная выдумка.
3. Уточняй запрос короткими вопросами: бюджет, количество комнат, район, срок сдачи. Не задавай больше одного вопроса за раз.
4. Показывай 3–5 подходящих вариантов, не больше. Коротко объясняй, почему предложил именно их.
5. Не проси контакт, пока человек не увидел подборку и не задал хотя бы один уточняющий вопрос. Просьба должна звучать как польза для него, а не как условие.
6. Сохраняй контакт только после явного согласия человека.
7. Пиши по-русски, коротко, без канцелярита и без списка достоинств «уникальная локация премиум-класса».`

export const SETTING_DEFINITIONS = {
  // ── Ассистент ──────────────────────────────────────────────
  system_prompt: define<string>({
    type: 'text',
    default: DEFAULT_SYSTEM_PROMPT,
    label: 'Характер ассистента',
    description: 'Инструкция, по которой ассистент ведёт диалог: тон, правила, что нельзя выдумывать.',
    group: 'assistant',
  }),
  contact_request_threshold: define<number>({
    type: 'number',
    default: 2,
    label: 'Когда просить контакт',
    description:
      'Сколько сообщений посетителя должно пройти после показа подборки, прежде чем ассистент попросит имя и телефон.',
    group: 'assistant',
  }),
  model_default: define<string>({
    type: 'string',
    default: 'claude-haiku-4-5-20251001',
    label: 'Основная модель',
    description: 'Модель для обычных сообщений — быстрая и недорогая.',
    group: 'assistant',
  }),
  model_escalation: define<string>({
    type: 'string',
    default: 'claude-sonnet-5',
    label: 'Модель для сложных запросов',
    description: 'Подключается на сравнение ЖК, многокритериальный подбор и вопросы к базе знаний.',
    group: 'assistant',
  }),
  max_tool_calls: define<number>({
    type: 'number',
    default: 5,
    label: 'Лимит обращений к базе за ответ',
    description: 'Сколько раз ассистент может обратиться к данным, отвечая на одно сообщение.',
    group: 'assistant',
  }),

  // ── Виджет ─────────────────────────────────────────────────
  widget_title: define<string>({
    type: 'string',
    default: 'Подбор новостройки',
    label: 'Название виджета',
    description: 'Заголовок в шапке чата на сайте.',
    group: 'widget',
    public: true,
  }),
  widget_accent_color: define<string>({
    type: 'string',
    default: '#2F6BFF',
    label: 'Акцентный цвет',
    description: 'Цвет кнопки и активных элементов чата. Формат #RRGGBB.',
    group: 'widget',
    public: true,
  }),
  widget_greeting: define<string>({
    type: 'text',
    default: 'Здравствуйте! Помогу подобрать квартиру в новостройке. Расскажите, что ищете — своими словами.',
    label: 'Приветствие',
    description: 'Первое сообщение, которое видит посетитель, открыв чат.',
    group: 'widget',
    public: true,
  }),
  widget_example_questions: define<string[]>({
    type: 'string[]',
    default: [
      'Двушка до 18 млн рядом с метро',
      'Что сдаётся в 2026 году?',
      'Есть ли рассрочка без процентов?',
      'Сравните два ЖК по срокам сдачи',
    ],
    label: 'Примеры вопросов',
    description: 'Подсказки под приветствием — помогают понять, о чём можно спросить.',
    group: 'widget',
    public: true,
  }),
  widget_enabled: define<boolean>({
    type: 'boolean',
    default: true,
    label: 'Виджет включён',
    description: 'Выключите, чтобы временно убрать чат с сайта, не трогая код страницы.',
    group: 'widget',
    public: true,
  }),
  privacy_policy_url: define<string>({
    type: 'string',
    default: '',
    label: 'Ссылка на политику обработки персональных данных',
    description: 'Показывается в чекбоксе согласия рядом с формой контакта.',
    group: 'widget',
    public: true,
  }),

  // ── Интеграции ─────────────────────────────────────────────
  anthropic_api_key: define<string>({
    type: 'string',
    default: '',
    label: 'Ключ доступа к Claude',
    description: 'Без ключа чат не работает, всё остальное — работает. Хранится в базе, в интерфейсе показан замаскированным.',
    group: 'integrations',
    secret: true,
    envFallback: 'ANTHROPIC_API_KEY',
  }),
  lead_webhook_url: define<string>({
    type: 'string',
    default: '',
    label: 'Адрес вебхука для лидов',
    description: 'Каждый новый контакт отправляется на этот адрес — так подключается amoCRM или уведомления в Telegram.',
    group: 'integrations',
    secret: true,
  }),

  // ── Фиды ───────────────────────────────────────────────────
  feed_sync_cron: define<string>({
    type: 'string',
    default: '0 */3 * * *',
    label: 'Расписание обновления фидов',
    description: 'В формате cron. По умолчанию — каждые 3 часа.',
    group: 'feeds',
  }),
  feed_sync_enabled: define<boolean>({
    type: 'boolean',
    default: true,
    label: 'Обновлять фиды по расписанию',
    group: 'feeds',
  }),
} as const

export type SettingKey = keyof typeof SETTING_DEFINITIONS

/** Тип значения для каждой настройки — выводится из её определения. */
export type SettingValues = {
  [K in SettingKey]: (typeof SETTING_DEFINITIONS)[K] extends SettingDefinition<infer T> ? T : never
}

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[]

/**
 * Настройки, которые виджет получает без авторизации.
 * Список продублирован явно, чтобы тип `PublicSettingKey` был точным;
 * тест `settings.service.test.ts` следит, что он совпадает с флагами `public`.
 */
export const PUBLIC_SETTING_KEYS = [
  'widget_title',
  'widget_accent_color',
  'widget_greeting',
  'widget_example_questions',
  'widget_enabled',
  'privacy_policy_url',
] as const satisfies readonly SettingKey[]

export type PublicSettingKey = (typeof PUBLIC_SETTING_KEYS)[number]

export type PublicSettings = Pick<SettingValues, PublicSettingKey>

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFINITIONS, key)
}

export function getSettingDefinition<K extends SettingKey>(key: K): SettingDefinition<SettingValues[K]> {
  return SETTING_DEFINITIONS[key] as SettingDefinition<SettingValues[K]>
}
