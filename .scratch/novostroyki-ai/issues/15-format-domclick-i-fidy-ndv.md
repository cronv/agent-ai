# 15 — Формат ДомКлик и подключение боевых фидов NDV.RU

**What to build:** Агентство добавляет ссылку на выгрузку своего ЖК — и все квартиры этого комплекса появляются в базе вместе с планировками, корпусами, сроками сдачи и отделкой. Ассистент начинает предлагать реальные квартиры NDV.RU, а не демо-данные.

**Blocked by:** 02, 03 (готовы)

**Status:** ready-for-agent

## Контекст

Заказчик — **NDV.RU, Супермаркет недвижимости**. Прислал 7 боевых выгрузок, по одной на ЖК, в формате ДомКлик от агрегатора novostroy-m. Наш парсер знает только Яндекс.Недвижимость и ЦИАН.

Ручным маппингом (`format: custom`) не обойтись: структура вложенная, а название ЖК, этажность, срок сдачи и тип дома лежат на уровнях ВЫШЕ квартиры. Текущий `resolvePath` тянет поля только внутри самого лота. Нужен отдельный профиль формата.

### Реальная структура (проверена на всех 7 фидах)

```
complexes
└── complex                      ← один ЖК на файл
    ├── id, name, address, latitude, longitude
    ├── images/image × N         ← фото ЖК
    ├── description_main
    ├── infrastructure
    ├── developer                ← застройщик
    ├── sales_info
    └── buildings
        └── building × N         ← корпус
            ├── id, name, floors, building_state, built_year,
            │   ready_quarter, building_type, fz_214
            └── flats
                └── flat × N     ← ЛОТ
                    ├── flat_id, apartment, floor, room, area
                    ├── kitchen_area, living_area, price
                    ├── plan          ← ссылка на планировку, есть у 100% лотов
                    ├── renovation, balcony, window_view, bathroom
                    ├── euro_plan, housing_type, ready_housing
                    └── description
```

### Как поля ложатся на нашу схему

| Наше поле | Откуда |
|---|---|
| `externalId` | `flat/flat_id` |
| `rooms` | `flat/room` — **0 означает студию**, это уже наш формат |
| `area`, `kitchenArea`, `livingArea` | `flat/area`, `kitchen_area`, `living_area` |
| `floor` | `flat/floor` |
| `floorsTotal` | `building/floors` — с уровня корпуса |
| `price` | `flat/price` |
| `planImageUrl` | `flat/plan` |
| `building` | `building/name` |
| `finishing` | `flat/renovation` |
| `deadline` | `building/built_year` + `building/ready_quarter` — есть готовый `quarterEndDate` в `normalize.ts` |
| ЖК: `name` | `complex/name` |
| ЖК: `address` | `complex/address` |
| ЖК: `developer` | `complex/developer` |
| ЖК: `imageUrl` | первый `complex/images/image` |
| ЖК: `description` | `complex/description_main` |

### Проверенный объём

| ЖК | Корпусов | Квартир |
|---|---|---|
| Космос (Домодедово) | 7 | 383 |
| Серебро | 2 | 220 |
| Берег | 2 | 158 |
| Красная горка (Подольск) | 1 | 94 |
| Школьный («Альянс») | 2 | 82 |
| Восточный (Звенигород) | 1 | 35 |
| Мишино-2 | 2 | 25 |
| **Итого** | **17** | **997** |

Планировка есть у 100% лотов. Комнатность 0–3, где 0 — студия.

### Ссылки на фиды

- Красная горка — `https://exchange.novostroy-m.ru/exchange/export/ndv_krasnaya_gorka_domclick?access_token=d7fa79de73d082be`
- Школьный — `https://exchange.novostroy-m.ru/exchange/export/ndv_shkolny_domclick?access_token=dd324ee8bccfc431`
- Восточный — `https://exchange.novostroy-m.ru/exchange/export/ndv_vostochniy_domclick?access_token=3650c1622bbecfb2`
- Космос — `https://exchange.novostroy-m.ru/exchange/export/ndv_domclick_kosmos?access_token=874d1e0fa7d1c4a5`
- Мишино-2 — `https://exchange.novostroy-m.ru/exchange/export/ndv_domclick_mishino2?access_token=b2bbde6ee2f028a8`
- Берег — `https://exchange.novostroy-m.ru/exchange/export/ndv_bereg?access_token=209573617e3e45e4`
- Серебро — `https://exchange.novostroy-m.ru/exchange/export/ndv_serebro_domclick?access_token=a8248265b2314d02`

Токены доступа — часть ссылки. В репозиторий их не коммитить: фикстуры делать из скачанных файлов, реальные ссылки заводить только в базу через админку.

## Acceptance criteria

- [ ] Формат `domclick` добавлен наравне с `yandex` и `cian`: доступен в справочнике форматов и в выпадающем списке админки
- [ ] Разбор идёт по всей вложенности: данные лота дополняются полями корпуса и комплекса
- [ ] ЖК создаётся один на файл, с адресом, застройщиком, картинкой и описанием; повторный импорт не плодит дубли и не затирает правки, сделанные в админке
- [ ] Срок сдачи собирается из года и квартала готовности корпуса
- [ ] Комнатность 0 сохраняется как студия, а не теряется как пустое значение
- [ ] Планировка попадает в `planImageUrl` у всех лотов, где она есть в выгрузке
- [ ] Отделка, вид из окна, балкон/лоджия, санузел и признак евро-планировки сохраняются и доступны ассистенту
- [ ] Лот, пропавший из выгрузки, помечается неактивным, как и в других форматах
- [ ] Тесты на фикстурах: многокорпусный ЖК, однокорпусный, повторный импорт, исчезнувший лот, битый XML, лот без цены
- [ ] Все 7 боевых фидов заведены в базу и успешно импортированы; в базе около 997 активных квартир в 7 ЖК
- [ ] Проверено вживую: в админке все 7 фидов со статусом «ок», в разделе ЖК видны комплексы с вилками цен, у квартир открываются планировки
