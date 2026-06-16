import { describe, it, expect } from 'vitest'
import { ACTIVE_COLUMNS, ACTIVE_STATUSES, groupTasksByColumn } from '../src/renderer/hooks/useTasks'
import type { Task } from '../src/renderer/hooks/useTasks'

describe('ACTIVE_COLUMNS', () => {
  it('should have 5 columns in correct order', () => {
    expect(ACTIVE_COLUMNS).toHaveLength(5)
    expect(ACTIVE_COLUMNS[0].status).toBe('PREPARATION')
    // 待執行 → WAITING、暫停 → PENDING（status 對調，label 不變）
    expect(ACTIVE_COLUMNS[1].status).toBe('WAITING')
    expect(ACTIVE_COLUMNS[2].status).toBe('IN_PROGRESS')
    expect(ACTIVE_COLUMNS[3].status).toBe('PENDING')
    expect(ACTIVE_COLUMNS[4].status).toBe('COMPLETED')
  })

  it('should have matching labels (Chinese)', () => {
    expect(ACTIVE_COLUMNS[0].label).toBe('準備中')
    expect(ACTIVE_COLUMNS[1].label).toBe('待執行')
    expect(ACTIVE_COLUMNS[2].label).toBe('進行中')
    expect(ACTIVE_COLUMNS[3].label).toBe('暫停')
    expect(ACTIVE_COLUMNS[4].label).toBe('完成')
  })

  it('ACTIVE_STATUSES should match column statuses', () => {
    expect(ACTIVE_STATUSES).toEqual(ACTIVE_COLUMNS.map((c) => c.status))
  })
})

describe('groupTasksByColumn', () => {
  const makeTask = (id: string, status: string): Task => ({
    id,
    name: `Task ${id}`,
    status,
    raw: {},
  })

  it('should return a map with all 5 columns', () => {
    const map = groupTasksByColumn([])
    expect(map.size).toBe(5)
    for (const col of ACTIVE_COLUMNS) {
      expect(map.has(col.status)).toBe(true)
      expect(map.get(col.status)).toEqual([])
    }
  })

  it('should group tasks into correct columns', () => {
    const tasks = [
      makeTask('1', 'PREPARATION'),
      makeTask('2', 'IN_PROGRESS'),
      makeTask('3', 'IN_PROGRESS'),
      makeTask('4', 'COMPLETED'),
    ]
    const map = groupTasksByColumn(tasks)
    expect(map.get('PREPARATION')).toHaveLength(1)
    expect(map.get('PENDING')).toHaveLength(0)
    expect(map.get('IN_PROGRESS')).toHaveLength(2)
    expect(map.get('WAITING')).toHaveLength(0)
    expect(map.get('COMPLETED')).toHaveLength(1)
  })

  it('should ignore tasks with unknown status (not crash)', () => {
    const tasks = [makeTask('x', 'UNKNOWN_STATUS')]
    const map = groupTasksByColumn(tasks)
    // 未知 status 不進任何欄，所有欄仍為空
    for (const col of ACTIVE_COLUMNS) {
      expect(map.get(col.status)).toHaveLength(0)
    }
  })
})
