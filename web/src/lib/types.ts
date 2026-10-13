/** Her kaydın ortak alanı. Alan adları veritabanı sütunlarının camelCase karşılığıdır (bkz. lib/db.ts). */
export interface Rec {
  id: string
}

export type Role = 'admin' | 'manager' | 'staff'

export interface Department extends Rec {
  name: string
  color: string
  description: string
}

export interface User extends Rec {
  username: string
  email: string
  name: string
  /** "avatars" alanındaki dosya yolu */
  avatar: string
  role: Role
  department: string
  title: string
  phone: string
  active: boolean
  lastSeen: string
  created: string
}

export type Priority = 'normal' | 'important' | 'urgent'

export interface Announcement extends Rec {
  title: string
  body: string
  author: string
  departments: string[]
  priority: Priority
  pinned: boolean
  requireAck: boolean
  attachments: string[]
  created: string
  updated: string
}

export interface AnnouncementRead extends Rec {
  announcement: string
  user: string
  created: string
}

export interface Conversation extends Rec {
  type: 'direct' | 'group'
  name: string
  members: string[]
  createdBy: string
  lastMessageAt: string
  lastMessageText: string
}

export interface Message extends Rec {
  conversation: string
  sender: string
  text: string
  attachments: string[]
  /** Metni sonradan değiştirildiyse dolu */
  editedAt: string
  created: string
  updated: string
}

/** Kişinin bir sohbet için kendi ayarı (karşı tarafı etkilemez). */
export interface ConversationSettings {
  muted: boolean
  archived: boolean
  /** Kişinin sohbeti sildiği an; öncesindeki mesajlar ona görünmez. Silmediyse boş. */
  clearedAt: string
}

export type EventCategory = 'meeting' | 'shipment' | 'production' | 'leave' | 'training' | 'visit' | 'other'

export interface CalendarEvent extends Rec {
  title: string
  description: string
  start: string
  end: string
  allDay: boolean
  category: EventCategory
  location: string
  departments: string[]
  participants: string[]
  createdBy: string
}

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface Task extends Rec {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string
  assignees: string[]
  department: string
  createdBy: string
  completedAt: string
  attachments: string[]
  created: string
}

export interface TaskComment extends Rec {
  task: string
  author: string
  text: string
  created: string
}

export type ShiftKind = 'morning' | 'evening' | 'night' | 'office' | 'off' | 'leave' | 'sick' | 'holiday'

export interface Shift extends Rec {
  user: string
  date: string
  kind: ShiftKind
  startTime: string
  endTime: string
  department: string
  note: string
}

export type PlanStatus = 'planned' | 'in_progress' | 'done' | 'cancelled'

export interface ProductionPlan extends Rec {
  date: string
  product: string
  productCode: string
  quantity: number
  unit: string
  producedQuantity: number
  line: string
  status: PlanStatus
  responsible: string
  department: string
  notes: string
  createdBy: string
}
