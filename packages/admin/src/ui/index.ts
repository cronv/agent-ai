/**
 * Готовые кирпичики интерфейса админки.
 *
 *   import { Card, Table, Button, EmptyState } from '../ui/index.js'
 *
 * Новый раздел собирается из них — тогда все разделы выглядят одинаково
 * и правка стиля в одном месте меняет всю админку.
 */

export { Alert } from './Alert.js'
export type { AlertTone } from './Alert.js'
export { Badge } from './Badge.js'
export type { BadgeTone } from './Badge.js'
export { Button } from './Button.js'
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button.js'
export { Card, CardHeader } from './Card.js'
export { EmptyState } from './EmptyState.js'
export { Field } from './Field.js'
export type { FieldProps } from './Field.js'
export { PageHeader } from './PageHeader.js'
export { LoadingBlock, Spinner } from './Spinner.js'
export { StatCard, StatCardSkeleton } from './StatCard.js'
export { Table, TBody, TD, TH, THead, TR } from './Table.js'
export * from './icons.js'
