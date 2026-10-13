import type { RecordModel } from 'pocketbase'

export type Role = 'admin' | 'manager' | 'staff'

export interface Department extends RecordModel {
  name: string
  color: string
  description: string
}

export interface User extends RecordModel {
  username: string
  email: string
  name: string
  avatar: string
  role: Role
  department: string
  title: string
  phone: string
  active: boolean
  lastSeen: string
  expand?: { department?: Department }
}

export type Priority = 'normal' | 'important' | 'urgent'

export interface Announcement extends RecordModel {
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
  expand?: { author?: User; departments?: Department[] }
}

export interface AnnouncementRead extends RecordModel {
  announcement: string
  user: string
  created: string
  expand?: { user?: User }
}

export interface Conversation extends RecordModel {
  type: 'direct' | 'group'
  name: string
  members: string[]
  createdBy: string
  lastMessageAt: string
  lastMessageText: string
  expand?: { members?: User[] }
}

export interface Message extends RecordModel {
  conversation: string
  sender: string
  text: string
  attachments: string[]
  created: string
  updated: string
}

export type EventCategory = 'meeting' | 'shipment' | 'production' | 'leave' | 'training' | 'visit' | 'other'

export interface CalendarEvent extends RecordModel {
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
  expand?: { participants?: User[]; createdBy?: User }
}

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface Task extends RecordModel {
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
  expand?: { assignees?: User[]; createdBy?: User; department?: Department }
}

export interface TaskComment extends RecordModel {
  task: string
  author: string
  text: string
  created: string
  expand?: { author?: User }
}

export type ShiftKind = 'morning' | 'evening' | 'night' | 'office' | 'off' | 'leave' | 'sick' | 'holiday'

export interface Shift extends RecordModel {
  user: string
  date: string
  kind: ShiftKind
  startTime: string
  endTime: string
  department: string
  note: string
}

export type PlanStatus = 'planned' | 'in_progress' | 'done' | 'cancelled'

export interface ProductionPlan extends RecordModel {
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
  expand?: { responsible?: User }
}
