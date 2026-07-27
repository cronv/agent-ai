import type { ReactElement, ReactNode, SVGProps } from 'react'

/**
 * Иконки интерфейса.
 *
 * Векторные, в одном стиле (контур 1.75, скруглённые концы), красятся
 * `currentColor`. Эмодзи вместо иконок не используем: они выглядят
 * по-разному на разных системах и не подчиняются цвету текста.
 *
 *   <IconFeeds className="size-5" />
 *
 * Декоративные иконки скрыты от скринридера (`aria-hidden`), потому что
 * рядом всегда есть текст. Если иконка стоит одна — задайте `title`.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Подпись для скринридера, если у иконки нет текста рядом. */
  title?: string
}

function Glyph({ title, children, ...props }: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export function IconDashboard(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Glyph>
  )
}

export function IconProjects(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M3 21h18" />
      <path d="M5 21V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15" />
      <path d="M13 21V11a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v10" />
      <path d="M8 9h2" />
      <path d="M8 13h2" />
      <path d="M8 17h2" />
      <path d="M16 14h.01" />
      <path d="M16 18h.01" />
    </Glyph>
  )
}

export function IconFeeds(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1.4" />
    </Glyph>
  )
}

export function IconKnowledge(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </Glyph>
  )
}

export function IconConversations(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
      <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
    </Glyph>
  )
}

export function IconLeads(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Glyph>
  )
}

export function IconSettings(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M21 4h-7" />
      <path d="M10 4H3" />
      <path d="M21 12h-9" />
      <path d="M8 12H3" />
      <path d="M21 20h-5" />
      <path d="M12 20H3" />
      <path d="M14 2v4" />
      <path d="M8 10v4" />
      <path d="M16 18v4" />
    </Glyph>
  )
}

export function IconMenu(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </Glyph>
  )
}

export function IconClose(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Glyph>
  )
}

export function IconLogout(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Glyph>
  )
}

export function IconAlert(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Glyph>
  )
}

export function IconCheck(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M21.8 10.9V12a10 10 0 1 1-5.93-9.14" />
      <path d="m22 4-10 10.01L9 11" />
    </Glyph>
  )
}

export function IconClock(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Glyph>
  )
}

export function IconLock(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="11" width="17" height="10" rx="2.5" />
      <path d="M7.5 11V7a4.5 4.5 0 0 1 9 0v4" />
    </Glyph>
  )
}

export function IconInbox(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </Glyph>
  )
}

export function IconRefresh(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </Glyph>
  )
}

export function IconEye(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M2.1 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.8 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.8 0" />
      <circle cx="12" cy="12" r="3" />
    </Glyph>
  )
}

export function IconEyeOff(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M10.73 5.08a10.74 10.74 0 0 1 11.2 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49" />
      <path d="M14.08 14.16a3 3 0 0 1-4.24-4.24" />
      <path d="M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14" />
      <path d="m2 2 20 20" />
    </Glyph>
  )
}
